import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, CheckCircle, Clock, Eye, Plus, Printer, Trash2 } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { RowActionButton } from "@shared/components/ui/RowActionButton";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { useToast } from "@shared/components/ui/use-toast";
import { Can } from "@industrializacao/lib/rbac/Can";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import DateInputBr from "@transbordo/components/cadastro/DateInputBr";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { UNIDADES } from "@transbordo/components/entrada/LoteBlock";
import { entities } from "@transbordo/services/entities";
import { base44 } from "@industrializacao/api/base44Client";
import {
  atualizarValidacaoTransbordoPayload,
  criarValidacao,
  resumoQuantidadeValidacao,
} from "@transbordo/lib/validacaoTransbordo";
import {
  atualizarValidacaoIndustrializacao,
  criarValidacaoIndustrializacao,
} from "@industrializacao/lib/validacaoIndustrializacao";
import OperadorOrdemAuthDialog from "@painel/components/operacional/OperadorOrdemAuthDialog";
import OrdemTransbordoEnvaseModal from "@painel/components/operacional/OrdemTransbordoEnvaseModal";
import ValidacaoOrdemEnvaseEditor from "@painel/components/operacional/ValidacaoOrdemEnvaseEditor";
import ValidacaoViewDialog, {
  normalizeValidacaoView,
} from "@transbordo/components/validacao/ValidacaoViewDialog";
import {
  applyPesoLiquidoForaMargem,
  getLoteQuantidadeDeclarada,
  loteToKg,
} from "@transbordo/lib/conversao";
import {
  formatMass,
  formatNum,
  formatVolume,
  parseDensidade,
  roundVolume,
} from "@transbordo/lib/format";
import {
  buildMpProdutos,
  buildPaProdutos,
  catalogProdutosByDestino,
  catalogProdutosGranel,
  clientsFromProdutos,
  filterProdutosArmazenagem,
  filterProdutosByOrigem,
  isProdutoIndustrializacao,
  mergeClientesByNome,
  uniqueClientesByNome,
} from "@painel/lib/recebimentoCatalog";
import { listProdutos } from "@transbordo/lib/cadastroProdutosCentral";
import { listTankas } from "@transbordo/lib/cadastroTankaCentral";
import {
  buildTankaDetalhe,
  computeTankaLotesDisponiveis,
  computeTankaSaldo,
} from "@transbordo/lib/tankaVolume";
import { matchesProdutoOperacional } from "@transbordo/lib/produtoMatch";
import {
  aggregateComposicaoByLote,
  seedComposicaoFromVasilhame,
} from "@transbordo/lib/vasilhameComposicao";

const INPUT_EDITABLE = "bg-white";
const PERM = "painel_operacional_ordem_transbordo";

const ORIGEM_VALUES = [
  { value: "granel", tipoOrigem: "entrada" },
  { value: "tanka", tipoOrigem: "tanka" },
  { value: "vasilhame", tipoOrigem: "vasilhame" },
  { value: "embalado", tipoOrigem: "embalado" },
];

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function emptyGranel() {
  return {
    notaFiscal: "",
    quantidade: "",
    unidade: "kg",
    lote: "",
    fornecedor: "",
    fabricacao: "",
    validade: "",
    densidade: "",
    precoUnitario: "",
    ticket: "",
    pesoBruto: "",
    pesoLiquido: "",
  };
}

