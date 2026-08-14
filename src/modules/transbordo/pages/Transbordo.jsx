import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { entities } from '@transbordo/services/entities';
import { syncEstoqueSaldos, isUnidadeMassaEntrada, isUnidadeVolumeEntrada, normalizeUnidadeEntrada } from "@transbordo/lib/estoqueSaldo";
import { findLinkedTransbordo, findAllLinkedTransbordos, multipleTransbordosMessage } from "@transbordo/lib/findLinkedTransbordo";
import { Plus, Search, Eye, Pencil, Trash2 } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@shared/components/ui/alert-dialog";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import TransbordoModal from "@transbordo/components/transbordo/TransbordoModal";
import TransbordoViewDialog from "@transbordo/components/transbordo/TransbordoViewDialog";
import {
  formatVolume,
  formatMass,
  roundVolume,
  roundMass,
  parseDensidade,
} from "@transbordo/lib/format";
import { calculateFIFOAllocation, expandOrigensForFifo } from "@transbordo/lib/fifo";
import {
  findFracionadoNoPatio,
  mergeComposicao,
  getDominantLote,
  removeComposicaoByTransbordo,
  unifyDuplicateVasilhames,
  seedComposicaoFromVasilhame,
  aggregateComposicaoByLote,
} from "@transbordo/lib/vasilhameComposicao";
import {
  syncTankaVasilhamesAfterOrigem,
  restoreTankaVasilhamesAfterExclude,
} from "@transbordo/lib/tankaVolume";
import {
  buildFiltracaoFromVasilhame,
  getFiltroEmUso,
  isFiltracaoElegivel,
  upsertFiltracaoForVasilhame,
} from "@transbordo/lib/filtracao";
import {
  TIPOS_EMBALAGEM_ESTOQUE,
  deleteEstoqueDoTransbordo,
  migrateEstoqueEmbaladoParaVasilhames,
  normalizeBarrilEmbalagensUnitarias,
} from "@transbordo/lib/transbordoEmbalado";
import {
  isDestinoEstoqueEmbalado,
  buildPlacaEmbalagens,
} from "@transbordo/lib/tiposEmbalagem";

/** Vasilhame + embalagens unitárias (bombona/tambor/IBC) na tela de Vasilhames. */
const TIPOS_VASILHAME = new Set(["Vasilhame", ...TIPOS_EMBALAGEM_ESTOQUE]);

/** Converte string vazia em null (evita erro de UUID/date no Postgres). */
const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

/**
 * Baixa volume/composição de vasilhames usados como origem do transbordo.
 */
async function syncOrigemVasilhameSaldos({
  origens = [],
  dens = 0,
  entities: entitiesApi,
  vasilhamesList = [],
  dataSaida = null,
}) {
  if (!entitiesApi?.vasilhames) return;
  const list = vasilhamesList || [];

  for (const o of origens) {
    if (o.tipo_origem !== "vasilhame" || !o.entrada_id) continue;
    const v = list.find((row) => row.id === o.entrada_id);
    if (!v) continue;

    const volOut = roundVolume(o.volume_retirado || 0);
    if (volOut <= 0) continue;

    const newVol = Math.max(0, roundVolume((v.volume || 0) - volOut));
    let composicao = seedComposicaoFromVasilhame(v).map((c) => ({ ...c }));

    const lotesRet = (o.lotes_retirados || []).filter(
      (l) => roundVolume(l.volume_retirado || 0) > 0
    );
    if (lotesRet.length > 0) {
      for (const l of lotesRet) {
        let remaining = roundVolume(l.volume_retirado);
        const loteKey = (l.lote || "").trim();
        for (const c of composicao) {
          if (remaining <= 0) break;
          if ((c.lote || "").trim() !== loteKey) continue;
          const take = Math.min(roundVolume(c.quantidade_l || 0), remaining);
          c.quantidade_l = roundVolume((c.quantidade_l || 0) - take);
          if (dens > 0) c.quantidade_kg = roundMass(c.quantidade_l * dens);
          remaining -= take;
        }
      }
    } else {
      let remaining = volOut;
      const loteKey = (o.lote || "").trim();
      // Preferência pelo lote informado; depois FIFO
      const ordered = [
        ...composicao.filter((c) => loteKey && (c.lote || "").trim() === loteKey),
        ...composicao.filter((c) => !loteKey || (c.lote || "").trim() !== loteKey),
      ];
      for (const c of ordered) {
        if (remaining <= 0) break;
        const take = Math.min(roundVolume(c.quantidade_l || 0), remaining);
        c.quantidade_l = roundVolume((c.quantidade_l || 0) - take);
        if (dens > 0) c.quantidade_kg = roundMass(c.quantidade_l * dens);
        remaining -= take;
      }
    }

    composicao = composicao.filter((c) => roundVolume(c.quantidade_l || 0) > 0);
    // Alinha soma da composição ao volume restante
    const compSum = roundVolume(
      composicao.reduce((s, c) => s + (c.quantidade_l || 0), 0)
    );
    if (composicao.length > 0 && compSum !== newVol) {
      const diff = newVol - compSum;
      composicao[composicao.length - 1].quantidade_l = Math.max(
        0,
        roundVolume(composicao[composicao.length - 1].quantidade_l + diff)
      );
      if (dens > 0) {
        composicao[composicao.length - 1].quantidade_kg = roundMass(
          composicao[composicao.length - 1].quantidade_l * dens
        );
      }
    }

    const peso =
      dens > 0
        ? roundMass(newVol * dens)
        : roundMass(
            aggregateComposicaoByLote(composicao).reduce(
              (s, c) => s + (c.quantidade_kg || 0),
              0
            )
          );
    const patch = {
      volume: newVol,
      peso_liquido: newVol > 0 ? peso : 0,
      peso_bruto: roundMass((v.tara || 0) + (newVol > 0 ? peso : 0)),
      composicao: newVol > 0 ? composicao : [],
      lote: getDominantLote(composicao) || v.lote || "",
    };
    if (newVol <= 0) {
      patch.status = "Expedido";
      patch.data_saida = dataSaida || null;
    }

    await entitiesApi.vasilhames.update(v.id, patch);
    Object.assign(v, patch);
  }
}

