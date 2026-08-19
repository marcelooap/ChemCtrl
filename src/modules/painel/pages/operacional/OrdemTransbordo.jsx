import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowRight, CheckCircle, Clock } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { useToast } from "@shared/components/ui/use-toast";
import { Can } from "@industrializacao/lib/rbac/Can";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import DateInputBr from "@transbordo/components/cadastro/DateInputBr";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { UNIDADES } from "@transbordo/components/entrada/LoteBlock";
import TransbordoModal from "@transbordo/components/transbordo/TransbordoModal";
import { entities } from "@transbordo/services/entities";
import { base44 } from "@industrializacao/api/base44Client";
import {
  buildGranelPrefillFromPayload,
  criarValidacao,
  resumoQuantidadeValidacao,
} from "@transbordo/lib/validacaoTransbordo";
import { criarValidacaoIndustrializacao } from "@industrializacao/lib/validacaoIndustrializacao";
import { useInternalAuth } from "@/lib/InternalAuthContext";
import {
  applyPesoLiquidoForaMargem,
  getLoteQuantidadeDeclarada,
  loteToKg,
} from "@transbordo/lib/conversao";
import { formatMass, formatNum, parseDensidade } from "@transbordo/lib/format";
import {
  buildMpProdutos,
  buildPaProdutos,
  catalogProdutosByDestino,
  clientsFromProdutos,
  uniqueClientesByNome,
} from "@painel/lib/recebimentoCatalog";

const INPUT_EDITABLE = "bg-white";
const PERM = "painel_operacional_ordem_transbordo";

const ORIGEM_VALUES = [
  { value: "granel", tipoOrigem: "entrada" },
  { value: "tanka", tipoOrigem: "tanka" },
  { value: "vasilhame", tipoOrigem: "vasilhame" },
  { value: "embalado", tipoOrigem: "embalado" },
];

const DESTINO_VALUES = [
  { value: "convencional" },
  { value: "industrializacao" },
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
    densidade: "",
    precoUnitario: "",
    ticket: "",
    pesoBruto: "",
    pesoLiquido: "",
  };
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
    .map((v) => ({
      ...v,
      destino: "convencional",
      granel_payload: v.granel_payload,
      transbordo_payload: v.transbordo_payload,
      sortAt: v.created_at || v.data || "",
    }));

  const industriais = (valsInd || [])
    .filter((v) => v.status === "pendente" && isOrdemTransbordoTipo(v.tipo))
    .map((v) => ({
      ...v,
      destino: "industrializacao",
      granel_payload: v.entrada_payload || v.granel_payload,
      transbordo_payload: v.transbordo_payload,
      sortAt: v.created_date || v.created_at || v.data || "",
    }));

  return [...convencionais, ...industriais].sort((a, b) =>
    String(b.sortAt).localeCompare(String(a.sortAt))
  );
}

