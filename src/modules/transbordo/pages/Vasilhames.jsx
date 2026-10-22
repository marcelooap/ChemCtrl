import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { entities } from '@transbordo/services/entities';
import { listProdutos } from '@transbordo/lib/cadastroProdutosCentral';
import { Search, Eye, Pencil, Truck, X, Printer, FileText } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { SelectDot } from "@shared/components/ui/SelectDot";
import { useInternalAuth as useAuth } from "@/lib/InternalAuthContext";
import { generateRelatorioFiscalVasilhamesPDF } from "@transbordo/lib/pdfFiscal";
import { RowActionButton } from "@shared/components/ui/RowActionButton";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import VasilhameModal from "@transbordo/components/vasilhame/VasilhameModal";
import VasilhameViewDialog from "@transbordo/components/vasilhame/VasilhameViewDialog";
import {
  formatVolume,
  formatMass,
  parseDensidade,
  roundVolume,
  roundMass,
  resolveVolumeMassaOperacional,
} from "@transbordo/lib/format";
import {
  applyDeclaredVolumeDecimals,
  persistDeclaredVolumeDecimals,
} from "@transbordo/lib/declaredVolume";
import {
  normalizeVasilhameLote,
  getDominantLote,
  LOTE_APORTE_ANTERIOR,
  collapsedPlacaHealPatch,
  resolveFracionadoFromTransbordos,
  resolveVasilhameLoteDatas,
  applyLoteDatasToComposicao,
  rescaleComposicaoToVolume,
  applyEditedLotesToComposicao,
} from "@transbordo/lib/vasilhameComposicao";
import {
  upsertFiltracaoForVasilhame,
  syncFiltracaoFromVasilhame,
} from "@transbordo/lib/filtracao";
import {
  syncEstoqueSaldos,
  resolveEstoqueIdsFromVasilhame,
  isVasilhameLinkedToEstoque,
  findTransbordosForVasilhame,
  isEstoqueEmbalado,
  getEstoqueUnidadeEntrada,
  isUnidadeVolumeEntrada,
  normalizeUnidadeEntrada,
} from "@transbordo/lib/estoqueSaldo";
import {
  healLinkedLotes,
  syncSaidaLoteDoVasilhame,
} from "@transbordo/lib/cascadeEntradaUpdate";
import {
  isDestinoEmbalagemUnitaria,
  isVasilhameLegadoEmbalado,
  getQuantidadeEmbalagensFromVasilhame,
  getVolumePorEmbalagemFromVasilhame,
  buildPlacaEmbalagens,
} from "@transbordo/lib/tiposEmbalagem";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import PrintContainerLabelDialog from "@industrializacao/components/vasilhames/PrintContainerLabelDialog";
import { resolveProdutoPublicToken } from "@transbordo/lib/ensureProdutoPublicToken";
import {
  collectConvencionalItemsForVasilhame,
  buildVasilhameYardRestorePatch,
  resolveVasilhameExpedidoDisplay,
} from "@transbordo/lib/vasilhamePatio";
import { reconcileVasilhamesFromEntradas } from "@transbordo/lib/syncVasilhamesFromEntrada";

/** Chave de agrupamento por cliente (id, com fallback para o nome). */
function clienteKeyOf(vasilhame) {
  return String(
    vasilhame?.cliente_id || (vasilhame?.cliente_nome || "").trim().toLowerCase() || ""
  );
}

function labelUnidadeEntrada(unidade) {
  const u = normalizeUnidadeEntrada(unidade);
  if (u === "l") return "L";
  if (u === "gal") return "gal";
  if (u === "kg") return "kg";
  if (u === "lb") return "lb";
  return String(unidade || "").trim() || "";
}

/** Resolve se o vasilhame veio de estoque embalado e a UOM da entrada. */
function resolveVasilhameMedida(vasilhame, transbordos = [], estoqueById = null) {
  const composicao = Array.isArray(vasilhame?.composicao)
    ? vasilhame.composicao
    : [];
  if (estoqueById) {
    for (const c of composicao) {
      const est =
        estoqueById.get(c.estoque_id) || estoqueById.get(c.entrada_id);
      if (!est) continue;
      return {
        embalado: isEstoqueEmbalado(est),
        unidade: getEstoqueUnidadeEntrada(est),
      };
    }
  }

  const related = findTransbordosForVasilhame(vasilhame, transbordos);
  for (const t of related) {
    for (const o of t.origens || []) {
      if (o.tipo_origem === "embalado" || o.embalado) {
        return {
          embalado: true,
          unidade: o.unidade_medida || "kg",
        };
      }
      if (
        o.entrada_id &&
        (!o.tipo_origem ||
          o.tipo_origem === "entrada" ||
          o.tipo_origem === "estoque")
      ) {
        const est = estoqueById?.get(o.entrada_id);
        if (est) {
          return {
            embalado: isEstoqueEmbalado(est),
            unidade: getEstoqueUnidadeEntrada(est),
          };
        }
        return {
          embalado: false,
          unidade: o.unidade_medida || "L",
        };
      }
    }
  }

  if (
    isDestinoEmbalagemUnitaria(vasilhame?.tipo) ||
    isVasilhameLegadoEmbalado(vasilhame?.tipo)
  ) {
    return { embalado: true, unidade: "kg" };
  }
  return { embalado: false, unidade: "L" };
}