/**
 * Reverte top-ups de fracionados feitos por um transbordo (antes de excluir/reeditar).
 * Remove da composição e do volume a parcela atribuída a esse código.
 */
async function revertTopUpsDoTransbordo({
  transbordo,
  vasilhamesList,
  densFallback = 0,
  produtoFiltrado = false,
  filtroExtras = {},
}) {
  if (!transbordo) return;
  const codigo = transbordo.codigo_transbordo;
  const dens = densFallback || parseDensidade(transbordo.densidade);

  for (const d of transbordo.destinos || []) {
    if (d.tipo_embalagem !== "Vasilhame" || !d.placa) continue;
    const existing = findFracionadoNoPatio(vasilhamesList, {
      placa: d.placa,
      barril: d.barril,
      id: d.vasilhame_existente_id,
    });
    const candidate =
      existing ||
      vasilhamesList.find(
        (v) =>
          (v.status || "No Pátio") === "No Pátio" &&
          String(v.placa || "").trim().toUpperCase() ===
            String(d.placa || "").trim().toUpperCase() &&
          (v.composicao || []).some((c) => c.transbordo_codigo === codigo)
      );
    if (!candidate) continue;

    // Não reverte registros criados por este OP — serão apagados via deleteMany
    if (candidate.transbordo_id === transbordo.id) continue;

    const cleaned = removeComposicaoByTransbordo(
      candidate.composicao || [],
      codigo
    );
    const removedVol = roundVolume(
      (candidate.composicao || [])
        .filter((c) => c.transbordo_codigo === codigo)
        .reduce((s, c) => s + (c.quantidade_l || 0), 0)
    );
    const subtractVol =
      removedVol > 0
        ? removedVol
        : roundVolume(d.volume_total || d.volume || 0);
    const newVol = Math.max(
      0,
      roundVolume(candidate.volume || 0) - subtractVol
    );
    const densCand = parseDensidade(candidate.densidade) || dens;
    const peso = densCand > 0 ? roundMass(newVol * densCand) : 0;
    const reverted = await entities.vasilhames.update(candidate.id, {
      volume: newVol,
      peso_liquido: peso,
      peso_bruto: roundMass((candidate.tara || 0) + peso),
      composicao: cleaned,
      lote: getDominantLote(cleaned) || candidate.lote || "",
      fracionado: newVol > 0 ? true : candidate.fracionado,
    });
    candidate.volume = newVol;
    candidate.composicao = cleaned;

    if (produtoFiltrado) {
      await upsertFiltracaoForVasilhame(
        entities,
        reverted || {
          ...candidate,
          volume: newVol,
          composicao: cleaned,
          lote: getDominantLote(cleaned) || candidate.lote || "",
        },
        filtroExtras
      );
    }
  }
}