function createTankaItemId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `tanka_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function emptyTankaItem() {
  return {
    key: createTankaItemId(),
    tankaId: "",
    tankaCodigo: "",
    lote: "",
    quantidade: "",
  };
}

function emptyVasilhameItem() {
  return {
    key: createTankaItemId(),
    vasilhameId: "",
    placa: "",
    barril: "",
    lote: "",
    quantidade: "",
    lotes: [],
  };
}

function formatLotesLabel(lotes = []) {
  const names = (lotes || [])
    .map((l) => String(l.lote || "").trim())
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return names.join(" / ");
}

/** Distribui quantidade editada nos lotes do tanque em ordem FIFO. */
function allocateQtyToLotes(lotes = [], qty) {
  let remaining = roundVolume(qty);
  const out = [];
  for (const l of lotes || []) {
    if (!(remaining > 0)) break;
    const disp = roundVolume(l.quantidade_l || 0);
    if (!(disp > 0)) continue;
    const take = roundVolume(Math.min(remaining, disp));
    if (take > 0) {
      out.push({
        lote: l.lote || "",
        volume_retirado: take,
        saldo_disponivel: disp,
      });
      remaining = roundVolume(remaining - take);
    }
  }
  return out;
}

/** IDs sintéticos da Industrialização não cabem em FK uuid do Transbordo. */
function transbordoFkId(id) {
  if (!id || String(id).startsWith("ind-")) return "";
  return id;
}

function isOrdemTransbordoTipo(tipo) {
  return tipo === "transbordo" || tipo === "granel_transbordo";
}

function mergeOrdemPendentes(valsTb, valsInd) {
  const convencionais = (valsTb || [])
    .filter((v) => v.status === "pendente" && isOrdemTransbordoTipo(v.tipo))
    .map((v) => {
      const normalized = normalizeValidacaoView({
        ...v,
        destino: "convencional",
        sortAt: v.created_at || v.data || "",
      });
      return normalized;
    });

  const industriais = (valsInd || [])
    .filter((v) => v.status === "pendente" && isOrdemTransbordoTipo(v.tipo))
    .map((v) => {
      const normalized = normalizeValidacaoView({
        ...v,
        destino: "industrializacao",
        granel_payload: v.entrada_payload || v.granel_payload,
        sortAt: v.created_date || v.created_at || v.data || "",
      });
      return normalized;
    });

  return [...convencionais, ...industriais].sort((a, b) =>
    String(b.sortAt).localeCompare(String(a.sortAt))
  );
}

export default function OrdemTransbordo() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [orderOperator, setOrderOperator] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [clientesTb, setClientesTb] = useState([]);
  const [produtosTb, setProdutosTb] = useState([]);
  const [produtosMp, setProdutosMp] = useState([]);
  const [produtosPa, setProdutosPa] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [isotanques, setIsotanques] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [containers, setContainers] = useState([]);
  const [validacoesPendentes, setValidacoesPendentes] = useState([]);
  const [pendingGranelPayload, setPendingGranelPayload] = useState(null);

  const [dataOp, setDataOp] = useState(todayISO);
  const [clienteId, setClienteId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [produtoNome, setProdutoNome] = useState("");
  const [produtoCodigo, setProdutoCodigo] = useState("");
  const [produtoFonte, setProdutoFonte] = useState("");
  const moduloValidacaoRef = useRef("convencional");
  const [origemTipo, setOrigemTipo] = useState("");
  const [granel, setGranel] = useState(emptyGranel);
  const [tankaItens, setTankaItens] = useState(() => [emptyTankaItem()]);
  const [vasilhameItens, setVasilhameItens] = useState(() => [
    emptyVasilhameItem(),
  ]);
  const [formError, setFormError] = useState("");
  const [goingToTransbordo, setGoingToTransbordo] = useState(false);

  const [envaseModalOpen, setEnvaseModalOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [viewValidacao, setViewValidacao] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewSaving, setViewSaving] = useState(false);
  const [editViewOpen, setEditViewOpen] = useState(false);
  const [editViewValidacao, setEditViewValidacao] = useState(null);
  const [editViewError, setEditViewError] = useState("");

  const clearTankaSelection = () => {
    setTankaItens([emptyTankaItem()]);
  };

  const clearVasilhameSelection = () => {
    setVasilhameItens([emptyVasilhameItem()]);
  };

  const clearOperacaoOrigens = () => {
    clearTankaSelection();
    clearVasilhameSelection();
  };

  const syncGranelFromOrigemItens = (itens, densOverride) => {
    const list = itens || [];
    const total = roundVolume(
      list.reduce((s, it) => s + (Number(it.quantidade) || 0), 0)
    );
    const lotesLabel = list
      .map((it) => String(it.lote || "").trim())
      .filter(Boolean)
      .join(" / ");
    setGranel((prev) => ({
      ...prev,
      unidade: "L",
      quantidade: total > 0 ? total : "",
      lote: lotesLabel,
      ...(densOverride != null && densOverride !== ""
        ? { densidade: densOverride }
        : {}),
    }));
  };

  const syncGranelFromTankaItens = (itens, densOverride) =>
    syncGranelFromOrigemItens(itens, densOverride);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [
        trans,
        prods,
        cliens,
        ents,
        isos,
        vascs,
        vals,
        recipes,
        stocks,
        valsInd,
        conts,
      ] = await Promise.all([
        entities.transbordos.list("-created_date"),
        listProdutos(),
        entities.clientes.list(),
        entities.estoque.list(),
        listTankas(),
        entities.vasilhames.list(),
        entities.transbordoValidacoes.list("-created_at"),
        base44.entities.Recipe.list("-created_date", 2000),
        base44.entities.RawMaterialStock.list("-created_date", 2000),
        base44.entities.IndValidacao.list("-created_date", 500).catch(() => []),
        base44.entities.Container.list("-created_date", 500).catch(() => []),
      ]);
      setTransbordos(trans || []);
      setProdutosTb(filterProdutosArmazenagem(prods || []));
      setClientesTb(cliens || []);
      setEntradas(ents || []);
      setIsotanques(isos || []);
      setVasilhames(vascs || []);
      setContainers(conts || []);
      setProdutosMp(buildMpProdutos(recipes || [], stocks || [], prods || []));
      setProdutosPa(buildPaProdutos(recipes || [], prods || []));
      setValidacoesPendentes(
        mergeOrdemPendentes(vals || [], valsInd || [])
      );
    } catch (err) {
      console.error("[OrdemTransbordo] load:", err);
      toast({
        title: t("painel.operacional.ordemTransbordo.loadErrorTitle"),
        description: t("painel.operacional.ordemTransbordo.loadErrorDescription"),
        variant: "destructive",
      });
    }
    if (!silent) setLoading(false);
  }, [t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const origemOptions = useMemo(
    () =>
      ORIGEM_VALUES.map((o) => ({
        ...o,
        label: t(`painel.operacional.ordemTransbordo.origem.${o.value}`),
      })),
    [t]
  );

  const catalogProdutos = useMemo(() => {
    if (origemTipo === "granel") {
      return catalogProdutosGranel(produtosTb, produtosMp);
    }
    if (!origemTipo) return [];
    return catalogProdutosByDestino({
      destino: "convencional",
      tipoOrOrigem: origemTipo,
      produtosTb,
      produtosMp,
      produtosPa,
    });
  }, [origemTipo, produtosTb, produtosMp, produtosPa]);

  const clientes = useMemo(() => {
    if (origemTipo === "granel") {
      return mergeClientesByNome(clientesTb, clientsFromProdutos(produtosMp));
    }
    if (origemTipo) return uniqueClientesByNome(clientesTb);
    return [];
  }, [origemTipo, clientesTb, produtosMp]);

  const produtosDoCliente = useMemo(() => {
    if (!clienteNome && !clienteId) return [];
    const baseList = catalogProdutos.filter((p) => {
      if (clienteId && p.cliente_id && p.cliente_id === clienteId) return true;
      return (
        !!clienteNome &&
        p.cliente_nome?.toLowerCase() === clienteNome.toLowerCase()
      );
    });

    return filterProdutosByOrigem({
      produtos: baseList,
      origemTipo,
      clienteId,
      clienteNome,
      vasilhames,
      estoque: entradas,
      isotanques,
      transbordos,
      containers,
    });
  }, [
    catalogProdutos,
    clienteId,
    clienteNome,
    origemTipo,
    vasilhames,
    entradas,
    isotanques,
    transbordos,
    containers,
  ]);

  const produtoSelecionado = useMemo(
    () => catalogProdutos.find((p) => p.id === produtoId) || null,
    [catalogProdutos, produtoId]
  );
  const densidadeTabelada = Boolean(produtoSelecionado?.densidade_tabelada);
  const produtoIndustrializacao = isProdutoIndustrializacao({
    id: produtoId,
    fonte: produtoFonte || produtoSelecionado?.fonte,
  });
  const destinoEfetivo = produtoIndustrializacao
    ? "industrializacao"
    : "convencional";

  const produtoOptionLabel = (p) => {
    const nome = p?.produto || p?.nome || "";
    const base = p?.codigo ? `${p.codigo} - ${nome}` : nome;
    if (origemTipo !== "granel" || !p?.fonte) return base;
    const source = t(
      p.fonte === "industrializacao"
        ? "painel.operacional.ordemTransbordo.productSource.mp"
        : "painel.operacional.ordemTransbordo.productSource.transbordo"
    );
    return `${base} · ${source}`;
  };

  const produtoDisplay = produtoSelecionado
    ? produtoOptionLabel(produtoSelecionado)
    : produtoCodigo
      ? `${produtoCodigo} - ${produtoNome}`
      : produtoNome;

  useEffect(() => {
    if (envaseModalOpen) return;
    if (produtoId && produtosDoCliente.length > 0) {
      const exists = produtosDoCliente.some((p) => p.id === produtoId);
      if (!exists) {
        setProdutoId("");
        setProdutoNome("");
        setProdutoCodigo("");
        setProdutoFonte("");
        moduloValidacaoRef.current = "convencional";
        setGranel((prev) => ({ ...prev, densidade: "" }));
      }
    }
  }, [produtosDoCliente, produtoId, envaseModalOpen]);

  // Densidade tabelada/cadastrada preenche o formulário; senão o operador
  // informa no campo. Fallback no cadastro do produto se o campo estiver vazio.
  const headerDensidade =
    parseDensidade(granel.densidade) ||
    parseDensidade(produtoSelecionado?.densidade);

  const qtdKgDeclarada = loteToKg({
    quantidade: granel.quantidade,
    unidade_medida: granel.unidade,
    densidade: headerDensidade,
    tipo_recebimento: "granel",
  });

  const gPb = Number(granel.pesoBruto) || 0;
  const gPl = Number(granel.pesoLiquido) || 0;
  const valBruto = gPb >= 10000 && gPb <= 40000 ? 60 : 80;
  const valLiquido = gPl >= 10000 && gPl <= 40000 ? 60 : 80;
  const erroAdmissivel = valBruto + valLiquido;
  const pesoMinimo = qtdKgDeclarada - erroAdmissivel;
  const pesoMaximo = qtdKgDeclarada + erroAdmissivel;
  const dentroMargem = gPl > 0 && gPl >= pesoMinimo && gPl <= pesoMaximo;
  const foraMargem = gPl > 0 && !dentroMargem;

  const handleClienteChange = (_label, item) => {
    setClienteId(item?.id || "");
    setClienteNome(item?.nome || "");
    setProdutoId("");
    setProdutoNome("");
    setProdutoCodigo("");
    setProdutoFonte("");
    moduloValidacaoRef.current = "convencional";
    clearOperacaoOrigens();
    setGranel((prev) => ({
      ...prev,
      densidade: "",
      lote: "",
      quantidade: "",
      ...(origemTipo === "tanka" || origemTipo === "vasilhame"
        ? { unidade: "L" }
        : {}),
    }));
    setFormError("");
  };

  const handleProdutoChange = (_label, item) => {
    const nextId = item?.id || "";
    const nextFonte = item?.fonte || "";
    const densCadastro = item?.densidade || "";
    setProdutoId(nextId);
    setProdutoNome(item?.produto || item?.nome || "");
    setProdutoCodigo(item?.codigo || "");
    setProdutoFonte(nextFonte);
    moduloValidacaoRef.current = isProdutoIndustrializacao({
      id: nextId,
      fonte: nextFonte,
    })
      ? "industrializacao"
      : "convencional";
    clearOperacaoOrigens();
    setGranel((prev) => ({
      ...prev,
      // Cadastro do produto (tabelada ou não). Sem cadastro, origem preenche depois.
      densidade: densCadastro || "",
      lote: "",
      quantidade: "",
      ...(origemTipo === "tanka" || origemTipo === "vasilhame"
        ? { unidade: "L" }
        : {}),
    }));
    setFormError("");
  };

  const handleOrigemChange = (_label, item) => {
    const next = item?.value || "";
    const crossesGranel =
      origemTipo !== next && (origemTipo === "granel" || next === "granel");
    setOrigemTipo(next);
    setProdutoId("");
    setProdutoNome("");
    setProdutoCodigo("");
    setProdutoFonte("");
    moduloValidacaoRef.current = "convencional";
    clearOperacaoOrigens();
    setGranel({
      ...emptyGranel(),
      ...(next === "tanka" || next === "vasilhame" ? { unidade: "L" } : {}),
    });
    if (crossesGranel) {
      setClienteId("");
      setClienteNome("");
    }
    setFormError("");
  };

  const patchGranel = (field, value) => {
    setGranel((prev) => ({ ...prev, [field]: value }));
    setFormError("");
  };

  const validateHeader = () => {
    if (!dataOp) return t("painel.operacional.ordemTransbordo.errors.date");
    if (!origemTipo) return t("painel.operacional.ordemTransbordo.errors.origin");
    if (!clienteNome) return t("painel.operacional.ordemTransbordo.errors.client");
    if (!produtoId) return t("painel.operacional.ordemTransbordo.errors.product");
    return "";
  };

  const tankasComSaldo = useMemo(() => {
    if (origemTipo !== "tanka" || !produtoId) return [];
    const produtoCtx = {
      produtoId,
      produtoNome,
      produtoCodigo,
      clienteId,
      clienteNome,
    };
    return (isotanques || [])
      .filter((i) => matchesProdutoOperacional(i, produtoCtx))
      .map((i) => {
        const codigo = i.nome || i.tanka || i.codigo_itku || "";
        const saldo = computeTankaSaldo({
          isotanqueId: i.id,
          tankaCodigo: codigo,
          transbordos,
        });
        const lotes = computeTankaLotesDisponiveis({
          isotanqueId: i.id,
          tankaCodigo: codigo,
          transbordos,
        });
        const detalhe = buildTankaDetalhe({
          isotanque: i,
          transbordos,
        });
        return {
          ...i,
          tankaCodigo: codigo,
          saldo_atual: saldo,
          lotes_disponiveis: lotes,
          densidade_entrada:
            parseDensidade(detalhe?.densidade) ||
            parseDensidade(i.densidade) ||
            0,
          display_label: `${codigo} - ${formatVolume(saldo)} - L`,
        };
      })
      .filter((i) => roundVolume(i.saldo_atual || 0) > 0)
      .sort((a, b) =>
        String(a.tankaCodigo).localeCompare(String(b.tankaCodigo), "pt-BR", {
          sensitivity: "base",
        })
      );
  }, [
    origemTipo,
    produtoId,
    produtoNome,
    produtoCodigo,
    clienteId,
    clienteNome,
    isotanques,
    transbordos,
  ]);

  const applyDensidadeFromSources = (tankaRow = null) => {
    const densProduto = parseDensidade(produtoSelecionado?.densidade);
    if (densProduto > 0) return densProduto;
    const densForm = parseDensidade(granel.densidade);
    if (densForm > 0) return densForm;
    return (
      parseDensidade(tankaRow?.densidade_entrada) ||
      parseDensidade(tankaRow?.densidade) ||
      0
    );
  };

  const tankaOptionsForItem = (itemIndex) =>
    tankasComSaldo.map((tanka) => {
      const usedElse = tankaItens.reduce((s, it, i) => {
        if (i === itemIndex) return s;
        if (it.tankaId !== tanka.id) return s;
        return s + (Number(it.quantidade) || 0);
      }, 0);
      const saldoDisp = roundVolume((tanka.saldo_atual || 0) - usedElse);
      return {
        ...tanka,
        saldo_disponivel_item: saldoDisp,
        display_label: `${tanka.tankaCodigo} - ${formatVolume(Math.max(0, saldoDisp))} - L`,
      };
    }).filter((t) => t.id === tankaItens[itemIndex]?.tankaId || t.saldo_disponivel_item > 0);

  const lotesOptionsForItem = (itemIndex) => {
    const item = tankaItens[itemIndex];
    if (!item?.tankaId) return [];
    const tanka = tankasComSaldo.find((t) => t.id === item.tankaId);
    if (!tanka) return [];
    return (tanka.lotes_disponiveis || [])
      .map((l) => {
        const usedElse = tankaItens.reduce((s, it, i) => {
          if (i === itemIndex) return s;
          if (it.tankaId !== item.tankaId) return s;
          if (String(it.lote || "") !== String(l.lote || "")) return s;
          return s + (Number(it.quantidade) || 0);
        }, 0);
        const qtdDisp = roundVolume((l.quantidade_l || 0) - usedElse);
        return {
          ...l,
          quantidade_l: qtdDisp,
          display_label: `${l.lote || "—"} - ${formatVolume(Math.max(0, qtdDisp))} - L`,
        };
      })
      .filter(
        (l) =>
          l.quantidade_l > 0 ||
          String(l.lote || "") === String(item.lote || "")
      );
  };

  const patchTankaItem = (idx, patch, densOverride) => {
    setTankaItens((prev) => {
      const next = prev.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      syncGranelFromTankaItens(next, densOverride);
      return next;
    });
    setFormError("");
  };

  const handleTankaItemChange = (idx, _label, tankaRow) => {
    const nextId = tankaRow?.id || "";
    const nextCodigo = tankaRow?.tankaCodigo || tankaRow?.nome || "";
    const lotes = tankaRow?.lotes_disponiveis || [];
    const dens = applyDensidadeFromSources(tankaRow);
    const densVal = dens > 0 ? dens : undefined;
    if (lotes.length === 1) {
      const only = lotes[0];
      // Desconta o que outras linhas já usaram deste lote.
      const usedElse = tankaItens.reduce((s, it, i) => {
        if (i === idx) return s;
        if (it.tankaId !== nextId) return s;
        if (String(it.lote || "") !== String(only.lote || "")) return s;
        return s + (Number(it.quantidade) || 0);
      }, 0);
      const qtdDisp = roundVolume((only.quantidade_l || 0) - usedElse);
      patchTankaItem(
        idx,
        {
          tankaId: nextId,
          tankaCodigo: nextCodigo,
          lote: only.lote || "",
          quantidade: qtdDisp > 0 ? qtdDisp : "",
        },
        densVal
      );
    } else {
      patchTankaItem(
        idx,
        {
          tankaId: nextId,
          tankaCodigo: nextCodigo,
          lote: "",
          quantidade: "",
        },
        densVal
      );
    }
  };

  const handleTankaLoteChange = (idx, _label, loteRow) => {
    const loteVal = loteRow?.lote || "";
    const qtdL = roundVolume(loteRow?.quantidade_l || 0);
    patchTankaItem(idx, {
      lote: loteVal,
      quantidade: qtdL > 0 ? qtdL : "",
    });
  };

  const addTankaItem = () => {
    setTankaItens((prev) => [...prev, emptyTankaItem()]);
    setFormError("");
  };

  const removeTankaItem = (idx) => {
    setTankaItens((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      syncGranelFromTankaItens(next);
      return next;
    });
    setFormError("");
  };

  const vasilhamesNoPatio = useMemo(() => {
    if (origemTipo !== "vasilhame" || !produtoId) return [];
    const produtoCtx = {
      produtoId,
      produtoNome,
      produtoCodigo,
      clienteId,
      clienteNome,
    };
    return (vasilhames || [])
      .filter(
        (v) =>
          (v.status || "No Pátio") === "No Pátio" &&
          matchesProdutoOperacional(v, produtoCtx) &&
          roundVolume(v.volume || 0) > 0
      )
      .map((v) => {
        const lotes = aggregateComposicaoByLote(seedComposicaoFromVasilhame(v))
          .filter((l) => roundVolume(l.quantidade_l || 0) > 0)
          .map((l) => ({
            lote: l.lote || "",
            quantidade_l: roundVolume(l.quantidade_l || 0),
          }));
        const placa = String(v.placa || "").trim();
        const barril = String(v.barril || "").trim();
        const ident =
          placa || barril || v.codigo || v.container_number || "Vasilhame";
        const identLabel = placa
          ? `${placa}${barril ? ` - ${barril}` : ""}`
          : barril || ident;
        const vol = roundVolume(v.volume || 0);
        return {
          ...v,
          lotes_disponiveis: lotes,
          lote_label: formatLotesLabel(lotes) || v.lote || "",
          densidade_entrada: parseDensidade(v.densidade) || 0,
          display_label: `${identLabel} - ${formatVolume(vol)} - L`,
          identLabel,
        };
      })
      .sort((a, b) =>
        String(a.identLabel).localeCompare(String(b.identLabel), "pt-BR", {
          sensitivity: "base",
        })
      );
  }, [
    origemTipo,
    produtoId,
    produtoNome,
    produtoCodigo,
    clienteId,
    clienteNome,
    vasilhames,
  ]);

  const vasilhameOptionsForItem = (itemIndex) => {
    const selectedIds = new Set(
      vasilhameItens
        .map((it, i) => (i === itemIndex ? null : it.vasilhameId))
        .filter(Boolean)
    );
    return vasilhamesNoPatio.filter(
      (v) =>
        v.id === vasilhameItens[itemIndex]?.vasilhameId || !selectedIds.has(v.id)
    );
  };

  const patchVasilhameItem = (idx, patch, densOverride) => {
    setVasilhameItens((prev) => {
      const next = prev.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      syncGranelFromOrigemItens(next, densOverride);
      return next;
    });
    setFormError("");
  };

  const handleVasilhameItemChange = (idx, _label, row) => {
    const nextId = row?.id || "";
    const lotes = row?.lotes_disponiveis || [];
    const densProduto = parseDensidade(produtoSelecionado?.densidade);
    const dens =
      densProduto > 0
        ? densProduto
        : parseDensidade(row?.densidade_entrada) ||
          parseDensidade(row?.densidade) ||
          parseDensidade(granel.densidade) ||
          0;
    const vol = roundVolume(row?.volume || 0);
    patchVasilhameItem(
      idx,
      {
        vasilhameId: nextId,
        placa: String(row?.placa || "").trim(),
        barril: String(row?.barril || "").trim(),
        lote: row?.lote_label || formatLotesLabel(lotes) || row?.lote || "",
        quantidade: vol > 0 ? vol : "",
        lotes,
      },
      dens > 0 ? dens : undefined
    );
  };

  const addVasilhameItem = () => {
    setVasilhameItens((prev) => [...prev, emptyVasilhameItem()]);
    setFormError("");
  };

  const removeVasilhameItem = (idx) => {
    setVasilhameItens((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      syncGranelFromOrigemItens(next);
      return next;
    });
    setFormError("");
  };

  /** Lote / quantidade / unidade / densidade — comum a todas as origens. */
  const validateQuantidadeBasica = () => {
    if (origemTipo === "tanka") {
      if (tankaItens.length === 0) {
        return t("painel.operacional.ordemTransbordo.errors.tanka");
      }
      for (let i = 0; i < tankaItens.length; i++) {
        const it = tankaItens[i];
        if (!it.tankaId) {
          return t("painel.operacional.ordemTransbordo.errors.tanka");
        }
        if (!String(it.lote || "").trim()) {
          return t("painel.operacional.ordemTransbordo.errors.lot");
        }
        if (!(Number(it.quantidade) > 0)) {
          return t("painel.operacional.ordemTransbordo.errors.qty");
        }
      }
      if (!densidadeTabelada && !(Number(granel.densidade) > 0) && !(headerDensidade > 0)) {
        return t("painel.operacional.ordemTransbordo.errors.density");
      }
      return "";
    }
    if (origemTipo === "vasilhame") {
      if (vasilhameItens.length === 0) {
        return t("painel.operacional.ordemTransbordo.errors.vasilhame");
      }
      for (let i = 0; i < vasilhameItens.length; i++) {
        const it = vasilhameItens[i];
        if (!it.vasilhameId) {
          return t("painel.operacional.ordemTransbordo.errors.vasilhame");
        }
        if (!(Number(it.quantidade) > 0)) {
          return t("painel.operacional.ordemTransbordo.errors.qty");
        }
      }
      if (!densidadeTabelada && !(Number(granel.densidade) > 0) && !(headerDensidade > 0)) {
        return t("painel.operacional.ordemTransbordo.errors.density");
      }
      return "";
    }
    const qtd = Number(granel.quantidade) || 0;
    if (qtd <= 0) return t("painel.operacional.ordemTransbordo.errors.qty");
    if (!granel.unidade) return t("painel.operacional.ordemTransbordo.errors.unit");
    if (!granel.lote.trim()) return t("painel.operacional.ordemTransbordo.errors.lot");
    if (!densidadeTabelada && !(Number(granel.densidade) > 0) && !(headerDensidade > 0)) {
      return t("painel.operacional.ordemTransbordo.errors.density");
    }
    return "";
  };

  const validateGranel = () => {
    const headerErr = validateHeader();
    if (headerErr) return headerErr;
    if (!granel.notaFiscal.trim()) {
      return t("painel.operacional.ordemTransbordo.errors.nf");
    }
    const qtdErr = validateQuantidadeBasica();
    if (qtdErr) return qtdErr;
    if (gPb <= 0) return t("painel.operacional.ordemTransbordo.errors.gross");
    if (gPl <= 0) return t("painel.operacional.ordemTransbordo.errors.net");
    return "";
  };

  const origemTipoOperacional = useMemo(() => {
    if (origemTipo === "granel") return "entrada";
    return ORIGEM_VALUES.find((o) => o.value === origemTipo)?.tipoOrigem || origemTipo;
  }, [origemTipo]);

  const buildGranelPayload = () => {
    // Densidade efetiva: prioriza o que está no formulário (populado a partir
    // do produto no handleProdutoChange). Fallback: cadastro do produto.
    // Persistimos SEMPRE a densidade que rendeu a validação da margem — assim
    // a Entrada gerada na validação usa o mesmo fator L → kg exibido na tela.
    const densidadeEfetiva =
      granel.densidade || produtoSelecionado?.densidade || "";
    const loteBase = {
      produto_id: transbordoFkId(produtoId),
      produto_nome: produtoNome,
      produto_codigo: produtoCodigo,
      nota_fiscal: granel.notaFiscal.trim(),
      lote: granel.lote.trim(),
      fornecedor: (granel.fornecedor || "").trim(),
      data_fabricacao: granel.fabricacao || null,
      data_validade: granel.validade || null,
      densidade: densidadeEfetiva,
      quantidade: Number(granel.quantidade) || 0,
      quantidade_nf: Number(granel.quantidade) || 0,
      unidade_medida: granel.unidade,
      preco_unitario: Number(granel.precoUnitario) || 0,
      tipo_recebimento: "granel",
      embalado: false,
    };
    const lotes = foraMargem
      ? applyPesoLiquidoForaMargem([loteBase], gPl)
      : [loteBase];
    const first = lotes[0];
    const qtdKgEfetiva = lotes.reduce((sum, l) => sum + loteToKg(l), 0);
    const qtdDeclarada = Number(getLoteQuantidadeDeclarada(loteBase)) || 0;

    return {
      data: dataOp,
      cliente_id: transbordoFkId(clienteId),
      cliente_nome: clienteNome,
      produto_id: transbordoFkId(produtoId),
      produto_nome: produtoNome,
      produto_codigo: produtoCodigo,
      nota_fiscal: first.nota_fiscal,
      lote: first.lote,
      fornecedor: first.fornecedor || null,
      data_fabricacao: first.data_fabricacao || null,
      data_validade: first.data_validade || null,
      densidade: first.densidade,
      saldo_inicial: qtdKgEfetiva,
      quantidade: qtdKgEfetiva,
      unidade_medida: "kg",
      preco_unitario: first.preco_unitario,
      custo_total: (Number(first.quantidade) || 0) * (first.preco_unitario || 0),
      saldo_final: qtdKgEfetiva,
      saldo_atual: qtdKgEfetiva,
      embalado: false,
      status_wms: false,
      origem: destinoEfetivo,
      granel_pesagem: true,
      granel_ticket: granel.ticket || null,
      granel_peso_bruto: gPb,
      granel_validacao_bruto: valBruto,
      granel_peso_liquido: gPl,
      granel_validacao_liquido: valLiquido,
      granel_erro_admissivel: erroAdmissivel,
      granel_peso_minimo: pesoMinimo,
      granel_peso_maximo: pesoMaximo,
      granel_margem: gPl > 0 ? (dentroMargem ? "dentro" : "fora") : null,
      lotes: lotes.map((l) => ({
        ...l,
        quantidade_declarada: qtdDeclarada,
      })),
    };
  };

  const openEnvaseModal = (granelPayload = null) => {
    setPendingGranelPayload(granelPayload);
    setSaveError("");
    setEnvaseModalOpen(true);
  };

  const handleIrParaTransbordo = async () => {
    if (!orderOperator?.id) {
      setAuthOpen(true);
      return;
    }
    const headerErr = validateHeader();
    if (headerErr) {
      setFormError(headerErr);
      return;
    }

    moduloValidacaoRef.current = produtoIndustrializacao
      ? "industrializacao"
      : "convencional";

    if (origemTipo === "granel") {
      const granelErr = validateGranel();
      if (granelErr) {
        setFormError(granelErr);
        return;
      }
      setGoingToTransbordo(true);
      setFormError("");
      try {
        openEnvaseModal(buildGranelPayload());
      } catch (err) {
        console.error("[OrdemTransbordo] granel prefill:", err);
        setFormError(
          err?.message ||
            t("painel.operacional.ordemTransbordo.errors.saveEntrada")
        );
      } finally {
        setGoingToTransbordo(false);
      }
      return;
    }

    const qtdErr = validateQuantidadeBasica();
    if (qtdErr) {
      setFormError(qtdErr);
      return;
    }

    setFormError("");
    openEnvaseModal(null);
  };

  const resetForm = () => {
    setPendingGranelPayload(null);
    setGranel(emptyGranel());
    clearOperacaoOrigens();
    setOrigemTipo("");
    setDataOp(todayISO());
    setClienteId("");
    setClienteNome("");
    setProdutoId("");
    setProdutoNome("");
    setProdutoCodigo("");
    setProdutoFonte("");
    moduloValidacaoRef.current = "convencional";
  };

  const submitOrdem = async ({ granelPayload = null, transbordoPayload = null } = {}) => {
    const isGranel = origemTipo === "granel" && Boolean(granelPayload);
    const tipo = isGranel ? "granel_transbordo" : "transbordo";
    const origemTipoSave = isGranel
      ? "granel"
      : ORIGEM_VALUES.find((o) => o.value === origemTipo)?.tipoOrigem ||
        origemTipo;
    const header = {
      data: dataOp,
      cliente_id: transbordoFkId(clienteId),
      cliente_nome: clienteNome,
      produto_id: transbordoFkId(produtoId),
      produto_nome: produtoNome,
      produto_codigo: produtoCodigo,
    };
    const criadoPor = orderOperator?.id
      ? { id: orderOperator.id, nome: orderOperator.nome || null }
      : null;
    if (!criadoPor) {
      throw new Error(t("painel.operacional.ordemTransbordo.operatorAuth.missingOperator"));
    }
    const payload = {
      tipo,
      origemTipo: origemTipoSave,
      header,
      granelPayload: isGranel ? granelPayload : null,
      transbordoPayload,
      criadoPor,
    };

    const destinoSave =
      moduloValidacaoRef.current === "industrializacao" ||
      produtoIndustrializacao ||
      granelPayload?.origem === "industrializacao" ||
      granelPayload?.origem === "MATERIA_PRIMA" ||
      String(produtoId).startsWith("ind-")
        ? "industrializacao"
        : "convencional";
    if (destinoSave === "industrializacao") {
      await criarValidacaoIndustrializacao(payload);
    } else {
      await criarValidacao(payload);
    }
    await loadData({ silent: true });
    setEnvaseModalOpen(false);
    resetForm();
    setOrderOperator(null);
    toast({
      title: t("painel.operacional.ordemTransbordo.saveSuccessTitle"),
      description: t(
        destinoSave === "industrializacao"
          ? "painel.operacional.ordemTransbordo.saveSuccessValidacaoIndDescription"
          : "painel.operacional.ordemTransbordo.saveSuccessValidacaoDescription"
      ),
    });
  };

  const abandonOrder = () => {
    setEnvaseModalOpen(false);
    setPendingGranelPayload(null);
    setSaveError("");
    setFormError("");
    resetForm();
    setOrderOperator(null);
  };

  const handleQuantidadeFromModal = (value) => {
    if (origemTipo === "tanka") {
      // Uma origem: edita o item; várias: o total é a soma — editar por origem.
      if (tankaItens.length === 1) {
        patchTankaItem(0, { quantidade: value === "" ? "" : value });
      }
      return;
    }
    if (origemTipo === "vasilhame") {
      if (vasilhameItens.length === 1) {
        patchVasilhameItem(0, { quantidade: value === "" ? "" : value });
      }
      return;
    }
    patchGranel("quantidade", value);
  };

  const handleTankaOrigemQuantidadeFromModal = (index, value) => {
    if (origemTipo === "tanka") {
      patchTankaItem(index, { quantidade: value === "" ? "" : value });
      return;
    }
    if (origemTipo === "vasilhame") {
      patchVasilhameItem(index, { quantidade: value === "" ? "" : value });
    }
  };

  const handleSaveTransbordo = async (data) => {
    setSaveError("");
    if (!orderOperator?.id) {
      setSaveError(t("painel.operacional.ordemTransbordo.operatorAuth.missingOperator"));
      return;
    }
    try {
      // Quantidade pode ter sido editada no modal — regenera o payload granel.
      const granelPayload =
        origemTipo === "granel" ? buildGranelPayload() : null;
      const operadoresTransbordo = Array.isArray(data?.operadores)
        ? data.operadores.filter(Boolean)
        : [];
      await submitOrdem({
        granelPayload,
        transbordoPayload: {
          ...data,
          operadores:
            operadoresTransbordo.length > 0
              ? operadoresTransbordo
              : orderOperator.nome
                ? [orderOperator.nome]
                : [],
          operador_usuario_id: String(orderOperator.id),
        },
      });
    } catch (err) {
      console.error("[OrdemTransbordo] save:", err);
      setSaveError(
        err?.message || t("painel.operacional.ordemTransbordo.errors.saveTransbordo")
      );
    }
  };

  const handlePrintRelatorio = useCallback(
    (validacao) => {
      navigate(
        `/painel/operacional/ordem-transbordo/relatorio/${validacao.destino}/${validacao.id}`
      );
    },
    [navigate]
  );

  const remapUpdatedView = (updated, destino) => {
    if (!updated) return null;
    if (destino === "industrializacao") {
      return normalizeValidacaoView({
        ...updated,
        destino: "industrializacao",
        granel_payload: updated.entrada_payload || updated.granel_payload,
        sortAt: updated.created_date || updated.created_at || updated.data || "",
      });
    }
    return normalizeValidacaoView({
      ...updated,
      destino: "convencional",
      sortAt: updated.created_at || updated.data || "",
    });
  };

  const handleSaveCamposView = async ({
    header,
    granelPayload,
    transbordoPayload,
    openEnvase = false,
    deferPersist = false,
  }) => {
    if (!viewValidacao?.id) return;
    const destino = viewValidacao.destino || "convencional";

    // Alteração de pesagem/volume: abre envase sem gravar. Cancelar = descarta.
    if (deferPersist && openEnvase) {
      const pendingRaw = {
        ...viewValidacao,
        ...(header?.quantidade != null ? { quantidade: header.quantidade } : {}),
        ...(header?.unidade_medida
          ? { unidade_medida: header.unidade_medida }
          : {}),
        ...(header?.lote != null ? { lote: header.lote } : {}),
        granel_payload: granelPayload ?? viewValidacao.granel_payload,
        entrada_payload: granelPayload ?? viewValidacao.entrada_payload,
        transbordo_payload: transbordoPayload ?? viewValidacao.transbordo_payload,
      };
      setEditViewValidacao(remapUpdatedView(pendingRaw, destino) || pendingRaw);
      setEditViewError("");
      setEditViewOpen(true);
      return;
    }

    setViewSaving(true);
    try {
      let updated;
      if (destino === "industrializacao") {
        updated = await atualizarValidacaoIndustrializacao({
          id: viewValidacao.id,
          header: header || null,
          ...(granelPayload != null ? { entradaPayload: granelPayload } : {}),
          ...(transbordoPayload != null ? { transbordoPayload } : {}),
        });
      } else {
        updated = await atualizarValidacaoTransbordoPayload({
          id: viewValidacao.id,
          header: header || null,
          granelPayload,
          transbordoPayload,
        });
      }
      await loadData({ silent: true });
      const remapped = remapUpdatedView(updated, destino);
      setViewValidacao(remapped);
      if (openEnvase) {
        setEditViewValidacao(remapped);
        setEditViewError("");
        setEditViewOpen(true);
      }
      toast({
        title: t("transbordo.validacao.editSuccessTitle", {
          defaultValue: "Validação atualizada",
        }),
        description: t("transbordo.validacao.editSuccessDescription", {
          defaultValue: "Alterações salvas com sucesso.",
        }),
      });
    } catch (err) {
      console.error("[OrdemTransbordo] save campos view:", err);
      throw err;
    } finally {
      setViewSaving(false);
    }
  };

  const handleEditTransbordoFromView = () => {
    if (!viewValidacao || viewValidacao.status !== "pendente") return;
    setEditViewValidacao(viewValidacao);
    setEditViewError("");
    setEditViewOpen(true);
  };

  const handleSaveEditFromView = async (
    transbordoPayload,
    granelFromEditor = null
  ) => {
    if (!editViewValidacao?.id) return;
    const destino = editViewValidacao.destino || "convencional";
    setEditViewError("");
    try {
      let updated;
      if (destino === "industrializacao") {
        const nextEntrada = granelFromEditor
          ? granelFromEditor
          : editViewValidacao.granel_payload ||
            editViewValidacao.entrada_payload ||
            null;
        const syncedEntrada = nextEntrada
          ? {
              ...nextEntrada,
              data: transbordoPayload.data || nextEntrada.data,
              cliente_nome:
                transbordoPayload.cliente_nome || nextEntrada.cliente_nome,
              produto_nome:
                transbordoPayload.produto_nome || nextEntrada.produto_nome,
              produto_codigo:
                transbordoPayload.produto_codigo || nextEntrada.produto_codigo,
              densidade: transbordoPayload.densidade || nextEntrada.densidade,
            }
          : null;
        updated = await atualizarValidacaoIndustrializacao({
          id: editViewValidacao.id,
          entradaPayload: syncedEntrada,
          transbordoPayload,
        });
      } else {
        const nextGranel = granelFromEditor
          ? granelFromEditor
          : editViewValidacao.granel_payload
            ? {
                ...editViewValidacao.granel_payload,
                data:
                  transbordoPayload.data ||
                  editViewValidacao.granel_payload.data,
                cliente_id:
                  transbordoPayload.cliente_id ||
                  editViewValidacao.granel_payload.cliente_id,
                cliente_nome:
                  transbordoPayload.cliente_nome ||
                  editViewValidacao.granel_payload.cliente_nome,
                produto_id:
                  transbordoPayload.produto_id ||
                  editViewValidacao.granel_payload.produto_id,
                produto_nome:
                  transbordoPayload.produto_nome ||
                  editViewValidacao.granel_payload.produto_nome,
                produto_codigo:
                  transbordoPayload.produto_codigo ||
                  editViewValidacao.granel_payload.produto_codigo,
                densidade:
                  transbordoPayload.densidade ||
                  editViewValidacao.granel_payload.densidade,
              }
            : null;
        updated = await atualizarValidacaoTransbordoPayload({
          id: editViewValidacao.id,
          transbordoPayload,
          granelPayload: nextGranel,
        });
      }
      await loadData({ silent: true });
      if (viewOpen && viewValidacao?.id === editViewValidacao.id) {
        setViewValidacao(remapUpdatedView(updated, destino));
      }
      setEditViewOpen(false);
      setEditViewValidacao(null);
      toast({
        title: t("transbordo.validacao.editSuccessTitle", {
          defaultValue: "Validação atualizada",
        }),
        description: t("transbordo.validacao.editSuccessDescription", {
          defaultValue: "Alterações salvas com sucesso.",
        }),
      });
    } catch (err) {
      console.error("[OrdemTransbordo] edit from view:", err);
      setEditViewError(
        err?.message ||
          t("transbordo.validacao.errors.editGeneric", {
            defaultValue: "Não foi possível salvar a edição.",
          })
      );
    }
  };

  const fixedOperador = useMemo(
    () =>
      orderOperator?.id
        ? { id: String(orderOperator.id), nome: orderOperator.nome || "" }
        : null,
    [orderOperator]
  );

  const clientEnabled = Boolean(origemTipo);
  const productEnabled = Boolean(clientEnabled && clienteNome);

  const clientPlaceholder = !origemTipo
    ? t("painel.operacional.ordemTransbordo.placeholders.originFirst")
    : t("painel.operacional.ordemTransbordo.placeholders.client");

  const productPlaceholder = !productEnabled
    ? !origemTipo
      ? t("painel.operacional.ordemTransbordo.placeholders.originFirst")
      : t("painel.operacional.ordemTransbordo.placeholders.productDisabled")
    : t("painel.operacional.ordemTransbordo.placeholders.product");

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden gap-4">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold text-foreground">
          {t("painel.operacional.sections.ordemTransbordo.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t("painel.operacional.ordemTransbordo.subtitle")}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pr-0.5 space-y-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t("painel.operacional.ordemTransbordo.formTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!orderOperator ? (
              <div className="flex flex-col items-start gap-3 py-2">
                <p className="text-sm text-muted-foreground">
                  {t("painel.operacional.ordemTransbordo.operatorAuth.hint")}
                </p>
                <Button
                  type="button"
                  onClick={() => setAuthOpen(true)}
                  className="bg-primary hover:bg-primary/90 gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {t("painel.operacional.ordemTransbordo.operatorAuth.newOrder")}
                </Button>
              </div>
            ) : (
            <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">
                  {t("painel.operacional.ordemTransbordo.operatorAuth.responsible")}
                </span>{" "}
                <span className="font-medium">{orderOperator.nome}</span>
              </p>
              <Button type="button" variant="ghost" onClick={abandonOrder}>
                {t("painel.operacional.ordemTransbordo.operatorAuth.cancelOrder")}
              </Button>
            </div>
            {formError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>{t("painel.operacional.ordemTransbordo.fields.date")} *</Label>
                <DateInputBr
                  value={dataOp}
                  onChange={setDataOp}
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("painel.operacional.ordemTransbordo.fields.origin")} *</Label>
                <SearchableSelect
                  value={
                    origemOptions.find((o) => o.value === origemTipo)?.label || ""
                  }
                  onChange={handleOrigemChange}
                  options={origemOptions}
                  getOptionLabel={(o) => o.label}
                  getOptionValue={(o) => o.value}
                  placeholder={t("painel.operacional.ordemTransbordo.placeholders.origin")}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("painel.operacional.ordemTransbordo.fields.client")} *</Label>
                <SearchableSelect
                  value={clienteNome}
                  onChange={handleClienteChange}
                  options={clientes}
                  getOptionLabel={(c) => c.nome}
                  getOptionValue={(c) => c.id}
                  placeholder={clientPlaceholder}
                  disabled={!clientEnabled}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                <Label>{t("painel.operacional.ordemTransbordo.fields.product")} *</Label>
                <SearchableSelect
                  value={produtoDisplay}
                  onChange={handleProdutoChange}
                  options={produtosDoCliente}
                  getOptionLabel={produtoOptionLabel}
                  getOptionValue={(p) => p.id}
                  placeholder={productPlaceholder}
                  disabled={!productEnabled}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
            </div>

            {origemTipo && origemTipo !== "granel" && produtoId && (
              <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("painel.operacional.ordemTransbordo.operacao.title", {
                      defaultValue: "Dados da operação",
                    })}
                  </p>
                  {origemTipo === "tanka" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addTankaItem}
                      className="gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t("painel.operacional.ordemTransbordo.addTankaItem")}
                    </Button>
                  )}
                  {origemTipo === "vasilhame" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addVasilhameItem}
                      className="gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t("painel.operacional.ordemTransbordo.addVasilhameItem")}
                    </Button>
                  )}
                </div>

                {origemTipo === "tanka" ? (
                  <div className="space-y-3">
                    {tankasComSaldo.length === 0 && (
                      <p className="text-xs text-amber-700">
                        {t("painel.operacional.ordemTransbordo.tankaEmpty")}
                      </p>
                    )}
                    {tankaItens.map((item, idx) => {
                      const tankaOpts = tankaOptionsForItem(idx);
                      const loteOpts = lotesOptionsForItem(idx);
                      const selectedTanka =
                        tankaOpts.find((o) => o.id === item.tankaId) ||
                        tankasComSaldo.find((o) => o.id === item.tankaId);
                      const selectedLote =
                        loteOpts.find((l) => l.lote === item.lote) || null;
                      return (
                        <div
                          key={item.key}
                          className="rounded-lg border border-border bg-card p-3 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold text-primary">
                              {t(
                                "painel.operacional.ordemTransbordo.tankaItemLabel",
                                { n: String(idx + 1).padStart(2, "0") }
                              )}
                            </p>
                            {tankaItens.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeTankaItem(idx)}
                                className="rounded p-1 text-red-400 hover:bg-destructive/10 hover:text-red-600"
                                aria-label={t("buttons.delete", {
                                  defaultValue: "Remover",
                                })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                            <div className="space-y-1.5">
                              <Label>
                                {t(
                                  "painel.operacional.ordemTransbordo.fields.tanka"
                                )}{" "}
                                *
                              </Label>
                              <SearchableSelect
                                value={
                                  selectedTanka?.display_label ||
                                  item.tankaCodigo ||
                                  ""
                                }
                                onChange={(label, row) =>
                                  handleTankaItemChange(idx, label, row)
                                }
                                options={tankaOpts}
                                getOptionLabel={(o) => o.display_label}
                                getOptionValue={(o) => o.id}
                                placeholder={t(
                                  "painel.operacional.ordemTransbordo.placeholders.tanka"
                                )}
                                inputClassName={INPUT_EDITABLE}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>
                                {t(
                                  "painel.operacional.ordemTransbordo.fields.lot"
                                )}{" "}
                                *
                              </Label>
                              <SearchableSelect
                                value={
                                  selectedLote?.display_label || item.lote || ""
                                }
                                onChange={(label, row) =>
                                  handleTankaLoteChange(idx, label, row)
                                }
                                options={loteOpts}
                                getOptionLabel={(o) => o.display_label}
                                getOptionValue={(o) => o.lote}
                                placeholder={
                                  item.tankaId
                                    ? t(
                                        "painel.operacional.ordemTransbordo.placeholders.lot"
                                      )
                                    : t(
                                        "painel.operacional.ordemTransbordo.placeholders.tankaFirst"
                                      )
                                }
                                disabled={!item.tankaId}
                                inputClassName={INPUT_EDITABLE}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>
                                {t(
                                  "painel.operacional.ordemTransbordo.fields.qty"
                                )}{" "}
                                *
                              </Label>
                              <NumberInputBr
                                decimals={3}
                                trimTrailingZeros
                                min={0}
                                value={item.quantidade}
                                onChange={(v) =>
                                  patchTankaItem(idx, {
                                    quantidade: v === "" ? "" : v,
                                  })
                                }
                                placeholder="0"
                                className={INPUT_EDITABLE}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>
                                {t(
                                  "painel.operacional.ordemTransbordo.fields.unit"
                                )}{" "}
                                *
                              </Label>
                              <Input value="L" disabled className="bg-muted/50" />
                            </div>
                            <div className="space-y-1.5">
                              <Label>
                                {t(
                                  "painel.operacional.ordemTransbordo.fields.density"
                                )}
                                {densidadeTabelada ? "" : " *"}
                              </Label>
                              <NumberInputBr
                                decimals={4}
                                min={0}
                                value={granel.densidade}
                                onChange={(v) =>
                                  patchGranel("densidade", v === "" ? "" : v)
                                }
                                placeholder="0"
                                disabled={densidadeTabelada || idx > 0}
                                className={INPUT_EDITABLE}
                              />
                              {idx === 0 && densidadeTabelada ? (
                                <p className="text-xs text-muted-foreground">
                                  {t(
                                    "painel.operacional.ordemTransbordo.densityListed"
                                  )}
                                </p>
                              ) : null}
                              {idx === 0 &&
                              !densidadeTabelada &&
                              parseDensidade(granel.densidade) > 0 &&
                              !(
                                parseDensidade(produtoSelecionado?.densidade) > 0
                              ) ? (
                                <p className="text-xs text-muted-foreground">
                                  {t(
                                    "painel.operacional.ordemTransbordo.densityFromEntrada"
                                  )}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "painel.operacional.ordemTransbordo.tankaTotalVolume"
                      )}
                      :{" "}
                      <strong className="text-foreground tabular-nums">
                        {formatVolume(Number(granel.quantidade) || 0)} L
                      </strong>
                    </p>
                  </div>
                ) : origemTipo === "vasilhame" ? (
                  <div className="space-y-3">
                    {vasilhamesNoPatio.length === 0 && (
                      <p className="text-xs text-amber-700">
                        {t("painel.operacional.ordemTransbordo.vasilhameEmpty")}
                      </p>
                    )}
                    {vasilhameItens.map((item, idx) => {
                      const vasOpts = vasilhameOptionsForItem(idx);
                      const selectedVas =
                        vasOpts.find((o) => o.id === item.vasilhameId) ||
                        vasilhamesNoPatio.find(
                          (o) => o.id === item.vasilhameId
                        );
                      return (
                        <div
                          key={item.key}
                          className="rounded-lg border border-border bg-card p-3 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold text-primary">
                              {t(
                                "painel.operacional.ordemTransbordo.tankaItemLabel",
                                { n: String(idx + 1).padStart(2, "0") }
                              )}
                            </p>
                            {vasilhameItens.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeVasilhameItem(idx)}
                                className="rounded p-1 text-red-400 hover:bg-destructive/10 hover:text-red-600"
                                aria-label={t("buttons.delete", {
                                  defaultValue: "Remover",
                                })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                            <div className="space-y-1.5">
                              <Label>
                                {t(
                                  "painel.operacional.ordemTransbordo.fields.tanque"
                                )}{" "}
                                *
                              </Label>
                              <SearchableSelect
                                value={
                                  selectedVas?.display_label ||
                                  item.placa ||
                                  item.barril ||
                                  ""
                                }
                                onChange={(label, row) =>
                                  handleVasilhameItemChange(idx, label, row)
                                }
                                options={vasOpts}
                                getOptionLabel={(o) => o.display_label}
                                getOptionValue={(o) => o.id}
                                placeholder={t(
                                  "painel.operacional.ordemTransbordo.placeholders.tanque"
                                )}
                                inputClassName={INPUT_EDITABLE}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>
                                {t(
                                  "painel.operacional.ordemTransbordo.fields.lot"
                                )}{" "}
                                *
                              </Label>
                              <Input
                                value={item.lote || ""}
                                disabled
                                className="bg-muted/50"
                                placeholder={
                                  item.vasilhameId
                                    ? "—"
                                    : t(
                                        "painel.operacional.ordemTransbordo.placeholders.tanqueFirst"
                                      )
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>
                                {t(
                                  "painel.operacional.ordemTransbordo.fields.qty"
                                )}{" "}
                                *
                              </Label>
                              <NumberInputBr
                                decimals={3}
                                trimTrailingZeros
                                min={0}
                                value={item.quantidade}
                                onChange={(v) =>
                                  patchVasilhameItem(idx, {
                                    quantidade: v === "" ? "" : v,
                                  })
                                }
                                placeholder="0"
                                className={INPUT_EDITABLE}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>
                                {t(
                                  "painel.operacional.ordemTransbordo.fields.unit"
                                )}{" "}
                                *
                              </Label>
                              <Input value="L" disabled className="bg-muted/50" />
                            </div>
                            <div className="space-y-1.5">
                              <Label>
                                {t(
                                  "painel.operacional.ordemTransbordo.fields.density"
                                )}
                                {densidadeTabelada ? "" : " *"}
                              </Label>
                              <NumberInputBr
                                decimals={4}
                                min={0}
                                value={granel.densidade}
                                onChange={(v) =>
                                  patchGranel("densidade", v === "" ? "" : v)
                                }
                                placeholder="0"
                                disabled={densidadeTabelada || idx > 0}
                                className={INPUT_EDITABLE}
                              />
                              {idx === 0 && densidadeTabelada ? (
                                <p className="text-xs text-muted-foreground">
                                  {t(
                                    "painel.operacional.ordemTransbordo.densityListed"
                                  )}
                                </p>
                              ) : null}
                              {idx === 0 &&
                              !densidadeTabelada &&
                              parseDensidade(granel.densidade) > 0 &&
                              !(
                                parseDensidade(produtoSelecionado?.densidade) > 0
                              ) ? (
                                <p className="text-xs text-muted-foreground">
                                  {t(
                                    "painel.operacional.ordemTransbordo.densityFromEntrada"
                                  )}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "painel.operacional.ordemTransbordo.tankaTotalVolume"
                      )}
                      :{" "}
                      <strong className="text-foreground tabular-nums">
                        {formatVolume(Number(granel.quantidade) || 0)} L
                      </strong>
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <Label>
                        {t("painel.operacional.ordemTransbordo.fields.lot")} *
                      </Label>
                      <Input
                        value={granel.lote}
                        onChange={(e) => patchGranel("lote", e.target.value)}
                        placeholder={t(
                          "painel.operacional.ordemTransbordo.placeholders.lot"
                        )}
                        className={INPUT_EDITABLE}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        {t("painel.operacional.ordemTransbordo.fields.qty")} *
                      </Label>
                      <NumberInputBr
                        decimals={0}
                        min={0}
                        value={granel.quantidade}
                        onChange={(v) =>
                          patchGranel("quantidade", v === "" ? "" : v)
                        }
                        placeholder="0"
                        className={INPUT_EDITABLE}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        {t("painel.operacional.ordemTransbordo.fields.unit")} *
                      </Label>
                      <SearchableSelect
                        value={granel.unidade}
                        onChange={(_label, item) =>
                          patchGranel("unidade", item?.value || "")
                        }
                        options={UNIDADES.map((u) => ({ value: u }))}
                        getOptionLabel={(u) => u.value}
                        getOptionValue={(u) => u.value}
                        placeholder={t(
                          "painel.operacional.ordemTransbordo.placeholders.unit"
                        )}
                        inputClassName={INPUT_EDITABLE}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        {t("painel.operacional.ordemTransbordo.fields.density")}
                        {densidadeTabelada ? "" : " *"}
                      </Label>
                      <NumberInputBr
                        decimals={4}
                        min={0}
                        value={granel.densidade}
                        onChange={(v) =>
                          patchGranel("densidade", v === "" ? "" : v)
                        }
                        placeholder="0"
                        disabled={densidadeTabelada}
                        className={INPUT_EDITABLE}
                      />
                      {densidadeTabelada && (
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "painel.operacional.ordemTransbordo.densityListed"
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {origemTipo === "granel" && produtoId && (
              <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("painel.operacional.ordemTransbordo.granel.title")}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>{t("painel.operacional.ordemTransbordo.fields.nf")} *</Label>
                    <Input
                      value={granel.notaFiscal}
                      onChange={(e) => patchGranel("notaFiscal", e.target.value)}
                      placeholder={t("painel.operacional.ordemTransbordo.placeholders.nf")}
                      className={INPUT_EDITABLE}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("painel.operacional.ordemTransbordo.fields.qty")} *</Label>
                    <NumberInputBr
                      decimals={0}
                      min={0}
                      value={granel.quantidade}
                      onChange={(v) => patchGranel("quantidade", v === "" ? "" : v)}
                      placeholder="0"
                      className={INPUT_EDITABLE}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("painel.operacional.ordemTransbordo.fields.unit")} *</Label>
                    <SearchableSelect
                      value={granel.unidade}
                      onChange={(_label, item) =>
                        patchGranel("unidade", item?.value || "")
                      }
                      options={UNIDADES.map((u) => ({ value: u }))}
                      getOptionLabel={(u) => u.value}
                      getOptionValue={(u) => u.value}
                      placeholder={t("painel.operacional.ordemTransbordo.placeholders.unit")}
                      inputClassName={INPUT_EDITABLE}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("painel.operacional.ordemTransbordo.fields.lot")} *</Label>
                    <Input
                      value={granel.lote}
                      onChange={(e) => patchGranel("lote", e.target.value)}
                      placeholder={t("painel.operacional.ordemTransbordo.placeholders.lot")}
                      className={INPUT_EDITABLE}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      {t("painel.operacional.ordemTransbordo.fields.density")}
                      {densidadeTabelada ? "" : " *"}
                    </Label>
                    <NumberInputBr
                      decimals={4}
                      min={0}
                      value={granel.densidade}
                      onChange={(v) => patchGranel("densidade", v === "" ? "" : v)}
                      placeholder="0"
                      disabled={densidadeTabelada}
                      className={INPUT_EDITABLE}
                    />
                    {densidadeTabelada && (
                      <p className="text-xs text-muted-foreground">
                        {t("painel.operacional.ordemTransbordo.densityListed")}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("painel.operacional.ordemTransbordo.fields.unitPrice")}</Label>
                    <NumberInputBr
                      decimals={4}
                      min={0}
                      value={granel.precoUnitario}
                      onChange={(v) => patchGranel("precoUnitario", v === "" ? "" : v)}
                      placeholder="0"
                      className={INPUT_EDITABLE}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("painel.operacional.ordemTransbordo.fields.supplier")}</Label>
                    <Input
                      value={granel.fornecedor || ""}
                      onChange={(e) => patchGranel("fornecedor", e.target.value)}
                      placeholder={t("painel.operacional.ordemTransbordo.placeholders.supplier")}
                      className={INPUT_EDITABLE}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("painel.operacional.ordemTransbordo.fields.manufacture")}</Label>
                    <DateInputBr
                      value={granel.fabricacao || ""}
                      onChange={(v) => patchGranel("fabricacao", v || "")}
                      className={INPUT_EDITABLE}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("painel.operacional.ordemTransbordo.fields.expiry")}</Label>
                    <DateInputBr
                      value={granel.validade || ""}
                      onChange={(v) => patchGranel("validade", v || "")}
                      className={INPUT_EDITABLE}
                    />
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("painel.operacional.ordemTransbordo.weighing.title")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label>{t("painel.operacional.ordemTransbordo.fields.ticket")}</Label>
                      <Input
                        value={granel.ticket}
                        onChange={(e) => patchGranel("ticket", e.target.value)}
                        placeholder={t("painel.operacional.ordemTransbordo.placeholders.ticket")}
                        className={INPUT_EDITABLE}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("painel.operacional.ordemTransbordo.fields.gross")} *</Label>
                      <NumberInputBr
                        decimals={0}
                        min={0}
                        value={granel.pesoBruto}
                        onChange={(v) => patchGranel("pesoBruto", v === "" ? "" : v)}
                        placeholder="0"
                        className={INPUT_EDITABLE}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className={foraMargem ? "text-red-700" : undefined}>
                        {t("painel.operacional.ordemTransbordo.fields.net")} *
                      </Label>
                      <NumberInputBr
                        decimals={0}
                        min={0}
                        value={granel.pesoLiquido}
                        onChange={(v) => patchGranel("pesoLiquido", v === "" ? "" : v)}
                        placeholder="0"
                        className={
                          foraMargem
                            ? "bg-red-50 border-red-400 text-red-800 font-semibold"
                            : INPUT_EDITABLE
                        }
                      />
                    </div>
                  </div>

                  {qtdKgDeclarada > 0 && (
                    <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-blue-200">
                      <span className="text-sm text-muted-foreground">
                        {t("painel.operacional.ordemTransbordo.weighing.expected")}
                        {granel.unidade && granel.unidade !== "kg"
                          ? ` — ${t("painel.operacional.ordemTransbordo.weighing.convertedFrom", {
                              qty: formatNum(Number(granel.quantidade) || 0, 0),
                              unit: granel.unidade,
                            })}`
                          : ""}
                        :
                      </span>
                      <span className="text-lg font-bold text-primary">
                        {formatMass(qtdKgDeclarada)} kg
                      </span>
                    </div>
                  )}

                  {gPl > 0 && (
                    <>
                      <div
                        className={`flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium ${
                          dentroMargem
                            ? "bg-green-50 text-green-700 border border-green-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {dentroMargem ? (
                          <CheckCircle className="w-5 h-5" />
                        ) : (
                          <AlertCircle className="w-5 h-5" />
                        )}
                        {dentroMargem
                          ? t("painel.operacional.ordemTransbordo.weighing.inside")
                          : t("painel.operacional.ordemTransbordo.weighing.outside")}
                      </div>
                      {foraMargem && (
                        <div className="flex items-center justify-center gap-2 py-3 rounded-lg bg-amber-50 border-2 border-amber-400 text-amber-800">
                          <span className="text-sm font-semibold text-center">
                            {t("painel.operacional.ordemTransbordo.weighing.outsideHint", {
                              weight: formatMass(gPl),
                            })}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={handleIrParaTransbordo}
                disabled={goingToTransbordo || !origemTipo || !clienteNome || !produtoId}
                className="bg-primary hover:bg-primary/90 gap-2"
              >
                {goingToTransbordo
                  ? t("common.processing")
                  : t("painel.operacional.ordemTransbordo.goToTransbordo")}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
            </>
            )}
          </CardContent>
        </Card>

        <PendentesCard
          validacoes={validacoesPendentes}
          t={t}
          onView={(v) => {
            setViewValidacao(v);
            setViewOpen(true);
          }}
          onPrint={handlePrintRelatorio}
        />
      </div>

      <ValidacaoViewDialog
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewValidacao(null);
        }}
        validacao={viewValidacao}
        produtos={[...produtosTb, ...produtosMp, ...produtosPa]}
        entradas={entradas}
        canEdit
        saving={viewSaving}
        onSaveCampos={handleSaveCamposView}
        onEditTransbordo={handleEditTransbordoFromView}
      />

      <ValidacaoOrdemEnvaseEditor
        open={editViewOpen}
        onClose={() => {
          setEditViewOpen(false);
          setEditViewValidacao(null);
          setEditViewError("");
        }}
        onSave={handleSaveEditFromView}
        validacao={editViewValidacao}
        isotanques={isotanques}
        vasilhames={vasilhames}
        transbordos={transbordos}
        externalError={editViewError}
      />

      <OrdemTransbordoEnvaseModal
        open={envaseModalOpen}
        onClose={() => {
          setEnvaseModalOpen(false);
          setPendingGranelPayload(null);
          setSaveError("");
        }}
        onSave={handleSaveTransbordo}
        onQuantidadeChange={handleQuantidadeFromModal}
        onTankaOrigemQuantidadeChange={handleTankaOrigemQuantidadeFromModal}
        productLabel={produtoDisplay}
        produtoId={produtoId}
        produtoNome={produtoNome}
        produtoCodigo={produtoCodigo}
        lote={granel.lote}
        quantidade={granel.quantidade}
        unidade={granel.unidade}
        densidade={headerDensidade}
        dataOp={dataOp}
        clienteId={clienteId}
        clienteNome={clienteNome}
        origemTipoOperacional={origemTipoOperacional}
        tankaOrigens={
          origemTipo === "tanka"
            ? tankaItens.map((it) => ({
                tankaId: it.tankaId,
                tankaCodigo: it.tankaCodigo,
                lote: it.lote,
                quantidade: it.quantidade,
              }))
            : []
        }
        vasilhameOrigens={
          origemTipo === "vasilhame"
            ? vasilhameItens.map((it) => {
                const lotesRet = allocateQtyToLotes(
                  it.lotes || [],
                  Number(it.quantidade) || 0
                );
                const label =
                  [it.placa, it.barril].filter(Boolean).join(" - ") ||
                  "Vasilhame";
                return {
                  vasilhameId: it.vasilhameId,
                  codigo: label,
                  lote: it.lote,
                  quantidade: it.quantidade,
                  lotes_retirados: lotesRet,
                  lotes_disponiveis: (it.lotes || []).map((l) => ({
                    lote: l.lote || "",
                    quantidade_l: roundVolume(l.quantidade_l || 0),
                  })),
                };
              })
            : []
        }
        quantidadeEditable={
          (origemTipo !== "tanka" && origemTipo !== "vasilhame") ||
          (origemTipo === "tanka" && tankaItens.length === 1) ||
          (origemTipo === "vasilhame" && vasilhameItens.length === 1)
        }
        granelPayload={pendingGranelPayload}
        isotanques={isotanques}
        vasilhames={vasilhames}
        transbordos={transbordos}
        fixedOperador={fixedOperador}
        externalError={saveError}
      />

      <OperadorOrdemAuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onAuthenticated={(operator) => {
          setOrderOperator(operator);
          setAuthOpen(false);
          setFormError("");
        }}
      />
    </div>
  );
}

