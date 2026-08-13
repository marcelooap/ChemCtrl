import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
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
import { Plus, AlertCircle, CheckCircle2, X, ChevronDown } from "lucide-react";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import OrigemCard from "./OrigemCard";
import DestinoCard from "./DestinoCard";
import {
  formatVolume,
  formatMass,
  parseDensidade,
  roundVolume,
  roundMass,
  kgLotesToLitrosInteiros,
} from "@transbordo/lib/format";
import { loteToKg, loteToLitros, saldoKgToLitros, applyPesoLiquidoForaMargem } from "@transbordo/lib/conversao";
import {
  computeDisponivelTransbordo,
  isEstoqueEmbalado,
  isUnidadeMassaEntrada,
} from "@transbordo/lib/estoqueSaldo";
import {
  findAllLinkedTransbordos,
  multipleTransbordosMessage,
} from "@transbordo/lib/findLinkedTransbordo";
import { buildEstoqueDisplayCodigoMap } from "@transbordo/lib/entradaCodigo";
import {
  computeTankaSaldo,
  computeTankaLotesDisponiveis,
} from "@transbordo/lib/tankaVolume";
import {
  aggregateComposicaoByLote,
  seedComposicaoFromVasilhame,
} from "@transbordo/lib/vasilhameComposicao";
import { isDestinoEstoqueEmbalado } from "@transbordo/lib/tiposEmbalagem";

const INPUT_EDITABLE = "bg-white";

/** UID estável na sessão do formulário (não confundir com composicao.origem_index do FIFO). */
function createClientUid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `uid_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function ensureOrigemUids(origens = []) {
  return (origens || []).map((o) =>
    o?._uid ? o : { ...o, _uid: createClientUid() }
  );
}

/**
 * Garante origem_uid em cada destino.
 * Registros legados (sem vínculo) ficam associados à primeira origem.
 */
function linkDestinosToOrigens(destinos = [], origens = []) {
  const firstUid = origens[0]?._uid;
  return (destinos || []).map((d) => ({
    ...d,
    origem_uid: d.origem_uid || firstUid || createClientUid(),
  }));
}

function destinoItemLabel(d) {
  if (d.tipo_embalagem === "Vasilhame") {
    const parts = [d.placa, d.barril].filter(Boolean);
    return parts.length ? parts.join(" / ") : "vasilhame";
  }
  if (d.tipo_embalagem === "Tankagem") {
    return d.tanka_codigo || "tanka";
  }
  if (d.tipo_embalagem) {
    const qtd = d.quantidade_embalagens;
    return qtd > 0
      ? `${d.tipo_embalagem} (${qtd})`
      : d.tipo_embalagem;
  }
  return "item";
}

function destinoMassaKg(d, dens) {
  const vol = roundVolume(d.volume_total || d.volume || 0);
  if (d.peso_liquido != null && d.peso_liquido > 0) {
    return roundMass(d.peso_liquido);
  }
  return roundMass(dens > 0 ? vol * dens : 0);
}

const OPERADORES = [
  "Adriano Q.",
  "Leonardo S.",
  "Rafael N.",
  "Mariano",
  "Ezequiel F.",
  "Wandre C.",
];

const createdAt = (row) => row?.created_at || row?.created_date || 0;

function collapseMap(items = []) {
  return Object.fromEntries(items.map((_, i) => [i, true]));
}

/**
 * Atualiza cabeçalho/lotes do OP com a entrada recém-salva,
 * preservando destinos e volumes já lançados no transbordo.
 */
function applyPrefillIdentity(transbordo, prefill) {
  if (!transbordo || !prefill) return transbordo;

  const dens = parseDensidade(prefill.densidade);
  const savedEstoques = prefill.savedEstoques || prefill.savedEntradas || [];
  const loteByEstoqueId = new Map(
    savedEstoques
      .filter((e) => e?.id)
      .map((e) => [e.id, e.lote || ""])
  );

  const entradaLotes =
    prefill.lotes && prefill.lotes.length > 0
      ? prefill.lotes
      : [{ lote: prefill.lote || "" }];

  const nextOrigens = (transbordo.origens || []).map((o) => {
    const next = {
      ...o,
      tipo_origem: o.tipo_origem || (o.entrada_id ? "entrada" : o.tipo_origem),
    };
    if (o.entrada_id && loteByEstoqueId.has(o.entrada_id)) {
      const newLote = loteByEstoqueId.get(o.entrada_id);
      if (newLote) {
        const oldLote = o.lote || "";
        next.lote = newLote;
        if (oldLote && next.entrada_codigo) {
          next.entrada_codigo = String(next.entrada_codigo).replace(
            new RegExp(`Lote\\s+${oldLote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
            `Lote ${newLote}`
          );
        }
      }
    } else if (!o.entrada_id && entradaLotes[0]?.lote) {
      next.lote = entradaLotes[0].lote;
    }
    return next;
  });

  return {
    ...transbordo,
    cliente_id: prefill.cliente_id || transbordo.cliente_id,
    cliente_nome: prefill.cliente_nome || transbordo.cliente_nome,
    produto_id: prefill.produto_id || transbordo.produto_id,
    produto_nome: prefill.produto_nome || transbordo.produto_nome,
    produto_codigo: prefill.produto_codigo || transbordo.produto_codigo,
    densidade: dens || parseDensidade(transbordo.densidade),
    origens: nextOrigens,
  };
}