function buildVasilhameBase(data, codigo, savedTransbordo, d, destinoIndex, comp) {
  const isTankagem = d.tipo_embalagem === "Tankagem";
  const isUnitario = isDestinoEstoqueEmbalado(d.tipo_embalagem);
  const dens = parseDensidade(data.densidade);
  const volume = roundVolume(d.volume_total || d.volume || 0);
  const qtdEmb = Math.max(0, Math.round(d.quantidade_embalagens || 0));
  const volPorEmb = roundVolume(
    d.volume_por_embalagem || (qtdEmb > 0 ? volume / qtdEmb : 0)
  );
  const pesoLiquido =
    d.peso_liquido != null && d.peso_liquido !== ""
      ? roundMass(d.peso_liquido)
      : dens > 0
      ? roundMass(volume * dens)
      : 0;
  const composicaoBase = mergeComposicao([], comp, {
    transbordo_codigo: codigo,
    data: data.data || null,
  });
  const composicao =
    isUnitario && composicaoBase.length > 0
      ? composicaoBase.map((c, i) =>
          i === 0
            ? {
                ...c,
                quantidade_embalagens: qtdEmb,
                volume_por_embalagem: volPorEmb,
              }
            : c
        )
      : isUnitario
        ? [
            {
              lote: data.lote || getDominantLote(composicaoBase) || "",
              quantidade_l: volume,
              quantidade_kg: pesoLiquido,
              quantidade_embalagens: qtdEmb,
              volume_por_embalagem: volPorEmb,
              transbordo_codigo: codigo,
              data: data.data || null,
            },
          ]
        : composicaoBase;
  const lote = getDominantLote(composicao);

  const placa = isTankagem
    ? d.tanka_codigo || ""
    : isUnitario
      ? buildPlacaEmbalagens(qtdEmb || 1, d.tipo_embalagem)
      : d.placa || "";

  return {
    codigo,
    transbordo_id: savedTransbordo.id,
    origem: "transbordo",
    numero_op: codigo,
    placa,
    barril: isTankagem || isUnitario ? "" : d.barril || "",
    tipo: d.tipo_embalagem,
    produto_id: nullIfEmpty(data.produto_id),
    produto_nome: data.produto_nome || "",
    produto_codigo: data.produto_codigo || "",
    cliente_id: nullIfEmpty(data.cliente_id),
    cliente_nome: data.cliente_nome || "",
    lote,
    densidade: data.densidade || "",
    volume,
    tara: roundMass(d.tara || 0),
    peso_liquido: pesoLiquido,
    peso_bruto: roundMass((d.tara || 0) + pesoLiquido),
    lacres: d.lacres || "",
    eslinga: d.eslinga || "",
    gps: d.gps || "",
    menor_teste: nullIfEmpty(d.menor_teste),
    status: "No Pátio",
    responsavel: (data.operadores || []).join(", "),
    fracionado: isUnitario ? false : d.fracionado || false,
    composicao,
    destino_index: destinoIndex,
  };
}

function labelUnidadeEntrada(unidade) {
  const u = normalizeUnidadeEntrada(unidade);
  if (u === "l") return "L";
  if (u === "gal") return "gal";
  if (u === "kg") return "kg";
  if (u === "lb") return "lb";
  return String(unidade || "").trim() || "";
}

/** Embalado vs granel a partir das origens do OP. */
function resolveTransbordoMedida(transbordo) {
  const origens = Array.isArray(transbordo?.origens) ? transbordo.origens : [];
  for (const o of origens) {
    if (o?.tipo_origem === "embalado" || o?.embalado) {
      return {
        embalado: true,
        unidade: o.unidade_medida || "kg",
      };
    }
  }
  const first = origens[0];
  if (
    first?.unidade_medida &&
    isUnidadeMassaEntrada(first.unidade_medida) &&
    (first.embalado || first.tipo_origem === "embalado")
  ) {
    return { embalado: true, unidade: first.unidade_medida };
  }
  return { embalado: false, unidade: first?.unidade_medida || "L" };
}

function renderTransbordoVolumeQuantidade(transbordo) {
  const medida = resolveTransbordoMedida(transbordo);
  const umLabel = labelUnidadeEntrada(medida.unidade);
  const isEmbalado = Boolean(medida.embalado);
  const umIsVolume = isUnidadeVolumeEntrada(medida.unidade);
  const vol = Number(transbordo?.volume_total) || 0;
  const mass = Number(transbordo?.massa_total) || 0;

  if (isEmbalado && !umIsVolume) {
    const qtd = vol > 0 ? vol : mass;
    return {
      volume: "-",
      quantidade:
        qtd > 0
          ? `${formatMass(qtd, { empty: "-" })}${umLabel ? ` ${umLabel}` : ""}`
          : "-",
    };
  }

  if (isEmbalado && umIsVolume) {
    const qtdTxt =
      vol > 0
        ? `${formatVolume(vol, { empty: "-" })} ${umLabel || "L"}`
        : "-";
    return { volume: qtdTxt, quantidade: qtdTxt };
  }

  return {
    volume: vol > 0 ? `${formatVolume(vol, { empty: "-" })} L` : "-",
    quantidade: mass > 0 ? `${formatMass(mass, { empty: "-" })} kg` : "-",
  };
}