/** Data da operação (transbordo) que gerou o vasilhame; senão, a data de criação. */
function resolveVasilhameData(vasilhame, transbordos = []) {
  if (!vasilhame) return null;
  if (vasilhame.transbordo_id) {
    const linked = (transbordos || []).find((t) => t.id === vasilhame.transbordo_id);
    if (linked?.data) return linked.data;
  }
  const codigos = new Set(
    [
      vasilhame.numero_op,
      ...(Array.isArray(vasilhame.composicao)
        ? vasilhame.composicao.map((c) => c?.transbordo_codigo)
        : []),
    ]
      .map((c) => String(c || "").trim())
      .filter(Boolean)
  );
  const byCodigo = (transbordos || []).find((t) =>
    codigos.has(String(t.codigo_transbordo || "").trim())
  );
  if (byCodigo?.data) return byCodigo.data;
  const fromComp = (vasilhame.composicao || []).map((c) => c?.data).find(Boolean);
  return fromComp || vasilhame.created_at || vasilhame.created_date || null;
}

function renderVolumeQuantidadeCells(vasilhame, medida) {
  // Fracionado é o destino parcial do tanque (TB), mesmo com mais de um lote na composição.
  const fracionadoBadge = vasilhame.fracionado ? (
    <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-blue-800">
      Fracionado
    </span>
  ) : null;

  const umLabel = labelUnidadeEntrada(medida.unidade);
  const isEmbalado = Boolean(medida.embalado);
  const umIsVolume = isUnidadeVolumeEntrada(medida.unidade);
  const densidade = vasilhame?.densidade;

  if (isEmbalado && !umIsVolume) {
    const massKg =
      Number(vasilhame.peso_liquido) > 0
        ? Number(vasilhame.peso_liquido)
        : Number(vasilhame.volume) || 0;
    const { volume: volL } = resolveVolumeMassaOperacional({
      massa: massKg,
      densidade,
    });
    const qtdTxt =
      massKg > 0
        ? `${formatMass(massKg, { empty: "-" })}${umLabel ? ` ${umLabel}` : ""}`
        : "-";
    const volTxt =
      volL > 0 ? `${formatVolume(volL, { empty: "-" })} L` : "-";
    return {
      volume: <span className="whitespace-nowrap">{volTxt}</span>,
      quantidade: (
        <span className="inline-flex items-center whitespace-nowrap">
          {qtdTxt}
          {fracionadoBadge}
        </span>
      ),
    };
  }

  if (isEmbalado && umIsVolume) {
    const qtdVol = Number(vasilhame.volume) || 0;
    const resolved = resolveVolumeMassaOperacional({
      volume: qtdVol,
      densidade,
    });
    const volTxt =
      qtdVol > 0
        ? `${formatVolume(qtdVol, { empty: "-" })} ${umLabel || "L"}`
        : "-";
    const qtdTxt =
      parseDensidade(densidade) > 0 && resolved.massa > 0
        ? `${formatMass(resolved.massa, { empty: "-" })} kg`
        : volTxt;
    return {
      volume: (
        <span className="inline-flex items-center whitespace-nowrap">
          {volTxt}
          {fracionadoBadge}
        </span>
      ),
      quantidade: <span className="whitespace-nowrap">{qtdTxt}</span>,
    };
  }

  // Granel: volume em L + quantidade em kg
  const resolved = resolveVolumeMassaOperacional({
    volume: Number(vasilhame.volume) || 0,
    massa: Number(vasilhame.peso_liquido) || 0,
    densidade,
  });
  return {
    volume: (
      <span className="inline-flex items-center whitespace-nowrap">
        {resolved.volume > 0
          ? `${formatVolume(resolved.volume, { empty: "-" })} L`
          : "-"}
        {fracionadoBadge}
      </span>
    ),
    quantidade: (
      <span className="whitespace-nowrap">
        {resolved.massa > 0
          ? `${formatMass(resolved.massa, { empty: "-" })} kg`
          : "-"}
      </span>
    ),
  };
}