export default function TransbordoModal({
  open,
  onClose,
  onSave,
  editingTransbordo,
  readOnly,
  clientes,
  produtos,
  entradas,
  isotanques,
  vasilhames,
  transbordos,
  prefillEntrada,
  externalError = "",
}) {
  const [data, setData] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [produtoNome, setProdutoNome] = useState("");
  const [produtoCodigo, setProdutoCodigo] = useState("");
  const [produtoDisplay, setProdutoDisplay] = useState("");
  const [densidade, setDensidade] = useState(0);
  const [operadores, setOperadores] = useState([]);
  const [observacoes, setObservacoes] = useState("");
  const [origens, setOrigens] = useState([]);
  const [destinos, setDestinos] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [operadoresOpen, setOperadoresOpen] = useState(false);
  const [collapsedOrigens, setCollapsedOrigens] = useState({});
  const [collapsedDestinos, setCollapsedDestinos] = useState({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [pendingPayload, setPendingPayload] = useState(null);
  const operadoresRef = useRef(null);
  const resolvedEditIdRef = useRef(null);
  const [isEditingResolved, setIsEditingResolved] = useState(false);

  useEffect(() => {
    if (!open) return;

    let nextOrigens = [];
    let nextDestinos = [];
    const fromPrefill = !!prefillEntrada;

    // Se veio da entrada sem editingTransbordo no parent, tenta resolver o OP aqui
    const allLinkedFromPrefill =
      !editingTransbordo && prefillEntrada
        ? findAllLinkedTransbordos(
            transbordos,
            prefillEntrada,
            entradas,
            vasilhames
          )
        : [];

    if (!editingTransbordo && allLinkedFromPrefill.length > 1) {
      setError(multipleTransbordosMessage(allLinkedFromPrefill));
      resolvedEditIdRef.current = null;
      setIsEditingResolved(false);
      setOrigens([]);
      setDestinos([]);
      setCollapsedOrigens({});
      setCollapsedDestinos({});
      setSaving(false);
      setConfirmOpen(false);
      setConfirmMessage("");
      setPendingPayload(null);
      return;
    }

    const linkedFromPrefill =
      allLinkedFromPrefill.length === 1 ? allLinkedFromPrefill[0] : null;
    const effectiveEditing = editingTransbordo || linkedFromPrefill;
    resolvedEditIdRef.current = effectiveEditing?.id || null;
    setIsEditingResolved(!!effectiveEditing);

    if (effectiveEditing) {
      const source = fromPrefill
        ? applyPrefillIdentity(effectiveEditing, prefillEntrada)
        : effectiveEditing;

      setData(source.data || "");
      setClienteId(source.cliente_id || "");
      setClienteNome(source.cliente_nome || "");
      setProdutoId(source.produto_id || "");
      setProdutoNome(source.produto_nome || "");
      setProdutoCodigo(source.produto_codigo || "");
      setProdutoDisplay(
        source.produto_codigo
          ? `${source.produto_codigo} - ${source.produto_nome}`
          : source.produto_nome || ""
      );
      setDensidade(parseDensidade(source.densidade));
      setOperadores(source.operadores || []);
      setObservacoes(source.observacoes || "");
      nextOrigens = ensureOrigemUids(
        (source.origens || []).map((o) =>
          o.entrada_id && !o.tipo_origem ? { ...o, tipo_origem: "entrada" } : o
        )
      );
      nextDestinos = linkDestinosToOrigens(
        Array.isArray(source.destinos) ? source.destinos : [],
        nextOrigens
      );
      setOrigens(nextOrigens);
      setDestinos(nextDestinos);
    } else if (prefillEntrada) {
      resolvedEditIdRef.current = null;
      const dens = parseDensidade(prefillEntrada.densidade);

      // Código E00N pela entrada-pai (não pelo índice da linha de estoque)
      const idMap = buildEstoqueDisplayCodigoMap(entradas);

      const savedEstoques = prefillEntrada.savedEstoques || prefillEntrada.savedEntradas || [];
      const entradaKey =
        prefillEntrada.id ||
        savedEstoques[0]?.entrada_id ||
        savedEstoques[0]?.id;
      const codigoEntrada =
        prefillEntrada.entrada_codigo ||
        savedEstoques[0]?.entrada_codigo ||
        idMap[entradaKey] ||
        idMap[savedEstoques[0]?.id] ||
        "E000";
      const entradaCodigo = `${codigoEntrada} - ${prefillEntrada.produto_nome || ""}`;

      setData(new Date().toISOString().split("T")[0]);
      setClienteId(prefillEntrada.cliente_id || "");
      setClienteNome(prefillEntrada.cliente_nome || "");
      setProdutoId(prefillEntrada.produto_id || "");
      setProdutoNome(prefillEntrada.produto_nome || "");
      setProdutoCodigo(prefillEntrada.produto_codigo || "");
      setProdutoDisplay(
        prefillEntrada.produto_codigo
          ? `${prefillEntrada.produto_codigo} - ${prefillEntrada.produto_nome}`
          : prefillEntrada.produto_nome || ""
      );
      setDensidade(dens);
      setOperadores([]);
      setObservacoes("");
      const lotesRaw =
        prefillEntrada.lotes && prefillEntrada.lotes.length > 0
          ? prefillEntrada.lotes
          : [
              {
                lote: prefillEntrada.lote || "",
                densidade: prefillEntrada.densidade || "",
                quantidade: prefillEntrada.quantidade || 0,
                unidade_medida: prefillEntrada.unidade_medida || "L",
              },
            ];
      const pesoLiqPesagem = Number(prefillEntrada.granel_peso_liquido) || 0;
      const entradaLotes =
        prefillEntrada.granel_margem === "fora" && pesoLiqPesagem > 0
          ? applyPesoLiquidoForaMargem(lotesRaw, pesoLiqPesagem)
          : lotesRaw;

      // Prefer volume declarado em L/gal (evita perda de 1 L no round-trip L→kg→L).
      // Fallback: kg por lote → litros inteiros com soma = total.
      const lotesKg = entradaLotes.map((lt, i) => {
        const estoqueRow = savedEstoques[i];
        const lDens = parseDensidade(lt.densidade || estoqueRow?.densidade || dens);
        let quantidade_kg;
        if (prefillEntrada.granel_margem === "fora") {
          quantidade_kg = loteToKg(lt);
        } else if (estoqueRow) {
          quantidade_kg = estoqueRow.quantidade ?? estoqueRow.saldo_atual ?? 0;
        } else if ((lt.unidade_medida || "L") === "kg") {
          quantidade_kg = lt.quantidade || 0;
        } else {
          quantidade_kg = loteToKg(lt);
        }
        return {
          quantidade_kg,
          densidade: lDens || dens,
          lote: lt.lote || estoqueRow?.lote || "",
          estoqueRow,
          lt,
        };
      });

      const fromKg = kgLotesToLitrosInteiros(lotesKg);
      const litrosPorLote = lotesKg.map((item, i) => {
        const declared =
          item.lt?.unidade_medida === "L" || item.lt?.unidade_medida === "gal"
            ? item.lt
            : item.estoqueRow?.lotes?.[0]?.unidade_medida === "L" ||
                item.estoqueRow?.lotes?.[0]?.unidade_medida === "gal"
              ? item.estoqueRow.lotes[0]
              : null;
        if (declared) {
          const vol = loteToLitros(declared);
          if (vol > 0) return vol;
        }
        return fromKg[i] || 0;
      });

      nextOrigens = ensureOrigemUids(
        lotesKg.map((item, i) => {
          const volumeL = litrosPorLote[i] || 0;
          const lDens = item.densidade || dens;
          return {
            tipo_origem: "entrada",
            entrada_id: item.estoqueRow?.id || prefillEntrada.id,
            entrada_codigo: `${entradaCodigo} — Lote ${item.lote || i + 1}`,
            lote: item.lote,
            volume_retirado: volumeL,
            massa_retirada: roundMass(volumeL * lDens),
            saldo_restante: 0,
            saldo_disponivel: volumeL,
          };
        })
      );
      nextDestinos = [];
      setOrigens(nextOrigens);
      setDestinos(nextDestinos);
    } else {
      resolvedEditIdRef.current = null;
      setData(new Date().toISOString().split("T")[0]);
      setClienteId("");
      setClienteNome("");
      setProdutoId("");
      setProdutoNome("");
      setProdutoCodigo("");
      setProdutoDisplay("");
      setDensidade(0);
      setOperadores([]);
      setObservacoes("");
      setOrigens([]);
      setDestinos([]);
    }

    setError("");
    setSaving(false);
    // Ao vir da entrada, origem/destino abrem minimizados
    setCollapsedOrigens(fromPrefill ? collapseMap(nextOrigens) : {});
    setCollapsedDestinos(fromPrefill ? collapseMap(nextDestinos) : {});
    setConfirmOpen(false);
    setConfirmMessage("");
    setPendingPayload(null);
  }, [editingTransbordo, open, prefillEntrada, entradas, transbordos, vasilhames]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (operadoresRef.current && !operadoresRef.current.contains(e.target)) {
        setOperadoresOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const clientesComProdutos = produtos
    .filter((p) => p.cliente_nome)
    .reduce((acc, p) => {
      if (!acc.find((c) => c.nome === p.cliente_nome)) {
        const matched = clientes.find(
          (c) => c.nome.toLowerCase() === p.cliente_nome.toLowerCase()
        );
        acc.push({ id: matched?.id || p.cliente_id || "", nome: p.cliente_nome });
      }
      return acc;
    }, []);

  const filteredProdutos = produtos.filter(
    (p) => !clienteNome || p.cliente_nome?.toLowerCase() === clienteNome.toLowerCase()
  );

  const produtosComSaldo = filteredProdutos.filter((p) =>
    entradas.some((e) => {
      if (!(e.produto_id === p.id || e.produto_nome === p.produto)) return false;
      const disponivel = computeDisponivelTransbordo(e, transbordos);
      return disponivel > 0 || (e.saldo_atual || 0) > 0;
    })
  );

  const sortedEntradas = [...entradas].sort(
    (a, b) => new Date(createdAt(a)) - new Date(createdAt(b))
  );
  const entradaIdMap = buildEstoqueDisplayCodigoMap(sortedEntradas);

  // Estoque por lote (granel) — disponível = quantidade − já transbordado
  const filteredEntradas = entradas
    .filter((e) => {
      if (e.embalado) return false;
      if (e.lotes?.[0]?.tipo_recebimento === "vasilhame") return false;
      if (e.lotes?.[0]?.embalado) return false;
      if (!(e.produto_id === produtoId || e.produto_nome === produtoNome)) {
        return false;
      }
      return computeDisponivelTransbordo(e, transbordos) > 0;
    })
    .map((e) => ({
      ...e,
      saldo_atual: computeDisponivelTransbordo(e, transbordos),
      display_codigo: entradaIdMap[e.id] || "E000",
      display_label: `${entradaIdMap[e.id] || "E000"} - ${e.produto_nome || ""}${
        e.lote ? ` (Lote ${e.lote})` : ""
      }`,
    }));

  const filteredIsotanques = isotanques.filter(
    (i) => i.produto_id === produtoId || i.produto_nome?.toLowerCase() === produtoNome?.toLowerCase()
  );

  // Tankas com saldo > 0 (entrada Tankagem − saída como origem tanka)
  // Em edição, o OP atual é excluído do histórico para não subtrair em dobro.
  const editingIdForSaldo =
    resolvedEditIdRef.current || editingTransbordo?.id || null;

  const tankasComSaldo = isotanques
    .filter(
      (i) =>
        i.produto_id === produtoId ||
        i.produto_nome?.toLowerCase() === produtoNome?.toLowerCase()
    )
    .map((i) => {
      const tankaCodigo = i.tanka || i.codigo_itku || "";
      const saldo = computeTankaSaldo({
        isotanqueId: i.id,
        tankaCodigo,
        transbordos,
        excludeTransbordoId: editingIdForSaldo,
      });
      const lotesDisponiveis = computeTankaLotesDisponiveis({
        isotanqueId: i.id,
        tankaCodigo,
        transbordos,
        excludeTransbordoId: editingIdForSaldo,
      });
      return {
        ...i,
        saldo_atual: saldo,
        unidade_medida: "L",
        lote: lotesDisponiveis[0]?.lote || "",
        lotes_disponiveis: lotesDisponiveis,
        display_label: `${tankaCodigo || "Tanka"} - ${i.produto_nome || ""} (${formatVolume(saldo)} L)`,
      };
    })
    .filter((i) => (i.saldo_atual || 0) > 0);

  // Vasilhames No Pátio (com composição por lote quando houver)
  const vasilhamesNoPatio = vasilhames
    .filter(
      (v) =>
        v.status === "No Pátio" &&
        (v.produto_id === produtoId ||
          v.produto_nome?.toLowerCase() === produtoNome?.toLowerCase())
    )
    .map((v) => {
      const lotesDisponiveis = aggregateComposicaoByLote(
        seedComposicaoFromVasilhame(v)
      )
        .filter((l) => roundVolume(l.quantidade_l || 0) > 0)
        .map((l) => ({
          lote: l.lote || "",
          quantidade_l: roundVolume(l.quantidade_l || 0),
        }));
      return {
        ...v,
        saldo_atual: v.volume || 0,
        unidade_medida: "L",
        lote: lotesDisponiveis[0]?.lote || v.lote || "",
        lotes_disponiveis: lotesDisponiveis,
        display_label: `${v.placa || v.barril || v.codigo || "Vasilhame"} - ${v.produto_nome || ""} (${formatVolume(v.volume || 0)} L)`,
      };
    });

  // Entradas embaladas com saldo > 0 (saídas fiscais já descontadas no saldo_atual)
  const entradasEmbaladas = entradas
    .filter(
      (e) =>
        e.embalado === true &&
        (e.produto_id === produtoId || e.produto_nome === produtoNome) &&
        (e.saldo_atual || 0) > 0
    )
    .map((e) => {
      const um = e.unidade_medida || "kg";
      const saldo = Math.round(Number(e.saldo_atual) || 0);
      return {
        ...e,
        embalado: true,
        unidade_medida: um,
        display_label: `${entradaIdMap[e.id] || "E000"} - ${e.produto_nome || ""} (${saldo} ${um})`,
      };
    });

  // Saldo consumido por fonte (para excluir fontes esgotadas em origens subsequentes)
  const consumedBySource = {};
  const consumedLotesBySource = {};
  origens.forEach((o) => {
    if (!o.entrada_id) return;
    consumedBySource[o.entrada_id] =
      (consumedBySource[o.entrada_id] || 0) + (o.volume_retirado || 0);
    const lotes = (o.lotes_retirados || []).filter(
      (l) => roundVolume(l.volume_retirado || 0) > 0
    );
    if (lotes.length > 0) {
      if (!consumedLotesBySource[o.entrada_id]) {
        consumedLotesBySource[o.entrada_id] = {};
      }
      for (const l of lotes) {
        const key = (l.lote || "").trim();
        consumedLotesBySource[o.entrada_id][key] =
          (consumedLotesBySource[o.entrada_id][key] || 0) +
          roundVolume(l.volume_retirado || 0);
      }
    } else if ((o.lote || "").trim()) {
      if (!consumedLotesBySource[o.entrada_id]) {
        consumedLotesBySource[o.entrada_id] = {};
      }
      const key = (o.lote || "").trim();
      consumedLotesBySource[o.entrada_id][key] =
        (consumedLotesBySource[o.entrada_id][key] || 0) +
        roundVolume(o.volume_retirado || 0);
    }
  });

  const adjustOptionsForOrigem = (options, currentOrigem) => {
    // Volumes/lotes desta origem não entram no consumo (já estão no card)
    const selfVol = roundVolume(currentOrigem.volume_retirado || 0);
    const selfLotes = {};
    for (const l of currentOrigem.lotes_retirados || []) {
      const key = (l.lote || "").trim();
      selfLotes[key] =
        (selfLotes[key] || 0) + roundVolume(l.volume_retirado || 0);
    }
    if (
      Object.keys(selfLotes).length === 0 &&
      (currentOrigem.lote || "").trim()
    ) {
      selfLotes[(currentOrigem.lote || "").trim()] = selfVol;
    }

    return options
      .map((opt) => {
        const isSelf = opt.id === currentOrigem.entrada_id;
        const consumedL = roundVolume(
          (consumedBySource[opt.id] || 0) - (isSelf ? selfVol : 0)
        );
        const saldo = opt.saldo_atual || 0;
        const keepEntryUom = isEstoqueEmbalado(opt);
        const unid = opt.unidade_medida || (keepEntryUom ? "kg" : "L");
        // Embalado: saldo permanece na UOM da entrada (sem kg→L por densidade)
        const saldoOp = keepEntryUom
          ? Math.round(Number(saldo) || 0)
          : unid === "kg" && densidade > 0
            ? saldoKgToLitros(saldo, densidade, opt)
            : roundVolume(saldo);
        const available = keepEntryUom
          ? Math.max(0, Math.round(saldoOp - consumedL))
          : roundVolume(saldoOp - consumedL);
        if (!isSelf && available <= 0) return null;

        const baseLotes = opt.lotes_disponiveis || [];
        if (baseLotes.length === 0) {
          return {
            ...opt,
            saldo_atual: isSelf ? saldoOp : available,
            unidade_medida: keepEntryUom ? unid : "L",
            embalado: keepEntryUom || opt.embalado,
          };
        }

        const consumedLotes = { ...(consumedLotesBySource[opt.id] || {}) };
        if (isSelf) {
          for (const [k, v] of Object.entries(selfLotes)) {
            consumedLotes[k] = Math.max(0, (consumedLotes[k] || 0) - v);
          }
        }

        // Card atual: desconta só o que outras origens já consumiram desta fonte
        const lotesParaCard = baseLotes
          .map((l) => {
            const key = (l.lote || "").trim();
            const otherConsumed = isSelf
              ? Math.max(
                  0,
                  roundVolume(
                    (consumedLotesBySource[opt.id]?.[key] || 0) -
                      (selfLotes[key] || 0)
                  )
                )
              : roundVolume(consumedLotes[key] || 0);
            return {
              lote: l.lote || "",
              quantidade_l: Math.max(
                0,
                roundVolume((l.quantidade_l || 0) - otherConsumed)
              ),
            };
          })
          .filter((l) => l.quantidade_l > 0);

        const saldoAjustado = roundVolume(
          lotesParaCard.reduce((s, l) => s + l.quantidade_l, 0)
        );

        return {
          ...opt,
          saldo_atual: saldoAjustado > 0 ? saldoAjustado : available,
          unidade_medida: keepEntryUom ? unid : "L",
          embalado: keepEntryUom || opt.embalado,
          lotes_disponiveis: lotesParaCard,
          display_label: opt.display_label,
        };
      })
      .filter(Boolean);
  };

  const volumeOrigens = roundVolume(
    origens.reduce((sum, o) => sum + (o.volume_retirado || 0), 0)
  );
  const volumeDestinos = roundVolume(
    destinos.reduce((sum, d) => sum + (d.volume_total || 0), 0)
  );
  const volumeDiff = Math.abs(volumeOrigens - volumeDestinos);
  const volumePendente = roundVolume(volumeOrigens - volumeDestinos);
  const massaTotal = roundMass(volumeOrigens * densidade);
  const volumesMatch = volumeDiff === 0;
  const conferenciaAtiva = volumeOrigens > 0 || volumeDestinos > 0;
  const progressoDestinado =
    volumeOrigens > 0
      ? Math.min(100, Math.round((volumeDestinos / volumeOrigens) * 100))
      : 0;
  const lotesOperacao = [
    ...new Set(
      origens
        .flatMap((o) => {
          const multi = (o.lotes_retirados || []).filter(
            (l) => roundVolume(l.volume_retirado || 0) > 0
          );
          if (multi.length > 0) return multi.map((l) => l.lote || "");
          return [o.lote || ""];
        })
        .map((l) => String(l).trim())
        .filter(Boolean)
    ),
  ];

  const tankaExcedido = destinos.some((d) => {
    if (d.tipo_embalagem !== "Tankagem" || !d.tanka_id) return false;
    const tanka = isotanques.find((i) => i.id === d.tanka_id);
    return tanka && tanka.capacidade > 0 && (d.volume || 0) > tanka.capacidade;
  });

  const allOrigemOptions = [
    ...filteredEntradas,
    ...tankasComSaldo,
    ...vasilhamesNoPatio,
    ...entradasEmbaladas,
  ];

  const saldoExcedido = origens.some((o) => {
    const lotes = o.lotes_retirados || [];
    if (lotes.length > 1) {
      return lotes.some(
        (l) =>
          roundVolume(l.volume_retirado) > roundVolume(l.saldo_disponivel)
      );
    }
    const adjusted = adjustOptionsForOrigem(allOrigemOptions, o);
    const src = adjusted.find((opt) => opt.id === o.entrada_id);
    if (!src) {
      if (o.tipo_origem === "entrada" && o.saldo_disponivel != null) {
        return roundVolume(o.volume_retirado) > roundVolume(o.saldo_disponivel);
      }
      return false;
    }
    // adjustOptionsForOrigem já devolve saldo_atual em litros
    return roundVolume(o.volume_retirado) > roundVolume(src.saldo_atual || 0);
  });

  const handleClienteChange = (label, item) => {
    setClienteNome(label);
    setClienteId(item?.id || "");
    setProdutoId("");
    setProdutoNome("");
    setProdutoCodigo("");
    setProdutoDisplay("");
    setDensidade(0);
    setOrigens([]);
    setDestinos([]);
    setCollapsedOrigens({});
    setCollapsedDestinos({});
  };

  const handleProdutoChange = (label, item) => {
    setProdutoDisplay(label);
    if (item) {
      setProdutoId(item.id);
      setProdutoNome(item.produto);
      setProdutoCodigo(item.codigo || "");
      setDensidade(parseDensidade(item.densidade));
    } else {
      setProdutoId("");
      setProdutoNome("");
      setProdutoCodigo("");
      setDensidade(0);
    }
    setOrigens([]);
    setDestinos([]);
    setCollapsedOrigens({});
    setCollapsedDestinos({});
  };

  const toggleOperador = (op) => {
    setOperadores((prev) =>
      prev.includes(op) ? prev.filter((o) => o !== op) : [...prev, op]
    );
  };

  const handleAddOrigem = () => {
    // Recolhe todas as origens existentes; a nova fica expandida (fora do map).
    setCollapsedOrigens(
      Object.fromEntries(origens.map((_, i) => [i, true]))
    );
    setCollapsedDestinos(
      Object.fromEntries(destinos.map((_, i) => [i, true]))
    );
    setOrigens((prev) => [
      ...prev,
      {
        _uid: createClientUid(),
        tipo_origem: "",
        entrada_id: "",
        entrada_codigo: "",
        lote: "",
        volume_retirado: 0,
        massa_retirada: 0,
        saldo_restante: 0,
      },
    ]);
  };

  const handleUpdateOrigem = (idx, data) => {
    const vol = roundVolume(data.volume_retirado);
    const massa = roundMass(vol * densidade);
    setOrigens((prev) =>
      prev.map((o, i) =>
        i === idx
          ? { ...data, _uid: o._uid || data._uid || createClientUid(), volume_retirado: vol, massa_retirada: massa }
          : o
      )
    );
  };

  const handleRemoveOrigem = (idx) => {
    const removedUid = origens[idx]?._uid;
    const remainingDestinos = removedUid
      ? destinos.filter((d) => d.origem_uid !== removedUid)
      : destinos;

    setOrigens((prev) => prev.filter((_, i) => i !== idx));
    setDestinos(remainingDestinos);
    setCollapsedDestinos(
      Object.fromEntries(remainingDestinos.map((_, i) => [i, true]))
    );
    setCollapsedOrigens((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        const i = Number(key);
        if (i < idx) next[i] = prev[i];
        else if (i > idx) next[i - 1] = prev[i];
      });
      return next;
    });
  };

  const toggleOrigemCollapse = (idx) => {
    setCollapsedOrigens((prev) => {
      const isCollapsed = !!prev[idx];
      if (isCollapsed) {
        // Expande esta e recolhe as demais (apenas uma origem aberta).
        return Object.fromEntries(origens.map((_, i) => [i, i !== idx]));
      }
      return { ...prev, [idx]: true };
    });
  };

  const handleAddDestino = (origemUid) => {
    const origemIdx = origens.findIndex((o) => o._uid === origemUid);
    if (origemIdx >= 0) {
      setCollapsedOrigens(
        Object.fromEntries(origens.map((_, i) => [i, i !== origemIdx]))
      );
    }
    // Recolhe destinos existentes; o novo fica expandido.
    setCollapsedDestinos(
      Object.fromEntries(destinos.map((_, i) => [i, true]))
    );
    setDestinos((prev) => [
      ...prev,
      {
        tipo_embalagem: "",
        volume_total: 0,
        origem_uid: origemUid,
      },
    ]);
  };

  const handleUpdateDestino = (idx, data) => {
    setDestinos((prev) =>
      prev.map((d, i) =>
        i === idx
          ? { ...data, origem_uid: data.origem_uid || d.origem_uid }
          : d
      )
    );
  };

  const handleRemoveDestino = (idx) => {
    setDestinos((prev) => prev.filter((_, i) => i !== idx));
    setCollapsedDestinos((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        const i = Number(key);
        if (i < idx) next[i] = prev[i];
        else if (i > idx) next[i - 1] = prev[i];
      });
      return next;
    });
  };

  const toggleDestinoCollapse = (idx) => {
    const origemUid = destinos[idx]?.origem_uid;
    setCollapsedDestinos((prev) => {
      const isCollapsed = !!prev[idx];
      if (isCollapsed) {
        // Expande este e recolhe os demais da mesma origem.
        const next = { ...prev };
        destinos.forEach((d, i) => {
          if (!origemUid || d.origem_uid === origemUid) {
            next[i] = i !== idx;
          }
        });
        return next;
      }
      return { ...prev, [idx]: true };
    });
  };

  const buildPayload = () => {
    const origensNorm = origens.map((o) => {
      const isMulti = (o.lotes_retirados || []).length > 1;
      const lotesRet = (o.lotes_retirados || []).map((l) => ({
        lote: l.lote || "",
        saldo_disponivel: roundVolume(l.saldo_disponivel || 0),
        volume_retirado: roundVolume(l.volume_retirado || 0),
      }));
      const lotesComVolume = lotesRet.filter((l) => l.volume_retirado > 0);

      const volumeFromLotes =
        lotesComVolume.length > 0
          ? roundVolume(
              lotesComVolume.reduce((s, l) => s + (l.volume_retirado || 0), 0)
            )
          : roundVolume(o.volume_retirado);

      const firstLote =
        lotesComVolume[0]?.lote || o.lote || "";

      return {
        ...o,
        lote: firstLote,
        volume_retirado: volumeFromLotes,
        massa_retirada: roundMass(volumeFromLotes * densidade),
        saldo_disponivel: roundVolume(o.saldo_disponivel),
        saldo_restante: roundVolume(
          Math.max(0, roundVolume(o.saldo_disponivel) - volumeFromLotes)
        ),
        ...(isMulti && lotesComVolume.length > 0
          ? {
              lotes_retirados: lotesComVolume,
              lotes_disponiveis: (o.lotes_disponiveis || []).map((l) => ({
                lote: l.lote || "",
                quantidade_l: roundVolume(l.quantidade_l || 0),
              })),
            }
          : { lotes_retirados: undefined, lotes_disponiveis: undefined }),
      };
    });
    const destinosOrdered = [
      ...origens.flatMap((o) =>
        destinos.filter((d) => d.origem_uid && d.origem_uid === o._uid)
      ),
      ...destinos.filter(
        (d) => !d.origem_uid || !origens.some((o) => o._uid === d.origem_uid)
      ),
    ];

    const destinosNorm = destinosOrdered.map((d) => {
      const volume_total = roundVolume(d.volume_total || d.volume || 0);
      return {
        ...d,
        volume: roundVolume(d.volume || volume_total),
        volume_total,
        volume_por_embalagem: roundVolume(d.volume_por_embalagem || 0),
        quantidade_embalagens: Math.round(d.quantidade_embalagens || 0),
        tara: roundMass(d.tara || 0),
        peso_liquido: roundMass(
          d.peso_liquido || (densidade > 0 ? volume_total * densidade : 0)
        ),
        peso_bruto: roundMass(d.peso_bruto || 0),
      };
    });

    return {
      id: resolvedEditIdRef.current || editingTransbordo?.id || null,
      data,
      cliente_id: clienteId || null,
      cliente_nome: clienteNome,
      produto_id: produtoId || null,
      produto_nome: produtoNome,
      produto_codigo: produtoCodigo,
      densidade: String(densidade),
      volume_total: volumeOrigens,
      massa_total: massaTotal,
      operadores,
      observacoes,
      origens: origensNorm,
      destinos: destinosNorm,
    };
  };

  const buildConfirmMessage = (destinosNorm) => {
    const fracionados = destinosNorm.filter((d) => d.fracionado);
    if (fracionados.length === 0) {
      return "Para esta operação nenhuma embalagem ficou fracionada, confirma essa informação?";
    }
    return fracionados
      .map((d) => {
        const item = destinoItemLabel(d);
        let vol = roundVolume(d.volume_total || d.volume || 0);
        if (
          d.tipo_embalagem === "Vasilhame" &&
          d.vasilhame_existente_id
        ) {
          const existente = vasilhames.find(
            (v) => v.id === d.vasilhame_existente_id
          );
          if (existente?.fracionado) {
            vol = roundVolume((existente.volume || 0) + vol);
          }
        }
        const massa = roundMass(densidade > 0 ? vol * densidade : destinoMassaKg(d, densidade));
        return `Após confirmação o item ${item} ficará fracionado com ${formatVolume(vol)} L e ${formatMass(massa)} kg.`;
      })
      .join("\n");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!clienteNome) {
      setError("Cliente é obrigatório.");
      return;
    }
    if (!produtoId && !produtoNome) {
      setError("Produto é obrigatório.");
      return;
    }
    if (operadores.length === 0) {
      setError("Selecione ao menos um operador.");
      return;
    }
    if (origens.length === 0) {
      setError("Adicione ao menos uma origem.");
      return;
    }
    if (origens.some((o) => !o.tipo_origem)) {
      setError("Todas as origens devem ter um tipo selecionado.");
      return;
    }
    if (origens.some((o) => !o.entrada_id)) {
      setError("Todas as origens devem ter uma origem selecionada.");
      return;
    }
    if (origens.some((o) => !o.volume_retirado || o.volume_retirado <= 0)) {
      setError("Todas as origens devem ter um volume retirado maior que zero.");
      return;
    }
    if (
      origens.some((o) => {
        const lotes = o.lotes_retirados || [];
        return (
          lotes.length > 1 &&
          lotes.every((l) => roundVolume(l.volume_retirado || 0) <= 0)
        );
      })
    ) {
      setError("Informe o volume retirado em ao menos um lote da origem.");
      return;
    }
    if (saldoExcedido) {
      setError(
        "Uma ou mais origens têm volume superior ao saldo disponível (total ou por lote)."
      );
      return;
    }
    if (destinos.length === 0) {
      setError("Adicione ao menos um destino.");
      return;
    }
    if (destinos.some((d) => !d.tipo_embalagem)) {
      setError("Todos os destinos devem ter um tipo de destino selecionado.");
      return;
    }
    if (
      destinos.some(
        (d) =>
          isDestinoEstoqueEmbalado(d.tipo_embalagem) &&
          (!(d.quantidade_embalagens > 0) || !(d.volume_por_embalagem > 0))
      )
    ) {
      setError(
        "Informe quantidade de embalagens e volume por embalagem nos destinos IBC/Bombona/Tambor."
      );
      return;
    }
    if (tankaExcedido) {
      setError("Um ou mais destinos excedem a capacidade do tanka.");
      return;
    }
    // Cada origem deve ter volume destinado igual ao retirado (necessário para o FIFO
    // global continuar equivalente à alocação por origem na UI).
    const origemDesbalanceada = origens.find((o) => {
      const volO = roundVolume(o.volume_retirado || 0);
      const volD = roundVolume(
        destinos
          .filter((d) => d.origem_uid === o._uid)
          .reduce((s, d) => s + (d.volume_total || 0), 0)
      );
      return volO !== volD;
    });
    if (origemDesbalanceada) {
      const label =
        origemDesbalanceada.entrada_codigo ||
        `Origem ${origens.indexOf(origemDesbalanceada) + 1}`;
      setError(
        `A origem "${label}" não está balanceada: o volume destinado deve ser igual ao volume retirado.`
      );
      return;
    }
    if (!volumesMatch) {
      setError(
        "O volume total das origens deve ser exatamente igual ao volume total dos destinos. Verifique os valores informados."
      );
      return;
    }

    setError("");
    const payload = buildPayload();
    setPendingPayload(payload);
    setConfirmMessage(buildConfirmMessage(payload.destinos));
    setConfirmOpen(true);
  };

  const handleConfirmSave = async () => {
    if (!pendingPayload) return;
    setConfirmOpen(false);
    setSaving(true);
    setError("");
    try {
      await onSave(pendingPayload);
    } finally {
      setSaving(false);
      setPendingPayload(null);
    }
  };

  const title = readOnly
    ? "Visualizar Transbordo"
    : editingTransbordo || isEditingResolved
    ? "Editar Transbordo"
    : "Novo Transbordo";

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-8">
          {(error || externalError) && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error || externalError}
            </div>
          )}

          {/* 01 — Dados da Operação */}
          <section className="space-y-4">
            <div className="flex items-baseline gap-2 border-b border-border pb-2">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                01
              </span>
              <h3 className="text-sm font-semibold text-primary">
                Dados da Operação
              </h3>
            </div>

            {(produtoNome || volumeOrigens > 0 || operadores.length > 0) && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 rounded-lg border border-border/80 bg-muted/20 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Produto
                  </p>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {produtoNome || "—"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Lote
                  </p>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {lotesOperacao.length > 0 ? lotesOperacao.join(" / ") : "—"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Volume da operação
                  </p>
                  <p className="text-sm font-semibold text-foreground tabular-nums">
                    {formatVolume(volumeOrigens)} L
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Operadores
                  </p>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {operadores.length > 0 ? operadores.join(" / ") : "—"}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Data *</Label>
                <Input
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  disabled={readOnly}
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cliente *</Label>
                <SearchableSelect
                  value={clienteNome}
                  onChange={handleClienteChange}
                  options={clientesComProdutos}
                  getOptionLabel={(c) => c.nome}
                  getOptionValue={(c) => c.id}
                  placeholder="Selecione um cliente"
                  disabled={readOnly}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Produto *</Label>
                <SearchableSelect
                  value={produtoDisplay}
                  onChange={handleProdutoChange}
                  options={produtosComSaldo}
                  getOptionLabel={(p) => `${p.codigo || ""} - ${p.produto}`}
                  getOptionValue={(p) => p.id}
                  placeholder={clienteNome ? "Selecione um produto" : "Selecione um cliente primeiro"}
                  disabled={readOnly || !clienteNome}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
            </div>

            {/* Operadores Multi-Select */}
            <div className="space-y-1.5">
              <Label>Operadores *</Label>
              <div className="relative" ref={operadoresRef}>
                <button
                  type="button"
                  onClick={() => !readOnly && setOperadoresOpen(!operadoresOpen)}
                  disabled={readOnly}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md border border-border bg-white text-sm hover:border-slate-400 transition-colors disabled:bg-muted/40 disabled:cursor-not-allowed"
                >
                  <span className={operadores.length ? "text-foreground" : "text-muted-foreground"}>
                    {operadores.length
                      ? `${operadores.length} operador(es) selecionado(s)`
                      : "Selecionar operadores"}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${operadoresOpen ? "rotate-180" : ""}`} />
                </button>
                {operadoresOpen && !readOnly && (
                  <div className="absolute z-50 mt-1 w-full bg-card rounded-md border border-border shadow-lg overflow-hidden">
                    <div className="max-h-48 overflow-y-auto">
                      {OPERADORES.map((op) => (
                        <label
                          key={op}
                          className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={operadores.includes(op)}
                            onChange={() => toggleOperador(op)}
                            className="w-4 h-4 rounded border-border"
                          />
                          <span className="text-foreground/80">{op}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {operadores.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {operadores.map((op) => (
                    <span key={op} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                      {op}
                      {!readOnly && (
                        <button type="button" onClick={() => toggleOperador(op)} className="hover:text-blue-900">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Input
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Observações..."
                disabled={readOnly}
                className={INPUT_EDITABLE}
              />
            </div>
          </section>

          {/* 02 — Origens (com destinos aninhados) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                  02
                </span>
                <h3 className="text-sm font-semibold text-primary">
                  Origens e Destinos
                </h3>
              </div>
              {!readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddOrigem}
                  disabled={!produtoId && !produtoNome}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Adicionar Origem
                </Button>
              )}
            </div>
            <div className="space-y-3">
              {origens.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
                  Nenhuma origem adicionada.
                </p>
              ) : (
                origens.map((origem, idx) => {
                  const destinosDaOrigem = destinos
                    .map((d, globalIdx) => ({ d, globalIdx }))
                    .filter(({ d }) => d.origem_uid === origem._uid);
                  const volumeDestinadoOrigem = roundVolume(
                    destinosDaOrigem.reduce(
                      (s, { d }) => s + (d.volume_total || 0),
                      0
                    )
                  );

                  return (
                    <OrigemCard
                      key={origem._uid || idx}
                      index={idx}
                      origem={origem}
                      entradaOptions={adjustOptionsForOrigem(
                        filteredEntradas,
                        origem
                      )}
                      tankaOptions={adjustOptionsForOrigem(
                        tankasComSaldo,
                        origem
                      )}
                      vasilhameOptions={adjustOptionsForOrigem(
                        vasilhamesNoPatio,
                        origem
                      )}
                      embaladoOptions={adjustOptionsForOrigem(
                        entradasEmbaladas,
                        origem
                      )}
                      densidade={densidade}
                      onChange={(data) => handleUpdateOrigem(idx, data)}
                      onRemove={() => handleRemoveOrigem(idx)}
                      readOnly={readOnly}
                      collapsed={!!collapsedOrigens[idx]}
                      onToggleCollapse={() => toggleOrigemCollapse(idx)}
                      volumeDestinado={volumeDestinadoOrigem}
                      destinosCount={destinosDaOrigem.length}
                      onAddDestino={() => handleAddDestino(origem._uid)}
                    >
                      {destinosDaOrigem.map(({ d, globalIdx }, localIdx) => {
                        const origemEmbalado =
                          origem.tipo_origem === "embalado" ||
                          Boolean(origem.embalado);
                        const umOrigem =
                          origem.unidade_medida ||
                          adjustOptionsForOrigem(entradasEmbaladas, origem).find(
                            (o) => o.id === origem.entrada_id
                          )?.unidade_medida ||
                          "kg";
                        const preserveEntryMass =
                          origemEmbalado && isUnidadeMassaEntrada(umOrigem);
                        return (
                        <DestinoCard
                          key={`${d.origem_uid || "d"}-${globalIdx}`}
                          index={localIdx}
                          destino={d}
                          isotanques={filteredIsotanques}
                          vasilhames={vasilhames}
                          produtoId={produtoId}
                          produtoNome={produtoNome}
                          densidade={densidade}
                          preserveEntryMass={preserveEntryMass}
                          unidadeEntrada={umOrigem}
                          onChange={(data) =>
                            handleUpdateDestino(globalIdx, data)
                          }
                          onRemove={() => handleRemoveDestino(globalIdx)}
                          readOnly={readOnly}
                          collapsed={!!collapsedDestinos[globalIdx]}
                          onToggleCollapse={() =>
                            toggleDestinoCollapse(globalIdx)
                          }
                        />
                        );
                      })}
                    </OrigemCard>
                  );
                })
              )}
            </div>
          </section>

          {/* 03 — Conferência */}
          <section className="space-y-3">
            <div className="flex items-baseline gap-2 border-b border-border pb-2">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                03
              </span>
              <h3 className="text-sm font-semibold text-primary">
                Conferência da Movimentação
              </h3>
            </div>

            <div
              className={`rounded-lg border p-5 space-y-5 ${
                !conferenciaAtiva
                  ? "border-border bg-muted/20"
                  : volumesMatch
                  ? "border-green-200 bg-green-50/40"
                  : "border-amber-200 bg-amber-50/40"
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="text-center space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Volume Retirado
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {formatVolume(volumeOrigens)} L
                  </p>
                </div>
                <div className="text-center space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Volume Destinado
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {formatVolume(volumeDestinos)} L
                  </p>
                </div>
                <div className="text-center space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Diferença
                  </p>
                  <p
                    className={`text-2xl font-bold tabular-nums ${
                      !conferenciaAtiva
                        ? "text-foreground"
                        : volumesMatch
                        ? "text-green-700"
                        : "text-amber-700"
                    }`}
                  >
                    {formatVolume(volumeDiff)} L
                  </p>
                </div>
              </div>

              {conferenciaAtiva && (
                <div className="flex flex-col items-center gap-1 text-center">
                  {volumesMatch ? (
                    <>
                      <div className="inline-flex items-center gap-2 text-sm font-semibold text-green-700">
                        <CheckCircle2 className="w-5 h-5" />
                        Operação balanceada
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="inline-flex items-center gap-2 text-sm font-semibold text-amber-700">
                        <AlertCircle className="w-5 h-5" />
                        Divergência
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {volumePendente > 0
                          ? `${formatVolume(volumePendente)} L ainda não destinados`
                          : `${formatVolume(Math.abs(volumePendente))} L destinados a mais`}
                      </p>
                    </>
                  )}
                </div>
              )}

              {volumeOrigens > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatVolume(volumeOrigens)} L retirados</span>
                    <span className="font-medium text-foreground">{progressoDestinado}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        volumesMatch ? "bg-green-600" : "bg-primary"
                      }`}
                      style={{ width: `${progressoDestinado}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatVolume(volumeDestinos)} L destinados</span>
                    {volumePendente > 0 && (
                      <span>{formatVolume(volumePendente)} L pendentes</span>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-border/70 flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Massa total:{" "}
                  <span className="font-medium text-foreground">
                    {formatMass(massaTotal)} kg
                  </span>
                </span>
              </div>
            </div>
          </section>

          {!readOnly && (
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                type="submit"
                className="bg-primary hover:bg-primary/90"
                disabled={saving}
              >
                {saving
                  ? "Salvando..."
                  : editingTransbordo
                  ? "Salvar Alterações"
                  : "Registrar Transbordo"}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(v) => {
          if (!v) {
            setConfirmOpen(false);
            setPendingPayload(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar transbordo</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground/80 whitespace-pre-wrap">
              {confirmMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmSave();
              }}
              disabled={saving}
              className="bg-primary hover:bg-primary/90"
            >
              {saving ? "Salvando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}