export default function OrdemTransbordo() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useInternalAuth();

  const [loading, setLoading] = useState(true);
  const [clientesTb, setClientesTb] = useState([]);
  const [produtosTb, setProdutosTb] = useState([]);
  const [produtosMp, setProdutosMp] = useState([]);
  const [produtosPa, setProdutosPa] = useState([]);
  const [transbordos, setTransbordos] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [isotanques, setIsotanques] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [validacoesPendentes, setValidacoesPendentes] = useState([]);
  const [pendingGranelPayload, setPendingGranelPayload] = useState(null);

  const [dataOp, setDataOp] = useState(todayISO);
  const [destino, setDestino] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [produtoNome, setProdutoNome] = useState("");
  const [produtoCodigo, setProdutoCodigo] = useState("");
  const [origemTipo, setOrigemTipo] = useState("");
  const [granel, setGranel] = useState(emptyGranel);
  const [formError, setFormError] = useState("");
  const [goingToTransbordo, setGoingToTransbordo] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [prefillEntrada, setPrefillEntrada] = useState(null);
  const [headerPrefill, setHeaderPrefill] = useState(null);
  const [prefillOrigemTipo, setPrefillOrigemTipo] = useState("");

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [trans, prods, cliens, ents, isos, vascs, vals, recipes, stocks, valsInd] =
        await Promise.all([
          entities.transbordos.list("-created_date"),
          entities.produtos.list(),
          entities.clientes.list(),
          entities.estoque.list(),
          entities.isotanques.list(),
          entities.vasilhames.list(),
          entities.transbordoValidacoes.list("-created_at"),
          base44.entities.Recipe.list("-created_date", 2000),
          base44.entities.RawMaterialStock.list("-created_date", 2000),
          base44.entities.IndValidacao.list("-created_date", 500).catch(() => []),
        ]);
      setTransbordos(trans || []);
      setProdutosTb(prods || []);
      setClientesTb(cliens || []);
      setEntradas(ents || []);
      setIsotanques(isos || []);
      setVasilhames(vascs || []);
      setProdutosMp(buildMpProdutos(recipes || [], stocks || []));
      setProdutosPa(buildPaProdutos(recipes || []));
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

  const destinoOptions = useMemo(
    () =>
      DESTINO_VALUES.map((o) => ({
        ...o,
        label: t(`painel.logistica.recebimento.destino.${o.value}`),
      })),
    [t]
  );

  const isIndustrializacao = destino === "industrializacao";

  const catalogProdutos = useMemo(
    () =>
      catalogProdutosByDestino({
        destino,
        tipoOrOrigem: origemTipo,
        produtosTb,
        produtosMp,
        produtosPa,
      }),
    [destino, origemTipo, produtosTb, produtosMp, produtosPa]
  );

  const clientes = useMemo(() => {
    if (destino === "industrializacao") {
      return clientsFromProdutos(catalogProdutos);
    }
    if (destino === "convencional") return uniqueClientesByNome(clientesTb);
    return [];
  }, [destino, catalogProdutos, clientesTb]);

  const produtosDoCliente = useMemo(() => {
    if (!clienteNome && !clienteId) return [];
    return catalogProdutos.filter((p) => {
      if (clienteId && p.cliente_id && p.cliente_id === clienteId) return true;
      return (
        !!clienteNome &&
        p.cliente_nome?.toLowerCase() === clienteNome.toLowerCase()
      );
    });
  }, [catalogProdutos, clienteId, clienteNome]);

  const produtoSelecionado = useMemo(
    () => catalogProdutos.find((p) => p.id === produtoId) || null,
    [catalogProdutos, produtoId]
  );
  const densidadeTabelada = Boolean(produtoSelecionado?.densidade_tabelada);
  const produtoDisplay = produtoCodigo
    ? `${produtoCodigo} - ${produtoNome}`
    : produtoNome;

  // Prioriza o valor do formulário (populado a partir do produto no
  // handleProdutoChange). Fallback: densidade cadastrada no produto.
  // Assim, L/gal são sempre convertidos p/ kg quando há densidade — mesmo
  // padrão da tela Entradas do módulo Transbordo.
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
    setGranel((prev) => ({ ...prev, densidade: "" }));
    setFormError("");
  };

  const handleProdutoChange = (_label, item) => {
    setProdutoId(item?.id || "");
    setProdutoNome(item?.produto || item?.nome || "");
    setProdutoCodigo(item?.codigo || "");
    setGranel((prev) => ({
      ...prev,
      densidade: item?.densidade_tabelada ? item.densidade || "" : "",
    }));
    setFormError("");
  };

  const clearClienteProduto = () => {
    setClienteId("");
    setClienteNome("");
    setProdutoId("");
    setProdutoNome("");
    setProdutoCodigo("");
    setGranel((prev) => ({ ...prev, densidade: "" }));
  };

  const handleDestinoChange = (_label, item) => {
    setDestino(item?.value || "");
    setOrigemTipo("");
    clearClienteProduto();
    setFormError("");
  };

  const handleOrigemChange = (_label, item) => {
    const next = item?.value || "";
    setOrigemTipo(next);
    if (destino === "industrializacao") {
      clearClienteProduto();
    }
    setFormError("");
  };

  const patchGranel = (field, value) => {
    setGranel((prev) => ({ ...prev, [field]: value }));
    setFormError("");
  };

  const buildHeaderPrefill = () => ({
    data: dataOp,
    cliente_id: transbordoFkId(clienteId),
    cliente_nome: clienteNome,
    produto_id: transbordoFkId(produtoId),
    produto_nome: produtoNome,
    produto_codigo: produtoCodigo,
    densidade: headerDensidade || granel.densidade,
  });

  const validateHeader = () => {
    if (!dataOp) return t("painel.operacional.ordemTransbordo.errors.date");
    if (!destino) return t("painel.operacional.ordemTransbordo.errors.destino");
    if (!origemTipo) return t("painel.operacional.ordemTransbordo.errors.origin");
    if (!clienteNome) return t("painel.operacional.ordemTransbordo.errors.client");
    if (!produtoId) return t("painel.operacional.ordemTransbordo.errors.product");
    return "";
  };

  const validateGranel = () => {
    const headerErr = validateHeader();
    if (headerErr) return headerErr;
    if (!granel.notaFiscal.trim()) {
      return t("painel.operacional.ordemTransbordo.errors.nf");
    }
    const qtd = Number(granel.quantidade) || 0;
    if (qtd <= 0) return t("painel.operacional.ordemTransbordo.errors.qty");
    if (!granel.unidade) return t("painel.operacional.ordemTransbordo.errors.unit");
    if (!granel.lote.trim()) return t("painel.operacional.ordemTransbordo.errors.lot");
    if (!densidadeTabelada && !(Number(granel.densidade) > 0)) {
      return t("painel.operacional.ordemTransbordo.errors.density");
    }
    if (gPb <= 0) return t("painel.operacional.ordemTransbordo.errors.gross");
    if (gPl <= 0) return t("painel.operacional.ordemTransbordo.errors.net");
    return "";
  };

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
      densidade: first.densidade,
      quantidade: qtdKgEfetiva,
      unidade_medida: "kg",
      preco_unitario: first.preco_unitario,
      custo_total: (Number(first.quantidade) || 0) * (first.preco_unitario || 0),
      saldo_atual: qtdKgEfetiva,
      embalado: false,
      status_wms: false,
      origem: destino === "industrializacao" ? "industrializacao" : "convencional",
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

  const openDestinosModal = ({
    entradaPrefill = null,
    origemTipoModal = "",
  }) => {
    setPrefillEntrada(entradaPrefill);
    setPrefillOrigemTipo(origemTipoModal);
    setHeaderPrefill(entradaPrefill ? null : buildHeaderPrefill());
    setSaveError("");
    setModalOpen(true);
  };

  const handleIrParaTransbordo = async () => {
    const headerErr = validateHeader();
    if (headerErr) {
      setFormError(headerErr);
      return;
    }

    if (origemTipo !== "granel") {
      const mapped = ORIGEM_VALUES.find((o) => o.value === origemTipo);
      setPendingGranelPayload(null);
      openDestinosModal({ origemTipoModal: mapped?.tipoOrigem || origemTipo });
      return;
    }

    const granelErr = validateGranel();
    if (granelErr) {
      setFormError(granelErr);
      return;
    }

    // Fluxo Granel: NÃO grava Entrada aqui. A Entrada só será criada quando o
    // responsável validar a operação em Transbordo → Validação.
    setGoingToTransbordo(true);
    setFormError("");
    try {
      const payload = buildGranelPayload();
      setPendingGranelPayload(payload);
      const entradaPrefill = buildGranelPrefillFromPayload(payload);
      openDestinosModal({ entradaPrefill });
    } catch (err) {
      console.error("[OrdemTransbordo] granel prefill:", err);
      setFormError(
        err?.message || t("painel.operacional.ordemTransbordo.errors.saveEntrada")
      );
    } finally {
      setGoingToTransbordo(false);
    }
  };

  const resetForm = () => {
    setPrefillEntrada(null);
    setHeaderPrefill(null);
    setPrefillOrigemTipo("");
    setPendingGranelPayload(null);
    setGranel(emptyGranel());
    setOrigemTipo("");
    setDestino("");
    setDataOp(todayISO());
    setClienteId("");
    setClienteNome("");
    setProdutoId("");
    setProdutoNome("");
    setProdutoCodigo("");
  };

  const handleSaveTransbordo = async (data) => {
    setSaveError("");
    try {
      const isGranel = origemTipo === "granel" && Boolean(pendingGranelPayload);
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
      const criadoPor = user
        ? { id: user.id, nome: user.nome || user.email || null }
        : null;
      const payload = {
        tipo,
        origemTipo: origemTipoSave,
        header,
        granelPayload: isGranel ? pendingGranelPayload : null,
        transbordoPayload: data,
        criadoPor,
      };

      if (destino === "industrializacao") {
        await criarValidacaoIndustrializacao(payload);
      } else {
        await criarValidacao(payload);
      }
      await loadData({ silent: true });
      setModalOpen(false);
      resetForm();
      toast({
        title: t("painel.operacional.ordemTransbordo.saveSuccessTitle"),
        description: t(
          destino === "industrializacao"
            ? "painel.operacional.ordemTransbordo.saveSuccessValidacaoIndDescription"
            : "painel.operacional.ordemTransbordo.saveSuccessValidacaoDescription"
        ),
      });
    } catch (err) {
      console.error("[OrdemTransbordo] save:", err);
      setSaveError(
        err?.message || t("painel.operacional.ordemTransbordo.errors.saveTransbordo")
      );
    }
  };

  const clientEnabled = Boolean(
    destino === "convencional" || (isIndustrializacao && origemTipo)
  );
  const productEnabled = Boolean(clientEnabled && clienteNome);

  const clientPlaceholder = !destino
    ? t("painel.operacional.ordemTransbordo.placeholders.destFirst")
    : isIndustrializacao && !origemTipo
      ? t("painel.operacional.ordemTransbordo.placeholders.originFirst")
      : t("painel.operacional.ordemTransbordo.placeholders.client");

  const productPlaceholder = !productEnabled
    ? !destino
      ? t("painel.operacional.ordemTransbordo.placeholders.destFirst")
      : isIndustrializacao && !origemTipo
        ? t("painel.operacional.ordemTransbordo.placeholders.originFirst")
        : t("painel.operacional.ordemTransbordo.placeholders.productDisabled")
    : isIndustrializacao && origemTipo === "vasilhame"
      ? t("painel.logistica.recebimento.placeholders.productPa")
      : isIndustrializacao
        ? t("painel.logistica.recebimento.placeholders.productMp")
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
                <Label>{t("painel.operacional.ordemTransbordo.fields.destino")} *</Label>
                <SearchableSelect
                  value={
                    destinoOptions.find((o) => o.value === destino)?.label || ""
                  }
                  onChange={handleDestinoChange}
                  options={destinoOptions}
                  getOptionLabel={(o) => o.label}
                  getOptionValue={(o) => o.value}
                  placeholder={t("painel.operacional.ordemTransbordo.placeholders.destino")}
                  inputClassName={INPUT_EDITABLE}
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
                  placeholder={
                    destino
                      ? t("painel.operacional.ordemTransbordo.placeholders.origin")
                      : t("painel.operacional.ordemTransbordo.placeholders.destFirst")
                  }
                  disabled={!destino}
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
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("painel.operacional.ordemTransbordo.fields.product")} *</Label>
                <SearchableSelect
                  value={produtoDisplay}
                  onChange={handleProdutoChange}
                  options={produtosDoCliente}
                  getOptionLabel={(p) =>
                    p.codigo
                      ? `${p.codigo} - ${p.produto || p.nome || ""}`
                      : p.produto || p.nome || ""
                  }
                  getOptionValue={(p) => p.id}
                  placeholder={productPlaceholder}
                  disabled={!productEnabled}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
            </div>

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
              <Can permission={`${PERM}.create`}>
                <Button
                  type="button"
                  onClick={handleIrParaTransbordo}
                  disabled={goingToTransbordo || !destino || !origemTipo || !clienteNome || !produtoId}
                  className="bg-primary hover:bg-primary/90 gap-2"
                >
                  {goingToTransbordo
                    ? t("common.processing")
                    : t("painel.operacional.ordemTransbordo.goToTransbordo")}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Can>
            </div>
          </CardContent>
        </Card>

        <PendentesCard
          validacoes={validacoesPendentes}
          t={t}
        />
      </div>

      <TransbordoModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setPrefillEntrada(null);
          setHeaderPrefill(null);
          setPrefillOrigemTipo("");
          setPendingGranelPayload(null);
          setSaveError("");
        }}
        onSave={handleSaveTransbordo}
        clientes={clientes}
        produtos={produtosTb}
        entradas={entradas}
        isotanques={isotanques}
        vasilhames={vasilhames}
        transbordos={transbordos}
        prefillEntrada={prefillEntrada}
        prefillOrigemTipo={prefillOrigemTipo}
        headerPrefill={headerPrefill}
        destinosOnly
        lockHeader
        externalError={saveError}
      />
    </div>
  );
}

function PendentesCard({ validacoes, t }) {
  if (!validacoes || validacoes.length === 0) return null;

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
                  {t("painel.operacional.ordemTransbordo.fields.destino")}
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
              </tr>
            </thead>
            <tbody>
              {validacoes.map((v) => {
                const qtd = formatQty(v);
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