export default function Vasilhames() {
  const [vasilhames, setVasilhames] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [search, setSearch] = useState("");
  const [clienteFilter, setClienteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVasilhame, setEditingVasilhame] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [viewVasilhame, setViewVasilhame] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [saidaVasilhame, setSaidaVasilhame] = useState(null);
  const [saidaData, setSaidaData] = useState("");
  const [saidaQtdEmbalagens, setSaidaQtdEmbalagens] = useState("");
  const [saidaError, setSaidaError] = useState("");
  const [loading, setLoading] = useState(true);
  const [labelVasilhame, setLabelVasilhame] = useState(null);
  const [transbordos, setTransbordos] = useState([]);
  const [estoqueById, setEstoqueById] = useState(() => new Map());
  const [saidas, setSaidas] = useState([]);
  const { user } = useAuth();
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Itens de saída convencional por vasilhame (para exibir volume/qtd de expedidos).
  const saidaItemsByVasilhame = useMemo(() => {
    const map = new Map();
    for (const saida of saidas) {
      for (const item of saida.itens || []) {
        if (item?.tipo !== "convencional" || !item.vasilhame_id) continue;
        const list = map.get(item.vasilhame_id) || [];
        list.push({ saida, item });
        map.set(item.vasilhame_id, list);
      }
    }
    return map;
  }, [saidas]);
  const loteDatasEdicao = useMemo(
    () =>
      editingVasilhame
        ? resolveVasilhameLoteDatas(editingVasilhame, estoqueById, { transbordos })
        : null,
    [editingVasilhame, estoqueById, transbordos]
  );
  const loteDatasEtiqueta = useMemo(
    () =>
      labelVasilhame
        ? resolveVasilhameLoteDatas(labelVasilhame, estoqueById, { transbordos })
        : null,
    [labelVasilhame, estoqueById, transbordos]
  );
  const [estoqueFilterItem, setEstoqueFilterItem] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const estoqueFilterId = location.state?.estoqueId || null;
  const estoqueFilterCodigo = location.state?.estoqueCodigo || null;

  const clearEstoqueFilter = () => {
    setEstoqueFilterItem(null);
    navigate(location.pathname, { replace: true, state: {} });
  };

  useEffect(() => {
    if (!estoqueFilterId) {
      setEstoqueFilterItem(null);
      return;
    }
    let cancelled = false;
    entities.estoque
      .list()
      .then((list) => {
        if (cancelled) return;
        setEstoqueFilterItem(
          (list || []).find((e) => e.id === estoqueFilterId) || {
            id: estoqueFilterId,
          }
        );
      })
      .catch(() => {
        if (!cancelled) setEstoqueFilterItem({ id: estoqueFilterId });
      });
    return () => {
      cancelled = true;
    };
  }, [estoqueFilterId]);

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      // Migrações/reparos one-shot removidos do mount (Onda 1).
      // unifyDuplicateVasilhames / repairVasilhameComposicao / heal de volume
      // devem rodar via script administrativo, não a cada abertura da tela.

      const [vas, prods, cliens, trans, ests, ents, saidasList] = await Promise.all([
        entities.vasilhames.list("-created_date"),
        listProdutos({ modulo: "ARMAZENAGEM" }),
        entities.clientes.list(),
        entities.transbordos.list(),
        entities.estoque.list(),
        entities.entradas.list(),
        entities.saidas.list("-created_date").catch(() => []),
      ]);
      let vasilhameRows = vas;
      let estoqueRows = ests;
      try {
        const healed = await reconcileVasilhamesFromEntradas({
          entradas: ents,
          estoque: ests,
          vasilhames: vas,
          produtos: prods,
        });
        if (healed.changed) {
          vasilhameRows = healed.vasilhames;
          estoqueRows = healed.estoque;
        }
      } catch (err) {
        console.error("[Transbordo] Falha ao registrar vasilhames da entrada:", err);
      }
      setSaidas(saidasList || []);
      const volumes = applyDeclaredVolumeDecimals({
        estoque: estoqueRows,
        entradas: ents,
        transbordos: trans,
        vasilhames: vasilhameRows,
      });
      void persistDeclaredVolumeDecimals(volumes);
      const vasById = new Map(
        (volumes.vasilhames || []).filter((v) => v?.id).map((v) => [v.id, v])
      );
      setEstoqueById(
        new Map((volumes.estoque || []).filter((e) => e?.id).map((e) => [e.id, e]))
      );

      const produtoFiltrado = new Set(
        (prods || []).filter((p) => p.filtrado).map((p) => p.id)
      );
      const list = [];
      for (const raw of vas || []) {
        const source = vasById.get(raw.id) || raw;
        const patch = collapsedPlacaHealPatch(source, volumes.transbordos);
        if (!patch) {
          list.push(normalizeVasilhameLote(source));
          continue;
        }
        try {
          const updated = await entities.vasilhames.update(raw.id, patch);
          const row = normalizeVasilhameLote({
            ...source,
            ...(updated || {}),
            ...patch,
          });
          if (produtoFiltrado.has(row.produto_id)) {
            await upsertFiltracaoForVasilhame(entities, row, {
              codigo: row.codigo,
              transbordo_id: row.transbordo_id,
            });
          }
          list.push(row);
        } catch (err) {
          console.error("[Transbordo] Falha ao restaurar composição do vasilhame:", err);
          list.push(normalizeVasilhameLote(source));
        }
      }

      let aligned = list;
      let alignedTransbordos = volumes.transbordos;
      try {
        const healed = await healLinkedLotes({
          estoqueRows: volumes.estoque,
          transbordos: volumes.transbordos,
          vasilhames: list,
        });
        aligned = (healed.vasilhames || list).map((row) =>
          normalizeVasilhameLote(row)
        );
        alignedTransbordos = healed.transbordos || volumes.transbordos;
      } catch (err) {
        console.error("[Transbordo] Falha ao alinhar lote dos vasilhames:", err);
      }

      const withFracionado = [];
      for (const row of aligned) {
        const noPatio =
          (row.tipo || "Vasilhame") === "Vasilhame" &&
          (row.status || "No Pátio") === "No Pátio" &&
          !row.data_saida;
        const fracionado = noPatio
          ? resolveFracionadoFromTransbordos(row, alignedTransbordos)
          : !!row.fracionado;
        if (!noPatio || Boolean(row.fracionado) === fracionado) {
          withFracionado.push(row);
          continue;
        }
        const next = { ...row, fracionado };
        try {
          await entities.vasilhames.update(row.id, { fracionado });
          if (!fracionado && produtoFiltrado.has(next.produto_id)) {
            await upsertFiltracaoForVasilhame(entities, next, {
              codigo: next.codigo,
              transbordo_id: next.transbordo_id,
            });
          }
        } catch (err) {
          console.error("[Transbordo] Falha ao alinhar fracionado do vasilhame:", err);
        }
        withFracionado.push(next);
      }

      setTransbordos(alignedTransbordos);
      setVasilhames(withFracionado);
      setProdutos(prods);
      setClientes(cliens);
    } catch {
      if (!silent) setVasilhames([]);
    }
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = vasilhames.filter((v) => {
    // Tankagem fica só na tela de Tankagem
    if ((v.tipo || "") === "Tankagem") return false;

    if (estoqueFilterId) {
      if (!estoqueFilterItem) return false;
      if (
        !isVasilhameLinkedToEstoque(v, estoqueFilterItem, {
          transbordos,
          vasilhames,
        })
      ) {
        return false;
      }
    }

    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      v.codigo?.toLowerCase().includes(q) ||
      v.placa?.toLowerCase().includes(q) ||
      v.barril?.toLowerCase().includes(q) ||
      v.produto_nome?.toLowerCase().includes(q) ||
      v.cliente_nome?.toLowerCase().includes(q) ||
      v.lote?.toLowerCase().includes(q);

    const matchCliente =
      !clienteFilter ||
      clienteFilter === "Todos os clientes" ||
      v.cliente_nome === clienteFilter;

    const matchStatus =
      !statusFilter ||
      statusFilter === "Todos" ||
      (v.status || "No Pátio") === statusFilter;

    return matchSearch && matchCliente && matchStatus;
  });

  const formatDate = (d) => {
    if (!d) return "-";
    const raw = String(d);
    const date = raw.includes("T")
      ? new Date(raw)
      : new Date(`${raw.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("pt-BR");
  };

  const handleEdit = (v) => {
    setEditingVasilhame(v);
    setReadOnly(false);
    setModalOpen(true);
  };

  const handleView = (v) => {
    setViewVasilhame(v);
    setViewOpen(true);
  };

  const handlePrintLabel = (v) => {
    if (!v?.id) return;
    setLabelVasilhame(v);
  };

  // A baixa da expedição zera volume e peso no cadastro. A grade recupera o
  // conteúdo (snapshot da saída, composição ou volume do tanque na OP); a
  // etiqueta precisa desse mesmo volume, senão o campo abre em zero e os
  // pesos líquido/bruto ficam em branco.
  const labelResolved = labelVasilhame
    ? resolveVasilhameExpedidoDisplay(labelVasilhame, {
        linkedItems: saidaItemsByVasilhame.get(labelVasilhame.id) || [],
        transbordos,
      })
    : null;

  const labelContainer = labelResolved
    ? {
        id: labelResolved.id,
        product: labelResolved.produto_nome || "—",
        lot:
          String(labelResolved.lote || "").trim() ||
          getDominantLote(labelResolved.composicao) ||
          "—",
        client: labelResolved.cliente_nome,
        op_number: labelResolved.codigo || "—",
        container_number: labelResolved.placa || "",
        barril_number: labelResolved.barril || "",
        type: labelResolved.tipo || "",
        volume: labelResolved.volume,
        tare: labelResolved.tara || 0,
        net_weight: labelResolved.peso_liquido,
        gross_weight: labelResolved.peso_bruto,
        created_date: labelResolved.created_at || labelResolved.created_date,
      }
    : null;

  const labelDensity = (() => {
    if (!labelResolved) return undefined;
    const dens = parseDensidade(labelResolved.densidade);
    if (dens > 0) return dens;
    const vol = Number(labelResolved.volume) || 0;
    const net = Number(labelResolved.peso_liquido) || 0;
    if (vol > 0 && net > 0) return net / vol;
    return undefined;
  })();

  const syncEstoqueFromVasilhame = async (vasilhame) => {
    if (!vasilhame) return;
    try {
      const [transbordos, estoqueList] = await Promise.all([
        entities.transbordos.list(),
        entities.estoque.list(),
      ]);
      const ids = resolveEstoqueIdsFromVasilhame(
        vasilhame,
        transbordos,
        estoqueList
      );
      if (ids.length > 0) {
        await syncEstoqueSaldos(ids);
      }
    } catch (err) {
      console.warn("[ChemFlow] Sync saldo após saída de vasilhame:", err);
    }
  };

  const handleSave = async (data) => {
    const prevExpedido =
      editingVasilhame &&
      ((editingVasilhame.status || "") === "Expedido" ||
        (editingVasilhame.data_saida != null &&
          String(editingVasilhame.data_saida).trim() !== ""));
    const nextExpedido =
      (data?.status || "") === "Expedido" ||
      (data?.data_saida != null && String(data.data_saida).trim() !== "");

    let saved = editingVasilhame;
    let volumeChanged = false;
    if (editingVasilhame) {
      // Fabricação/validade não são colunas do vasilhame: ficam na composição do lote.
      const {
        data_fabricacao: nextFabricacao,
        data_validade: nextValidade,
        lotes: _lotesForm,
        ...vasilhameData
      } = data;
      let payload = { ...vasilhameData };
      const newLote = String(data?.lote ?? "").trim();
      const oldLote = String(editingVasilhame.lote || "").trim();
      const lotesEditados = Array.isArray(data?.lotes) ? data.lotes : [];
      const multiLote = lotesEditados.length > 1;
      let lotesRenamed = false;
      const densChanged =
        String(data?.densidade ?? "") !== String(editingVasilhame.densidade ?? "");

      // Vários lotes: cada linha edita o próprio lote e volume, sem ratear um no outro.
      if (multiLote) {
        const nextComp = applyEditedLotesToComposicao(
          editingVasilhame.composicao,
          lotesEditados,
          data.densidade ?? editingVasilhame.densidade
        );
        const volumeFinal = roundVolume(
          nextComp.reduce((s, c) => s + (Number(c.quantidade_l) || 0), 0)
        );
        const dens = parseDensidade(data.densidade ?? editingVasilhame.densidade);
        const pesoLiq =
          dens > 0
            ? roundMass(volumeFinal * dens)
            : roundMass(
                nextComp.reduce((s, c) => s + (Number(c.quantidade_kg) || 0), 0)
              );
        const taraFinal = roundMass(data.tara ?? editingVasilhame.tara ?? 0);
        lotesRenamed = lotesEditados.some(
          (l) => String(l.lote || "").trim() !== String(l.lote_original || "").trim()
        );
        const prevByLote = new Map();
        for (const c of editingVasilhame.composicao || []) {
          const key = String(c.lote || "").trim();
          prevByLote.set(key, (prevByLote.get(key) || 0) + (Number(c.quantidade_l) || 0));
        }
        if (dens > 0 && nextComp.length > 0) {
          const kgAlvo = pesoLiq;
          const kgAtual = nextComp.reduce((s, c) => s + (Number(c.quantidade_kg) || 0), 0);
          const diffKg = kgAlvo - kgAtual;
          if (diffKg !== 0) {
            let idx = 0;
            nextComp.forEach((c, i) => {
              if ((c.quantidade_kg || 0) > (nextComp[idx].quantidade_kg || 0)) idx = i;
            });
            nextComp[idx] = {
              ...nextComp[idx],
              quantidade_kg: Math.max(0, roundMass((nextComp[idx].quantidade_kg || 0) + diffKg)),
            };
          }
        }
        volumeChanged = lotesEditados.some(
          (l) =>
            roundVolume(l.volume) !==
            roundVolume(prevByLote.get(String(l.lote_original || "").trim()) || 0)
        );
        payload = {
          ...payload,
          composicao: nextComp,
          lote: getDominantLote(nextComp) || newLote || null,
          volume: volumeFinal,
          peso_liquido: pesoLiq,
          peso_bruto: roundMass(taraFinal + pesoLiq),
        };
      }

      // Lote da tela é o campo editável; a composição precisa acompanhar,
      // senão loadData/normalizeVasilhameLote reverte pelo lote dominante.
      if (!multiLote && newLote !== oldLote) {
        const prevComp = Array.isArray(editingVasilhame.composicao)
          ? editingVasilhame.composicao
          : [];
        const uniqueLotes = new Set(
          prevComp
            .map((c) => String(c.lote || "").trim())
            .filter(Boolean)
        );
        let nextComp;
        if (prevComp.length === 0) {
          const vol = Number(data.volume ?? editingVasilhame.volume) || 0;
          nextComp = newLote
            ? [
                {
                  lote: newLote,
                  lote_manual: true,
                  quantidade_l: vol,
                  quantidade_kg:
                    Number(data.peso_liquido ?? editingVasilhame.peso_liquido) ||
                    0,
                  estoque_id:
                    editingVasilhame.composicao?.[0]?.estoque_id || null,
                  entrada_id:
                    editingVasilhame.composicao?.[0]?.entrada_id || null,
                  transbordo_codigo:
                    editingVasilhame.numero_op ||
                    editingVasilhame.codigo ||
                    null,
                },
              ]
            : [];
        } else if (uniqueLotes.size <= 1) {
          nextComp = prevComp.map((c) => ({ ...c, lote: newLote, lote_manual: true }));
        } else {
          nextComp = prevComp.map((c) => {
            const cl = String(c.lote || "").trim();
            if (!oldLote || cl === oldLote) {
              return { ...c, lote: newLote, lote_manual: true };
            }
            return c;
          });
        }
        payload = { ...payload, lote: newLote || null, composicao: nextComp };
      }

      // Volume editado: a composição por lote acompanha (peso líquido/bruto já vêm
      // recalculados do modal) para o saldo por lote continuar coerente.
      if (!multiLote) {
        volumeChanged =
          roundVolume(data.volume ?? 0) !== roundVolume(editingVasilhame.volume ?? 0);
      }
      if (!multiLote && volumeChanged) {
        payload = {
          ...payload,
          composicao: rescaleComposicaoToVolume(
            payload.composicao ?? editingVasilhame.composicao,
            data.volume,
            data.densidade ?? editingVasilhame.densidade
          ),
        };
      }

      // Só persiste as datas que o usuário realmente alterou (evita copiar o estoque).
      const datasAtuais = resolveVasilhameLoteDatas(editingVasilhame, estoqueById, {
        transbordos,
      });
      const datasPatch = {};
      if (String(nextFabricacao || "") !== datasAtuais.data_fabricacao) {
        datasPatch.data_fabricacao = nextFabricacao || "";
      }
      if (String(nextValidade || "") !== datasAtuais.data_validade) {
        datasPatch.data_validade = nextValidade || "";
      }
      if (Object.keys(datasPatch).length > 0) {
        payload = {
          ...payload,
          composicao: applyLoteDatasToComposicao(
            payload.composicao ?? editingVasilhame.composicao,
            newLote || oldLote,
            datasPatch,
            {
              quantidade_l: Number(data.volume ?? editingVasilhame.volume) || 0,
              quantidade_kg:
                Number(data.peso_liquido ?? editingVasilhame.peso_liquido) || 0,
              transbordo_codigo:
                editingVasilhame.numero_op || editingVasilhame.codigo || null,
            }
          ),
        };
      }

      if (prevExpedido && !nextExpedido) {
        try {
          const [saidasList, trans] = await Promise.all([
            entities.saidas.list("-created_date"),
            entities.transbordos.list(),
          ]);
          const linked = collectConvencionalItemsForVasilhame(
            saidasList,
            editingVasilhame.id
          );
          const restore = buildVasilhameYardRestorePatch(editingVasilhame, {
            linkedItems: linked,
            transbordos: trans,
          });
          if (restore) {
            payload = {
              ...payload,
              ...restore,
              volume:
                Number(payload.volume) > 0 ? payload.volume : restore.volume,
              peso_liquido:
                Number(payload.peso_liquido) > 0
                  ? payload.peso_liquido
                  : restore.peso_liquido,
              peso_bruto:
                Number(payload.peso_bruto) > 0
                  ? payload.peso_bruto
                  : restore.peso_bruto,
              // Não deixa o restore apagar o lote/composição recém-editados
              lote: payload.lote,
              ...(payload.composicao ? { composicao: payload.composicao } : {}),
            };
          }
        } catch (restoreErr) {
          console.warn("[ChemFlow] Restore pátio (edit):", restoreErr);
        }
      }
      try {
        await entities.vasilhames.update(editingVasilhame.id, payload);
      } catch (err) {
        const msg = String(err?.message || "");
        if (/observacao/i.test(msg)) {
          throw new Error(
            "Execute o script 045_t_vasilhames_observacao.sql no SQL Editor do Supabase para gravar a observação."
          );
        }
        throw err;
      }
      saved = { ...editingVasilhame, ...payload };
      const produtoChanged =
        String(saved.produto_id || "") !== String(editingVasilhame.produto_id || "") ||
        String(saved.produto_nome || "").trim() !==
          String(editingVasilhame.produto_nome || "").trim() ||
        String(saved.produto_codigo || "").trim() !==
          String(editingVasilhame.produto_codigo || "").trim();
      const produtoNovoFiltrado = (produtos || []).some(
        (p) => p.filtrado && String(p.id) === String(saved.produto_id || "")
      );
      const identificacaoChanged =
        String(saved.placa || "").trim() !==
          String(editingVasilhame.placa || "").trim() ||
        String(saved.barril || "").trim() !==
          String(editingVasilhame.barril || "").trim();
      if (multiLote) {
        const renomes = lotesEditados.filter(
          (l) => String(l.lote || "").trim() !== String(l.lote_original || "").trim()
        );
        for (const item of renomes) {
          try {
            await syncSaidaLoteDoVasilhame(
              editingVasilhame.id,
              String(item.lote_original || "").trim(),
              String(item.lote || "").trim()
            );
          } catch (err) {
            console.error("[Transbordo] Falha ao atualizar lote nas saídas:", err);
          }
        }
      } else if (newLote !== oldLote) {
        try {
          await syncSaidaLoteDoVasilhame(editingVasilhame.id, oldLote, newLote);
        } catch (err) {
          console.error("[Transbordo] Falha ao atualizar lote nas saídas:", err);
        }
      }
      const deixouDeSerFracionado =
        editingVasilhame.fracionado === true && saved.fracionado !== true;
      const refletirNaFiltracao =
        saved.fracionado !== true &&
        (deixouDeSerFracionado ||
          volumeChanged ||
          lotesRenamed ||
          produtoChanged ||
          identificacaoChanged ||
          (multiLote && densChanged) ||
          (!multiLote && newLote !== oldLote));
      if (refletirNaFiltracao) {
        try {
          const existentes = await entities.filtracoes.filter({
            vasilhame_id: editingVasilhame.id,
          });
          if (existentes.length > 0) {
            await entities.filtracoes.update(
              existentes[0].id,
              syncFiltracaoFromVasilhame(saved)
            );
          } else if (
            produtoNovoFiltrado &&
            (produtoChanged || deixouDeSerFracionado)
          ) {
            await upsertFiltracaoForVasilhame(entities, saved, {
              codigo: saved.codigo,
              transbordo_id: saved.transbordo_id,
            });
          }
        } catch (err) {
          console.error("[Transbordo] Falha ao atualizar filtração do vasilhame:", err);
        }
      }
      if (multiLote && densChanged) volumeChanged = true;
    } else {
      return;
    }

    if (volumeChanged || prevExpedido !== nextExpedido || nextExpedido) {
      await syncEstoqueFromVasilhame(saved);
    }

    await loadData({ silent: true });
    setModalOpen(false);
    setEditingVasilhame(null);
  };

  const handleSaida = (v) => {
    setSaidaVasilhame(v);
    setSaidaData(v.data_saida || new Date().toISOString().split("T")[0]);
    const qtd = getQuantidadeEmbalagensFromVasilhame(v);
    setSaidaQtdEmbalagens(qtd > 0 ? String(qtd) : "");
    setSaidaError("");
  };

  const handleSaidaSave = async () => {
    if (!saidaVasilhame) return;
    try {
      const reverting =
        saidaData == null || String(saidaData).trim() === "";
      let updatedVasilhame = { ...saidaVasilhame };

      // Remover data de saída → No Pátio + restaurar volume/peso
      if (reverting) {
        const [saidasList, trans] = await Promise.all([
          entities.saidas.list("-created_date"),
          entities.transbordos.list(),
        ]);
        const linked = collectConvencionalItemsForVasilhame(
          saidasList,
          saidaVasilhame.id
        );
        const patch =
          buildVasilhameYardRestorePatch(saidaVasilhame, {
            linkedItems: linked,
            transbordos: trans,
          }) || {
            status: "No Pátio",
            data_saida: null,
          };
        await entities.vasilhames.update(saidaVasilhame.id, patch);
        updatedVasilhame = { ...saidaVasilhame, ...patch };
        await syncEstoqueFromVasilhame(updatedVasilhame);
        await loadData({ silent: true });
        setSaidaVasilhame(null);
        setSaidaData("");
        setSaidaQtdEmbalagens("");
        setSaidaError("");
        return;
      }

      const isUnitario = isDestinoEmbalagemUnitaria(saidaVasilhame.tipo);
      const qtdAtual = getQuantidadeEmbalagensFromVasilhame(saidaVasilhame);
      const qtdSaida = Math.round(Number(saidaQtdEmbalagens) || 0);

      if (isUnitario) {
        if (qtdSaida <= 0) {
          setSaidaError("Informe a quantidade de embalagens da saída.");
          return;
        }
        if (qtdAtual > 0 && qtdSaida > qtdAtual) {
          setSaidaError(
            `Quantidade máxima disponível: ${qtdAtual} embalagem(ns).`
          );
          return;
        }

        const volPorEmb =
          getVolumePorEmbalagemFromVasilhame(saidaVasilhame) ||
          (qtdAtual > 0
            ? roundVolume((saidaVasilhame.volume || 0) / qtdAtual)
            : 0);
        const dens =
          parseFloat(
            String(saidaVasilhame.densidade || "0").replace(",", ".")
          ) || 0;
        const restante = Math.max(0, (qtdAtual || qtdSaida) - qtdSaida);

        if (restante <= 0) {
          const patch = {
            data_saida: saidaData,
            status: "Expedido",
            volume: 0,
            peso_liquido: 0,
            peso_bruto: roundMass(saidaVasilhame.tara || 0),
            placa: buildPlacaEmbalagens(0, saidaVasilhame.tipo),
            // Mantém quantidade_l/kg na composição para baixa de estoque / auditoria
            composicao: (saidaVasilhame.composicao || []).map((c, i) =>
              i === 0 ? { ...c, quantidade_embalagens: 0 } : c
            ),
          };
          await entities.vasilhames.update(saidaVasilhame.id, patch);
          updatedVasilhame = { ...saidaVasilhame, ...patch };
        } else {
          const newVol = roundVolume(restante * volPorEmb);
          const newPeso =
            dens > 0
              ? roundMass(newVol * dens)
              : roundMass(
                  ((saidaVasilhame.peso_liquido || 0) * restante) /
                    (qtdAtual || restante)
                );
          const tara = roundMass(saidaVasilhame.tara || 0);
          const patch = {
            data_saida: null,
            status: "No Pátio",
            volume: newVol,
            peso_liquido: newPeso,
            peso_bruto: roundMass(tara + newPeso),
            placa: buildPlacaEmbalagens(restante, saidaVasilhame.tipo),
            composicao: (saidaVasilhame.composicao || []).map((c, i) =>
              i === 0
                ? {
                    ...c,
                    quantidade_embalagens: restante,
                    quantidade_l: newVol,
                    quantidade_kg: newPeso,
                    volume_por_embalagem: volPorEmb,
                  }
                : c
            ),
          };
          await entities.vasilhames.update(saidaVasilhame.id, patch);
          updatedVasilhame = { ...saidaVasilhame, ...patch };
        }
      } else {
        const patch = {
          data_saida: saidaData,
          status: "Expedido",
        };
        await entities.vasilhames.update(saidaVasilhame.id, patch);
        updatedVasilhame = { ...saidaVasilhame, ...patch };
      }

      // Abate/restaura saldo do estoque de origem (ex.: E012 via OP T008)
      await syncEstoqueFromVasilhame(updatedVasilhame);

      await loadData({ silent: true });
      setSaidaVasilhame(null);
      setSaidaData("");
      setSaidaQtdEmbalagens("");
      setSaidaError("");
    } catch {
      setSaidaError("Não foi possível registrar a saída. Tente novamente.");
    }
  };

  const selectedVasilhames = vasilhames.filter((v) => selectedIds.has(v.id));
  const selectedClienteKey = selectedVasilhames.length
    ? clienteKeyOf(selectedVasilhames[0])
    : null;

  const toggleSelected = (v) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(v.id)) next.delete(v.id);
      else next.add(v.id);
      return next;
    });
  };

  const handleRelatorioFiscal = () => {
    if (selectedVasilhames.length === 0) return;
    const resolved = selectedVasilhames.map((v) =>
      resolveVasilhameExpedidoDisplay(v, {
        linkedItems: saidaItemsByVasilhame.get(v.id) || [],
        transbordos,
      })
    );
    generateRelatorioFiscalVasilhamesPDF(resolved, {
      responsavel: user?.nome || user?.full_name || "",
    });
  };

  const clienteFilterOptions = [{ id: "all", nome: "Todos os clientes" }, ...clientes];
  const statusFilterOptions = [
    { value: "Todos", label: "Todos" },
    { value: "No Pátio", label: "No Pátio" },
    { value: "Expedido", label: "Expedido" },
  ];

  const noPatio = vasilhames.filter(
    (v) =>
      (v.tipo || "") !== "Tankagem" &&
      (v.status || "No Pátio") === "No Pátio"
  );
  const volumePatio = noPatio.reduce((sum, v) => sum + (v.volume || 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Vasilhames</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{vasilhames.length} embalagem(ns)</p>
          </div>
          {selectedVasilhames.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {selectedVasilhames.length} selecionado(s)
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
              >
                Limpar
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-primary hover:bg-primary/90"
                onClick={handleRelatorioFiscal}
              >
                <FileText className="w-4 h-4 mr-1.5" />
                Relatório Fiscal
              </Button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar produto, nº placa, nº barril, cliente..."
              className="pl-10 bg-card"
            />
          </div>
          {estoqueFilterId && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
              Estoque {estoqueFilterCodigo || estoqueFilterId}
              <button
                type="button"
                onClick={clearEstoqueFilter}
                className="hover:text-primary/80"
                title="Limpar filtro de estoque"
                aria-label="Limpar filtro de estoque"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="w-48">
            <SearchableSelect
              value={statusFilter}
              onChange={(label) => setStatusFilter(label)}
              options={statusFilterOptions}
              getOptionLabel={(o) => o.label}
              getOptionValue={(o) => o.value}
              placeholder="Todos"
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
                <th className="w-10 pl-4 pr-0 py-3 font-medium">
                  <span className="sr-only">Selecionar</span>
                </th>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Nº Placa</th>
                <th className="px-4 py-3 font-medium">Nº Barril</th>
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Produto</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Volume</th>
                <th className="px-4 py-3 font-medium">Quantidade</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Data Saída</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-muted-foreground">
                    Carregando vasilhames...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-muted-foreground">
                    Nenhum vasilhame encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((v, i) => {
                  const status = v.status || (v.data_saida ? "Expedido" : "No Pátio");
                  const medida = resolveVasilhameMedida(v, transbordos, estoqueById);
                  const { volume: volumeCell, quantidade: quantidadeCell } =
                    renderVolumeQuantidadeCells(
                      resolveVasilhameExpedidoDisplay(v, {
                        linkedItems: saidaItemsByVasilhame.get(v.id) || [],
                        transbordos,
                      }),
                      medida
                    );
                  return (
                    <tr
                      key={v.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${
                        i % 2 === 1 ? "bg-muted/40/30" : ""
                      }`}
                    >
                      <td className="w-10 pl-4 pr-0 py-3">
                        <SelectDot
                          checked={selectedIds.has(v.id)}
                          disabled={
                            selectedClienteKey != null &&
                            !selectedIds.has(v.id) &&
                            clienteKeyOf(v) !== selectedClienteKey
                          }
                          onClick={() => toggleSelected(v)}
                          label={
                            selectedClienteKey != null &&
                            !selectedIds.has(v.id) &&
                            clienteKeyOf(v) !== selectedClienteKey
                              ? "Só é possível selecionar vasilhames do mesmo cliente"
                              : `Selecionar ${v.codigo || "vasilhame"}`
                          }
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-primary">{v.codigo || "-"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatDate(resolveVasilhameData(v, transbordos))}
                      </td>
                      <td className="px-4 py-3 text-foreground">{v.placa || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.barril || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.produto_codigo || "-"}</td>
                      <td className="px-4 py-3 text-foreground">{v.produto_nome || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.cliente_nome || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {(() => {
                          const displayLote =
                            (v.lote || "").trim() ||
                            getDominantLote(v.composicao) ||
                            "-";
                          const uniqueLotes = new Set(
                            (v.composicao || [])
                              .map((c) => (c.lote || "").trim())
                              .filter(
                                (l) => l && l !== LOTE_APORTE_ANTERIOR
                              )
                          ).size;
                          return (
                            <span className="inline-flex items-center gap-1.5">
                              <span>{displayLote}</span>
                              {uniqueLotes > 1 && (
                                <span
                                  className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700"
                                  title="Vários lotes — veja o detalhe"
                                >
                                  +{uniqueLotes - 1}
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium whitespace-nowrap">
                        {volumeCell}
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium">
                        {quantidadeCell}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                            status === "No Pátio" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                          }`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(v.data_saida)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <RowActionButton onClick={() => handleView(v)} title="Visualizar">
                            <Eye />
                          </RowActionButton>
                          <RowActionButton onClick={() => handlePrintLabel(v)} title="Imprimir etiqueta">
                            <Printer />
                          </RowActionButton>
                          <RowActionButton onClick={() => handleEdit(v)} title="Editar">
                            <Pencil />
                          </RowActionButton>
                          <RowActionButton tone="success" onClick={() => handleSaida(v)} title="Lançar Saída">
                            <Truck />
                          </RowActionButton>
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
        <div className="flex items-center justify-between gap-6 px-4 py-3 border-t border-border text-sm flex-wrap shrink-0">
          <span className="text-muted-foreground">
            Vasilhames no pátio: <span className="font-medium text-foreground">{noPatio.length}</span>
          </span>
          <span className="text-muted-foreground">
            Volume total no pátio: <span className="font-medium text-foreground">{formatVolume(volumePatio)} L</span>
          </span>
          <span className="text-muted-foreground">
            Total exibido: <span className="font-medium text-foreground">{filtered.length}</span>
          </span>
        </div>
      </div>

      {/* Modal */}
      <VasilhameModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingVasilhame(null);
          setReadOnly(false);
        }}
        onSave={handleSave}
        editingVasilhame={editingVasilhame}
        readOnly={readOnly}
        clientes={clientes}
        produtos={produtos}
        loteDatas={loteDatasEdicao}
        vasilhames={vasilhames}
      />

      {/* View Dialog */}
      <VasilhameViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewVasilhame(null);
        }}
        vasilhame={viewVasilhame}
        saidas={saidas}
        transbordos={transbordos}
      />

      {/* Saída Dialog */}
      <Dialog
        open={!!saidaVasilhame}
        onOpenChange={(v) => {
          if (!v) {
            setSaidaVasilhame(null);
            setSaidaError("");
            setSaidaQtdEmbalagens("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lançar Saída</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {saidaError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {saidaError}
              </p>
            )}
            {saidaVasilhame && isDestinoEmbalagemUnitaria(saidaVasilhame.tipo) && (
              <div className="space-y-1.5">
                <Label>Quantidade de embalagens *</Label>
                <NumberInputBr
                  decimals={0}
                  min={1}
                  max={
                    getQuantidadeEmbalagensFromVasilhame(saidaVasilhame) ||
                    undefined
                  }
                  value={saidaQtdEmbalagens}
                  onChange={(v) =>
                    setSaidaQtdEmbalagens(v === "" ? "" : String(v))
                  }
                  placeholder="0"
                  className="bg-white"
                />
                <p className="text-xs text-muted-foreground">
                  Disponível:{" "}
                  {getQuantidadeEmbalagensFromVasilhame(saidaVasilhame) || "—"}{" "}
                  · {saidaVasilhame.placa || saidaVasilhame.tipo}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Data de Saída</Label>
              <Input
                type="date"
                value={saidaData}
                onChange={(e) => setSaidaData(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {saidaVasilhame &&
                isDestinoEmbalagemUnitaria(saidaVasilhame.tipo)
                  ? "Informe quantas embalagens sairão. Se for a quantidade total, o status muda para Expedido."
                  : "Ao definir uma data, o status muda para 'Expedido'. Remova a data para reverter para 'No Pátio'."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSaidaVasilhame(null);
                setSaidaError("");
                setSaidaQtdEmbalagens("");
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-primary hover:bg-primary/90"
              onClick={handleSaidaSave}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PrintContainerLabelDialog
        key={labelVasilhame?.id || 'closed'}
        open={!!labelVasilhame}
        onOpenChange={(v) => { if (!v) setLabelVasilhame(null); }}
        container={labelContainer}
        density={labelDensity}
        contexto="convencional"
        clienteId={labelVasilhame?.cliente_id}
        clienteNome={labelVasilhame?.cliente_nome}
        manufactureDate={loteDatasEtiqueta?.data_fabricacao || undefined}
        expiryDate={loteDatasEtiqueta?.data_validade || undefined}
        resolvePublicToken={
          labelVasilhame
            ? () => resolveProdutoPublicToken({
                produtoId: labelVasilhame.produto_id,
                codigo: labelVasilhame.produto_codigo,
                nome: labelVasilhame.produto_nome,
              }).catch(() => null)
            : undefined
        }
      />
    </div>
  );
}