export default function Transbordo() {
  const [transbordos, setTransbordos] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [isotanques, setIsotanques] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [search, setSearch] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTransbordo, setEditingTransbordo] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [viewTransbordo, setViewTransbordo] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [prefillConsumed, setPrefillConsumed] = useState(false);
  const [activePrefill, setActivePrefill] = useState(null);
  const [chainBlockMessage, setChainBlockMessage] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const prefillEntrada = location.state?.prefillEntrada;
  const linkedTransbordoFromNav = location.state?.linkedTransbordo;
  const linkedTransbordoIdFromNav = location.state?.linkedTransbordoId;

  const clearPrefillNavigation = () => {
    if (location.state?.prefillEntrada || location.state?.linkedTransbordo) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  };

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      // Migra Bombona/IBC/Tambor legados do Estoque → Vasilhames
      try {
        const mig = await migrateEstoqueEmbaladoParaVasilhames();
        if (mig.deletedEstoque > 0) {
          console.info(
            `[ChemFlow] Migrados ${mig.migrated} embalagem(ns) do Estoque → Vasilhames; removidos ${mig.deletedEstoque} do estoque.`
          );
        }
        await normalizeBarrilEmbalagensUnitarias();
      } catch (migErr) {
        console.warn("[ChemFlow] Migração embalado (estoque→vasilhame):", migErr);
      }

      const [trans, prods, cliens, ents, isos, vascs] = await Promise.all([
        entities.transbordos.list("-created_date"),
        entities.produtos.list(),
        entities.clientes.list(),
        entities.estoque.list(),
        entities.isotanques.list(),
        entities.vasilhames.list(),
      ]);
      setTransbordos(trans);
      setProdutos(prods);
      setClientes(cliens);
      setEntradas(ents);
      setIsotanques(isos);
      setVasilhames(vascs);
    } catch {
      if (!silent) setTransbordos([]);
    }
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (prefillEntrada && !loading && !prefillConsumed) {
      const allLinked = findAllLinkedTransbordos(
        transbordos,
        prefillEntrada,
        entradas,
        vasilhames
      );

      if (allLinked.length > 1) {
        setEditingTransbordo(null);
        setActivePrefill(null);
        setModalOpen(false);
        setPrefillConsumed(true);
        setChainBlockMessage(multipleTransbordosMessage(allLinked));
        clearPrefillNavigation();
        return;
      }

      // Preferência: OP passado na navegação (já resolvido na Entrada)
      let linked =
        (linkedTransbordoIdFromNav &&
          transbordos.find((t) => t.id === linkedTransbordoIdFromNav)) ||
        linkedTransbordoFromNav ||
        findLinkedTransbordo(transbordos, prefillEntrada, entradas, vasilhames);

      // Garante versão fresca da lista carregada (com destinos completos)
      if (linked?.id) {
        linked = transbordos.find((t) => t.id === linked.id) || linked;
      }

      setEditingTransbordo(linked || null);
      setActivePrefill(prefillEntrada);
      setReadOnly(false);
      setSaveError("");
      setModalOpen(true);
      setPrefillConsumed(true);
    }
  }, [
    prefillEntrada,
    loading,
    prefillConsumed,
    transbordos,
    entradas,
    vasilhames,
    linkedTransbordoFromNav,
    linkedTransbordoIdFromNav,
  ]);

  const filtered = transbordos.filter((t) => {
    const q = search.toLowerCase().trim();
    const matchSearch =
      !q ||
      t.codigo_transbordo?.toLowerCase().includes(q) ||
      t.produto_nome?.toLowerCase().includes(q) ||
      t.produto_codigo?.toLowerCase().includes(q) ||
      t.cliente_nome?.toLowerCase().includes(q) ||
      (t.operadores || []).some((op) => op.toLowerCase().includes(q)) ||
      (t.destinos || []).some(
        (d) =>
          d.tanka_codigo?.toLowerCase().includes(q) ||
          d.placa?.toLowerCase().includes(q)
      ) ||
      (t.origens || []).some(
        (o) =>
          (o.tipo_origem === "tanka" &&
            o.entrada_codigo?.toLowerCase().includes(q)) ||
          o.lote?.toLowerCase().includes(q)
      );

    const matchCliente =
      !clienteFilter ||
      clienteFilter === "Todos os clientes" ||
      t.cliente_nome === clienteFilter;

    return matchSearch && matchCliente;
  });

  /** Largura da coluna Produto limitada (não estica com nomes longos). */
  const produtoColCh = useMemo(() => {
    let maxLen = "Produto".length;
    for (const p of produtos) {
      const label = `${p.codigo ? `${p.codigo} - ` : ""}${p.produto || p.nome || ""}`;
      if (label.length > maxLen) maxLen = label.length;
    }
    for (const t of transbordos) {
      const label = `${t.produto_codigo ? `${t.produto_codigo} - ` : ""}${t.produto_nome || ""}`;
      if (label.length > maxLen) maxLen = label.length;
    }
    // Cabe o conteúdo, mas limita nomes muito longos
    return Math.min(Math.max(maxLen, 10), 36);
  }, [produtos, transbordos]);

  const formatDate = (d) => {
    if (!d) return "-";
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("pt-BR");
  };

  const generateCodigo = () => {
    const existing = transbordos
      .map((t) => t.codigo_transbordo)
      .filter(Boolean)
      .map((c) => parseInt(c.replace(/\D/g, "")))
      .filter((n) => !isNaN(n));
    const max = existing.length > 0 ? Math.max(...existing) : 0;
    return `T${String(max + 1).padStart(3, "0")}`;
  };

  const handleNew = () => {
    setEditingTransbordo(null);
    setActivePrefill(null);
    clearPrefillNavigation();
    setReadOnly(false);
    setSaveError("");
    setModalOpen(true);
  };

  const handleEdit = (t) => {
    setEditingTransbordo(t);
    setActivePrefill(null);
    clearPrefillNavigation();
    setReadOnly(false);
    setSaveError("");
    setModalOpen(true);
  };

  const handleView = (t) => {
    setViewTransbordo(t);
    setViewOpen(true);
  };

  const handleSave = async (data) => {
    setSaveError("");
    try {
      const affectedEstoqueIds = [
        ...(editingTransbordo?.origens || []).map((o) => o.entrada_id),
        ...(data.origens || []).map((o) => o.entrada_id),
      ];

      // Normaliza volumes para litros inteiros (soma destino = soma origem)
      const dens = parseDensidade(data.densidade);
      const origens = (data.origens || []).map((o) => {
        const lotesRet = (o.lotes_retirados || [])
          .map((l) => ({
            lote: l.lote || "",
            saldo_disponivel: roundVolume(l.saldo_disponivel || 0),
            volume_retirado: roundVolume(l.volume_retirado || 0),
          }))
          .filter((l) => l.volume_retirado > 0);
        const volume_retirado =
          lotesRet.length > 0
            ? roundVolume(lotesRet.reduce((s, l) => s + l.volume_retirado, 0))
            : roundVolume(o.volume_retirado);
        const embaladoOrigem =
          o.tipo_origem === "embalado" || Boolean(o.embalado);
        const um = o.unidade_medida || (embaladoOrigem ? "kg" : "L");
        const massaEmbaladoMassa = isUnidadeMassaEntrada(um)
          ? String(um).toLowerCase() === "lb"
            ? roundMass(volume_retirado * 0.453592)
            : roundMass(volume_retirado)
          : dens > 0
            ? roundMass(volume_retirado * dens)
            : roundMass(o.massa_retirada || 0);
        return {
          ...o,
          lote:
            lotesRet.find((l) => l.volume_retirado > 0)?.lote || o.lote || "",
          volume_retirado,
          unidade_medida: um,
          embalado: embaladoOrigem,
          massa_retirada: embaladoOrigem
            ? massaEmbaladoMassa
            : roundMass(o.massa_retirada ?? volume_retirado * dens),
          ...(lotesRet.length > 0 ? { lotes_retirados: lotesRet } : {}),
        };
      });
      const destinos = (data.destinos || []).map((d) => {
        const volume_total = roundVolume(d.volume_total || d.volume || 0);
        const origemLinked = origens.find((o) => o._uid && o._uid === d.origem_uid);
        const embaladoMass =
          (origemLinked?.tipo_origem === "embalado" || origemLinked?.embalado) &&
          isUnidadeMassaEntrada(origemLinked?.unidade_medida || "kg");
        const pesoAuto = embaladoMass
          ? roundMass(volume_total)
          : dens > 0
            ? roundMass(volume_total * dens)
            : 0;
        return {
          ...d,
          volume: d.tipo_embalagem === "Vasilhame" || d.tipo_embalagem === "Tankagem" || isDestinoEstoqueEmbalado(d.tipo_embalagem)
            ? volume_total
            : roundVolume(d.volume || 0),
          volume_total,
          volume_por_embalagem: roundVolume(d.volume_por_embalagem || 0),
          quantidade_embalagens: Math.round(d.quantidade_embalagens || 0),
          tara: roundMass(d.tara || 0),
          peso_liquido: roundMass(d.peso_liquido || pesoAuto),
          peso_bruto: roundMass(d.peso_bruto || 0),
        };
      });

      // Ajuste fino: residual de arredondamento absorvido no último destino
      const sumOrig = origens.reduce((s, o) => s + o.volume_retirado, 0);
      const sumDest = destinos.reduce((s, d) => s + d.volume_total, 0);
      if (destinos.length > 0 && sumOrig !== sumDest) {
        const diff = sumOrig - sumDest;
        const last = destinos[destinos.length - 1];
        last.volume_total = Math.max(0, last.volume_total + diff);
        if (
          last.tipo_embalagem === "Vasilhame" ||
          last.tipo_embalagem === "Tankagem" ||
          isDestinoEstoqueEmbalado(last.tipo_embalagem)
        ) {
          last.volume = last.volume_total;
        }
        const origemLast = origens.find((o) => o._uid === last.origem_uid);
        const embaladoMassLast =
          (origemLast?.tipo_origem === "embalado" || origemLast?.embalado) &&
          isUnidadeMassaEntrada(origemLast?.unidade_medida || "kg");
        last.peso_liquido = embaladoMassLast
          ? roundMass(last.volume_total)
          : dens > 0
            ? roundMass(last.volume_total * dens)
            : last.peso_liquido;
      }

      const volume_total = origens.reduce((s, o) => s + o.volume_retirado, 0);
      const massa_total = roundMass(
        origens.reduce((s, o) => s + (Number(o.massa_retirada) || 0), 0) ||
          volume_total * dens
      );
      // `id` fica fora do payload: no insert ele deve ser gerado pelo banco
      // (id: null violaria a constraint) e no update o alvo já é o editingId.
      const { id: _formId, ...dataSemId } = data;
      const payload = {
        ...dataSemId,
        cliente_id: nullIfEmpty(data.cliente_id),
        produto_id: nullIfEmpty(data.produto_id),
        volume_total,
        massa_total,
        origens,
        destinos,
      };

      // FIFO opera sobre uma origem por lote (ordem informada na UI)
      const origensFifo = expandOrigensForFifo(origens, dens);

      const produtoFiltrado = !!produtos.find(
        (p) => p.id === payload.produto_id
      )?.filtrado;

      const filtroEmUso = produtoFiltrado ? await getFiltroEmUso(entities) : null;
      const filtroExtras = filtroEmUso
        ? { filtro_id: filtroEmUso.id, filtro_codigo: filtroEmUso.codigo || "" }
        : {};

      let savedTransbordo;
      let codigo;
      const editingId = editingTransbordo?.id || data.id || null;
      const existingForEdit =
        editingTransbordo ||
        (editingId ? transbordos.find((t) => t.id === editingId) : null);

      if (editingId && existingForEdit) {
        codigo = existingForEdit.codigo_transbordo;
        // Reverte top-ups de fracionados feitos por este transbordo antes de reaplicar
        await revertTopUpsDoTransbordo({
          transbordo: existingForEdit,
          vasilhamesList: vasilhames,
          densFallback: dens,
          produtoFiltrado,
          filtroExtras,
        });

        savedTransbordo = await entities.transbordos.update(editingId, payload);
        // Remove apenas registros CRIADOS por este transbordo (não os top-ups)
        // Filtrações ligadas caem via ON DELETE CASCADE em vasilhame_id
        await entities.vasilhames.deleteMany({ transbordo_id: editingId });
        await entities.filtracoes.deleteMany({ transbordo_id: editingId });
        await deleteEstoqueDoTransbordo(editingId);
      } else {
        codigo = generateCodigo();
        savedTransbordo = await entities.transbordos.create({
          ...payload,
          codigo_transbordo: codigo,
        });
      }

      // FIFO: composição por destino → cria ou atualiza vasilhames / estoque embalado
      // Com multi-lote na origem, o 1º lote informado vai ao 1º destino, e assim por diante.
      const { destinoCompositions } = calculateFIFOAllocation(
        origensFifo,
        destinos,
        dens
      );
      // Lastreia cada fatia FIFO ao id do registro de estoque (origem.entrada_id).
      for (const comp of destinoCompositions) {
        for (const c of comp) {
          const o = origensFifo[c.origem_index];
          const estoqueId = o?.estoque_id || o?.entrada_id || null;
          if (estoqueId) {
            c.estoque_id = estoqueId;
            c.entrada_id = estoqueId;
          }
          if (
            (o?.tipo_origem === "embalado" || o?.embalado) &&
            isUnidadeMassaEntrada(o?.unidade_medida || "kg")
          ) {
            c.quantidade_kg = roundMass(c.quantidade_l || 0);
          }
        }
      }

      // Recarrega vasilhames atuais (após possível revert)
      const vasilhamesAtuais = await entities.vasilhames.list();

      const vasilhameRecords = [];
      for (let destinoIndex = 0; destinoIndex < destinos.length; destinoIndex++) {
        const d = destinos[destinoIndex];
        const comp = destinoCompositions[destinoIndex] || [];

        // IBC / Tambor / Bombona → Vasilhames (placa sintética), sem Estoque
        if (isDestinoEstoqueEmbalado(d.tipo_embalagem)) {
          vasilhameRecords.push(
            buildVasilhameBase(
              payload,
              codigo,
              savedTransbordo,
              d,
              destinoIndex,
              comp
            )
          );
          continue;
        }

        if (!TIPOS_VASILHAME.has(d.tipo_embalagem)) continue;

        // Top-up: vasilhame fracionado já no pátio → atualiza (não cria)
        if (d.tipo_embalagem === "Vasilhame" && d.placa) {
          const existing = findFracionadoNoPatio(vasilhamesAtuais, {
            placa: d.placa,
            barril: d.barril,
            id: d.vasilhame_existente_id,
          });

          if (existing) {
            const addVol = roundVolume(d.volume_total || d.volume || 0);
            const baseComp = seedComposicaoFromVasilhame(existing);
            const baseVol = Math.max(
              roundVolume(existing.volume || 0),
              roundVolume(
                baseComp.reduce((s, c) => s + (c.quantidade_l || 0), 0)
              )
            );
            const newVol = roundVolume(baseVol + addVol);
            const merged = mergeComposicao(baseComp, comp, {
              transbordo_codigo: codigo,
              data: payload.data || null,
            });
            const densV =
              parseDensidade(existing.densidade) || dens;
            const peso = densV > 0 ? roundMass(newVol * densV) : roundMass(
              (existing.peso_liquido || 0) + (d.peso_liquido || addVol * densV)
            );
            const tara = roundMass(d.tara != null && d.tara !== "" ? d.tara : existing.tara || 0);
            // Top-up: se o usuário não marcou fracionado, ou já há múltiplos lotes → completado
            const lotesPosMerge = new Set(
              merged.map((c) => (c.lote || "").trim()).filter(Boolean)
            );
            const aindaFracionado =
              !!d.fracionado && lotesPosMerge.size <= 1;

            const updatedTopUp = await entities.vasilhames.update(existing.id, {
              volume: newVol,
              peso_liquido: peso,
              peso_bruto: roundMass(tara + peso),
              tara,
              composicao: merged,
              lote: getDominantLote(merged),
              fracionado: aindaFracionado,
              numero_op: codigo,
              produto_id: nullIfEmpty(payload.produto_id) || existing.produto_id,
              produto_nome: payload.produto_nome || existing.produto_nome,
              produto_codigo: payload.produto_codigo || existing.produto_codigo,
              cliente_id: nullIfEmpty(payload.cliente_id) || existing.cliente_id,
              cliente_nome: payload.cliente_nome || existing.cliente_nome,
              densidade: payload.densidade || existing.densidade,
              lacres: d.lacres || existing.lacres || "",
              eslinga: d.eslinga || existing.eslinga || "",
              gps: d.gps || existing.gps || "",
              menor_teste: nullIfEmpty(d.menor_teste) || existing.menor_teste,
              responsavel:
                (payload.operadores || []).join(", ") || existing.responsavel,
              status: "No Pátio",
            });
            if (produtoFiltrado) {
              await upsertFiltracaoForVasilhame(
                entities,
                updatedTopUp || {
                  ...existing,
                  volume: newVol,
                  composicao: merged,
                  lote: getDominantLote(merged),
                  produto_id: nullIfEmpty(payload.produto_id) || existing.produto_id,
                  produto_nome: payload.produto_nome || existing.produto_nome,
                  produto_codigo: payload.produto_codigo || existing.produto_codigo,
                  cliente_id: nullIfEmpty(payload.cliente_id) || existing.cliente_id,
                  cliente_nome: payload.cliente_nome || existing.cliente_nome,
                  codigo: existing.codigo || codigo,
                  transbordo_id: existing.transbordo_id || savedTransbordo.id,
                },
                { codigo, transbordo_id: savedTransbordo.id, ...filtroExtras }
              );
            }
            continue;
          }
        }

        vasilhameRecords.push(
          buildVasilhameBase(
            payload,
            codigo,
            savedTransbordo,
            d,
            destinoIndex,
            comp
          )
        );
      }

      if (vasilhameRecords.length > 0) {
        const createdVasilhames = await entities.vasilhames.bulkCreate(vasilhameRecords);
        if (produtoFiltrado && createdVasilhames.length > 0) {
          const filtracaoRecords = createdVasilhames
            .filter(isFiltracaoElegivel)
            .map((v) =>
              buildFiltracaoFromVasilhame(v, {
                codigo,
                transbordo_id: savedTransbordo.id,
                ...filtroExtras,
              })
            );
          if (filtracaoRecords.length > 0) {
            await entities.filtracoes.bulkCreate(filtracaoRecords);
          }
        }
      }

      // Unifica tanques duplicados no pátio (mesma placa)
      const afterSave = await entities.vasilhames.list();
      await unifyDuplicateVasilhames(afterSave, entities);

      // Origem tankagem: baixa volume + composição no vasilhame (parcial ou total)
      await syncTankaVasilhamesAfterOrigem({
        origens,
        destinos,
        dataSaida: payload.data,
        isotanques,
        transbordos,
        editingTransbordoId: editingId || editingTransbordo?.id || null,
        entities,
        vasilhamesList: afterSave,
      });

      // Origem vasilhame: baixa volume e composição por lote
      await syncOrigemVasilhameSaldos({
        origens,
        dens,
        entities,
        vasilhamesList: afterSave,
        dataSaida: payload.data,
      });

      await syncEstoqueSaldos(affectedEstoqueIds);

      await loadData({ silent: true });
      setModalOpen(false);
      setEditingTransbordo(null);
      setActivePrefill(null);
      clearPrefillNavigation();
    } catch (err) {
      console.error("[ChemFlow] Erro ao registrar transbordo:", err);
      setSaveError(
        err?.message ||
          "Não foi possível registrar o transbordo. Verifique os dados e tente novamente."
      );
    }
  };

  const handleDelete = async () => {
    const id = deleteId;
    const toDelete = transbordos.find((t) => t.id === id);
    if (!toDelete) {
      setDeleteId(null);
      return;
    }

    setDeleteId(null);
    setTransbordos((prev) => prev.filter((t) => t.id !== id));

    try {
      const dens = parseDensidade(toDelete.densidade);
      const produtoFiltrado = !!produtos.find(
        (p) => p.id === toDelete.produto_id
      )?.filtrado;

      // IDs de estoque (entrada/embalado) que voltam a ficar disponíveis
      const affectedEstoqueIds = (toDelete.origens || [])
        .filter(
          (o) =>
            (!o.tipo_origem ||
              o.tipo_origem === "entrada" ||
              o.tipo_origem === "embalado") &&
            o.entrada_id
        )
        .map((o) => o.entrada_id);

      // 1) Reverte top-ups em vasilhames fracionados que já existiam
      await revertTopUpsDoTransbordo({
        transbordo: toDelete,
        vasilhamesList: vasilhames,
        densFallback: dens,
        produtoFiltrado,
      });

      // 2) Restaura volume das tankas usadas como origem (se tinham sido zeradas)
      await restoreTankaVasilhamesAfterExclude({
        origens: toDelete.origens || [],
        excludeTransbordoId: toDelete.id,
        isotanques,
        transbordos,
        entities,
        vasilhamesList: vasilhames,
      });

      // 3) Remove embalagens, estoque embalado e filtrações criadas por este transbordo
      await entities.vasilhames.deleteMany({ transbordo_id: id });
      await entities.filtracoes.deleteMany({ transbordo_id: id });
      await deleteEstoqueDoTransbordo(id);

      // 4) Remove o movimento — libera novamente o disponível nas origens de estoque
      await entities.transbordos.delete(id);

      // 5) Recalcula saldo_atual dos estoques de origem
      await syncEstoqueSaldos(affectedEstoqueIds);

      await loadData({ silent: true });
    } catch (err) {
      console.error("[ChemFlow] Erro ao excluir transbordo:", err);
      await loadData({ silent: true });
    }
  };

  const clienteFilterOptions = [
    { id: "all", nome: "Todos os clientes" },
    ...clientes,
  ];

  const totalVolume = filtered.reduce((sum, t) => sum + (t.volume_total || 0), 0);
  const totalMassa = filtered.reduce((sum, t) => sum + (t.massa_total || 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Transbordos</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {transbordos.length} registro(s) cadastrado(s)
            </p>
          </div>
          <Button onClick={handleNew} className="bg-primary hover:bg-primary/90 gap-2">
            <Plus className="w-4 h-4" />
            Novo Transbordo
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por tanka, produto ou cliente..."
              className="pl-10 bg-card"
            />
          </div>
          <div className="w-56">
            <SearchableSelect
              value={clienteFilter}
              onChange={(label) => setClienteFilter(label)}
              options={clienteFilterOptions}
              getOptionLabel={(c) => c.nome}
              getOptionValue={(c) => c.id}
              placeholder="Todos os clientes"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase sticky top-0 z-10">
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">ID</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Data</th>
                <th
                  className="px-4 py-3 font-medium whitespace-nowrap"
                  style={{ width: `${produtoColCh}ch`, maxWidth: `${produtoColCh}ch` }}
                >
                  Produto
                </th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Cliente</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Volume</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Quantidade</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Operadores</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-0">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando transbordos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum transbordo encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((t, i) => {
                  const produtoLabel = `${t.produto_codigo ? `${t.produto_codigo} - ` : ""}${t.produto_nome || "-"}`;
                  const { volume: volumeCell, quantidade: quantidadeCell } =
                    renderTransbordoVolumeQuantidade(t);
                  return (
                  <tr
                    key={t.id}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                      i % 2 === 1 ? "bg-muted/40/30" : ""
                    }`}
                  >
                    <td className="px-4 py-3 align-middle font-medium text-primary whitespace-nowrap">
                      {t.codigo_transbordo || "-"}
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground whitespace-nowrap">
                      {formatDate(t.data)}
                    </td>
                    <td
                      className="px-4 py-3 align-middle text-foreground"
                      style={{ width: `${produtoColCh}ch`, maxWidth: `${produtoColCh}ch` }}
                    >
                      <span className="block truncate" title={produtoLabel}>
                        {produtoLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground whitespace-nowrap w-0">
                      {t.cliente_nome || "-"}
                    </td>
                    <td className="px-4 py-3 align-middle text-foreground font-medium whitespace-nowrap">
                      {volumeCell}
                    </td>
                    <td className="px-4 py-3 align-middle text-foreground font-medium whitespace-nowrap">
                      {quantidadeCell}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-nowrap items-center gap-1 overflow-hidden">
                        {(t.operadores || []).slice(0, 2).map((op) => (
                          <span
                            key={op}
                            className="inline-flex shrink-0 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium whitespace-nowrap"
                          >
                            {op.split(" ")[0]}
                          </span>
                        ))}
                        {(t.operadores || []).length > 2 && (
                          <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                            +{t.operadores.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <button onClick={() => handleView(t)} className="text-muted-foreground hover:text-muted-foreground transition-colors" title="Visualizar">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleEdit(t)} className="text-muted-foreground hover:text-muted-foreground transition-colors" title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteId(t.id)} className="text-red-400 hover:text-red-600 transition-colors" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="flex items-center justify-between gap-6 px-5 py-3 border-t border-border text-sm flex-wrap shrink-0">
          <span className="text-muted-foreground">
            Itens exibidos: <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
          <span className="text-muted-foreground">
            Volume total: <span className="font-medium text-foreground">{formatVolume(totalVolume)} L</span>
          </span>
          <span className="text-muted-foreground">
            Quantidade total: <span className="font-medium text-foreground">{formatMass(totalMassa)} kg</span>
          </span>
        </div>
      </div>

      {/* Modal */}
      <TransbordoModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingTransbordo(null);
          setActivePrefill(null);
          clearPrefillNavigation();
          setReadOnly(false);
          setSaveError("");
        }}
        onSave={handleSave}
        editingTransbordo={editingTransbordo}
        readOnly={readOnly}
        clientes={clientes}
        produtos={produtos}
        entradas={entradas}
        isotanques={isotanques}
        vasilhames={vasilhames}
        transbordos={transbordos}
        prefillEntrada={activePrefill}
        externalError={saveError}
      />

      {/* View Dialog */}
      <TransbordoViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewTransbordo(null);
        }}
        transbordo={viewTransbordo}
        produtos={produtos}
        entradas={entradas}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este transbordo? O volume disponível
              nas origens será restaurado e as embalagens criadas por esta
              operação serão removidas. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cadeia com múltiplos OPs — não permite editar via entrada */}
      <AlertDialog
        open={!!chainBlockMessage}
        onOpenChange={(v) => !v && setChainBlockMessage("")}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edição de transbordo bloqueada</AlertDialogTitle>
            <AlertDialogDescription>{chainBlockMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setChainBlockMessage("")}>
              Entendi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