function PendentesCard({ validacoes, t, onView, onPrint }) {
  if (!validacoes || validacoes.length === 0) return null;

  const viewLabel = t("painel.operacional.ordemTransbordo.pendentes.view", {
    defaultValue: "Visualizar",
  });
  const printLabel = t("painel.operacional.ordemTransbordo.pendentes.print", {
    defaultValue: "Imprimir relatório",
  });

  const formatDateBR = (iso) => {
    if (!iso) return "-";
    try {
      const [y, m, d] = String(iso).slice(0, 10).split("-");
      if (!y || !m || !d) return iso;
      return `${d}/${m}/${y}`;
    } catch {
      return iso;
    }
  };

  const formatQty = (v) => {
    const { quantidade, unidade_medida } = resumoQuantidadeValidacao(v);
    return {
      quantidade: quantidade > 0 ? formatNum(quantidade) : "-",
      unidade: unidade_medida || "-",
    };
  };

  const resolveOrigemBadge = (v) => {
    const parseOrigemItem = (raw) => {
      const key = String(raw || "").trim().toLowerCase();
      if (!key) return null;
      if (key === "granel" || key === "entrada") {
        return {
          key: "granel",
          label: t
            ? t("painel.operacional.ordemTransbordo.origem.granel", {
                defaultValue: "GRANEL",
              })
            : "GRANEL",
          badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
        };
      }
      if (key === "tanka") {
        return {
          key: "tanka",
          label: t
            ? t("painel.operacional.ordemTransbordo.origem.tanka", {
                defaultValue: "TANKA",
              })
            : "TANKA",
          badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
        };
      }
      if (key === "vasilhame") {
        return {
          key: "vasilhame",
          label: t
            ? t("painel.operacional.ordemTransbordo.origem.vasilhame", {
                defaultValue: "VASILHAME",
              })
            : "VASILHAME",
          badgeClass: "bg-orange-50 text-orange-700 border-orange-200",
        };
      }
      if (
        key === "embalado" ||
        key === "ibc" ||
        key === "bombona" ||
        key === "tambor"
      ) {
        return {
          key: "embalado",
          label: t
            ? t("painel.operacional.ordemTransbordo.origem.embalado", {
                defaultValue: "IBC / BOMBONA / TAMBOR",
              })
            : "IBC / BOMBONA / TAMBOR",
          badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
        };
      }
      return {
        key,
        label: String(raw).toUpperCase(),
        badgeClass: "bg-slate-50 text-slate-700 border-slate-200",
      };
    };

    if (v.origem_tipo) {
      const item = parseOrigemItem(v.origem_tipo);
      if (item) return [item];
    }
    if (v.tipo === "granel_transbordo" || v.granel_payload || v.entrada_payload) {
      const item = parseOrigemItem("granel");
      if (item) return [item];
    }
    const origens = v.transbordo_payload?.origens || [];
    if (origens.length > 0) {
      const uniqueMap = new Map();
      origens.forEach((o) => {
        const item = parseOrigemItem(o.tipo_origem);
        if (item && !uniqueMap.has(item.key)) {
          uniqueMap.set(item.key, item);
        }
      });
      if (uniqueMap.size > 0) return Array.from(uniqueMap.values());
    }
    return [];
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-600" />
          <CardTitle className="text-base">
            {t("painel.operacional.ordemTransbordo.pendentes.title", {
              defaultValue: "Pendentes de validação",
            })}
          </CardTitle>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">
            {validacoes.length}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">
                  {t("transbordo.validacao.table.data", { defaultValue: "Data" })}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("painel.operacional.ordemTransbordo.fields.operacao", {
                    defaultValue: "Operação",
                  })}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("painel.operacional.ordemTransbordo.fields.origin", {
                    defaultValue: "Origem",
                  })}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("transbordo.validacao.table.operador", { defaultValue: "Operador" })}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("transbordo.validacao.table.cliente", { defaultValue: "Cliente" })}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("transbordo.validacao.table.produto", { defaultValue: "Produto" })}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("transbordo.validacao.table.lote", { defaultValue: "Lote" })}
                </th>
                <th className="px-4 py-2 font-medium text-right">
                  {t("transbordo.validacao.table.quantidade", { defaultValue: "Qtd" })}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("transbordo.validacao.table.unidade", { defaultValue: "Un." })}
                </th>
                <th className="px-4 py-2 font-medium text-right">
                  {t("common.actions", { defaultValue: "Ações" })}
                </th>
              </tr>
            </thead>
            <tbody>
              {validacoes.map((v) => {
                const qtd = formatQty(v);
                const origemBadges = resolveOrigemBadge(v);
                return (
                <tr
                  key={`${v.destino}-${v.id}`}
                  className="border-t border-border hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-2 font-medium text-foreground">
                    {v.numero ?? "-"}
                  </td>
                  <td className="px-4 py-2 text-foreground/80">
                    {formatDateBR(v.data)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                        v.destino === "industrializacao"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-slate-50 text-slate-700 border-slate-200"
                      }`}
                    >
                      {t(`painel.logistica.recebimento.destino.${v.destino}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {origemBadges.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {origemBadges.map((b) => (
                          <span
                            key={b.key}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${b.badgeClass}`}
                          >
                            {b.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-foreground/50">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-foreground/80">
                    {v.criado_por_nome || "-"}
                  </td>
                  <td className="px-4 py-2 text-foreground/80">
                    {v.cliente_nome || "-"}
                  </td>
                  <td className="px-4 py-2 text-foreground/80">
                    {[v.produto_codigo, v.produto_nome].filter(Boolean).join(" - ") || "-"}
                  </td>
                  <td className="px-4 py-2 text-foreground/80">
                    {v.lote || "-"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-foreground/80">
                    {qtd.quantidade}
                  </td>
                  <td className="px-4 py-2 uppercase text-foreground/60 text-xs">
                    {qtd.unidade}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      <Can permission={`${PERM}.view`}>
                        <RowActionButton
                          onClick={() => onView?.(v)}
                          title={viewLabel}
                          aria-label={viewLabel}
                        >
                          <Eye />
                        </RowActionButton>
                        <RowActionButton
                          onClick={() => onPrint?.(v)}
                          title={printLabel}
                          aria-label={printLabel}
                        >
                          <Printer />
                        </RowActionButton>
                      </Can>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
