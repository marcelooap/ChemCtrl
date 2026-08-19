import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowRight, Clock, Plus } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/components/ui/card";
import { Label } from "@shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { useToast } from "@shared/components/ui/use-toast";
import { Can } from "@industrializacao/lib/rbac/Can";
import SearchableSelect from "@transbordo/components/cadastro/SearchableSelect";
import DateInputBr from "@transbordo/components/cadastro/DateInputBr";
import LoteBlock, { emptyLote } from "@transbordo/components/entrada/LoteBlock";
import { entities } from "@transbordo/services/entities";
import { base44 } from "@industrializacao/api/base44Client";
import { criarValidacao, resumoQuantidadeValidacao } from "@transbordo/lib/validacaoTransbordo";
import {
  criarValidacaoIndustrializacao,
  resumoQuantidadeValidacaoInd,
} from "@industrializacao/lib/validacaoIndustrializacao";
import {
  applyTipoRecebimento,
  buildEntradaPayload,
  todayISO,
  validateEntradaLotes,
} from "@transbordo/lib/entradaForm";
import {
  buildMpProdutos,
  buildPaProdutos,
  catalogProdutosByDestino,
  clientsFromProdutos,
  uniqueClientesByNome,
} from "@painel/lib/recebimentoCatalog";
import { formatMass, formatNum } from "@transbordo/lib/format";
import { loteToKg } from "@transbordo/lib/conversao";
import { useInternalAuth } from "@/lib/InternalAuthContext";

const INPUT_EDITABLE = "bg-white";
const PERM = "painel_logistica_recebimento";

const TIPO_VALUES = [
  { value: "embalado" },
  { value: "vasilhame" },
];

const DESTINO_VALUES = [
  { value: "convencional" },
  { value: "industrializacao" },
];

function seedLote({ tipo, produtoId, produtoNome, produtoCodigo, densidade }) {
  let lote = applyTipoRecebimento(emptyLote(), tipo || "embalado");
  lote = {
    ...lote,
    produto_id: produtoId || "",
    produto_nome: produtoNome || "",
    produto_codigo: produtoCodigo || "",
  };
  if (tipo === "vasilhame" && densidade) {
    lote.densidade = densidade;
  }
  return lote;
}

export default function LogisticaRecebimento() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useInternalAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clientesTb, setClientesTb] = useState([]);
  const [produtosTb, setProdutosTb] = useState([]);
  const [vasilhames, setVasilhames] = useState([]);
  const [produtosMp, setProdutosMp] = useState([]);
  const [produtosPa, setProdutosPa] = useState([]);

  const [dataOp, setDataOp] = useState(todayISO);
  const [clienteId, setClienteId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [produtoNome, setProdutoNome] = useState("");
  const [produtoCodigo, setProdutoCodigo] = useState("");
  const [tipoRecebimento, setTipoRecebimento] = useState("");
  const [destino, setDestino] = useState("");
  const [lotes, setLotes] = useState([]);
  const [formError, setFormError] = useState("");
  const [pendentes, setPendentes] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const lastTrioKey = useRef("");

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [cliens, prods, vascs, recipes, stocks, valsTb, valsInd] = await Promise.all([
        entities.clientes.list(),
        entities.produtos.list(),
        entities.vasilhames.list(),
        base44.entities.Recipe.list("-created_date", 2000),
        base44.entities.RawMaterialStock.list("-created_date", 2000),
        entities.transbordoValidacoes.list("-created_at").catch(() => []),
        base44.entities.IndValidacao.list("-created_date", 500).catch(() => []),
      ]);
      setClientesTb(cliens || []);
      setProdutosTb(prods || []);
      setVasilhames(vascs || []);
      setProdutosMp(buildMpProdutos(recipes || [], stocks || []));
      setProdutosPa(buildPaProdutos(recipes || []));
      setPendentes(
        mergeRecebimentoPendentes(valsTb || [], valsInd || [])
      );
    } catch (err) {
      console.error("[LogisticaRecebimento] load:", err);
      toast({
        title: t("painel.logistica.recebimento.loadErrorTitle"),
        description: t("painel.logistica.recebimento.loadErrorDescription"),
        variant: "destructive",
      });
    }
    if (!silent) setLoading(false);
  }, [t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const tipoOptions = useMemo(
    () =>
      TIPO_VALUES.map((o) => ({
        ...o,
        label: t(`painel.logistica.recebimento.tipo.${o.value}`),
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
        tipoOrOrigem: tipoRecebimento,
        produtosTb,
        produtosMp,
        produtosPa,
      }),
    [destino, tipoRecebimento, produtosMp, produtosPa, produtosTb]
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

  const produtoDisplay = produtoCodigo
    ? `${produtoCodigo} - ${produtoNome}`
    : produtoNome;

  const trioReady = Boolean(dataOp && destino && tipoRecebimento);
  const detailsReady = Boolean(trioReady && clienteNome && produtoId);

  useEffect(() => {
    const key = trioReady ? `${dataOp}|${destino}|${tipoRecebimento}` : "";
    if (!trioReady) {
      lastTrioKey.current = "";
      setModalOpen(false);
      return;
    }
    if (lastTrioKey.current !== key) {
      lastTrioKey.current = key;
      setLotes((prev) =>
        prev.length
          ? prev.map((l) => applyTipoRecebimento(l, tipoRecebimento))
          : [
              seedLote({
                tipo: tipoRecebimento,
                produtoId,
                produtoNome,
                produtoCodigo,
              }),
            ]
      );
      setModalOpen(true);
    }
  }, [trioReady, dataOp, destino, tipoRecebimento]);

  const clientEnabled = Boolean(trioReady);
  const productEnabled = Boolean(clientEnabled && clienteNome);

  const clientPlaceholder = !destino
    ? t("painel.logistica.recebimento.placeholders.destFirst")
    : isIndustrializacao && !tipoRecebimento
      ? t("painel.logistica.recebimento.placeholders.typeFirst")
      : t("painel.logistica.recebimento.placeholders.client");

  const productPlaceholder = !productEnabled
    ? !destino
      ? t("painel.logistica.recebimento.placeholders.destFirst")
      : isIndustrializacao && !tipoRecebimento
        ? t("painel.logistica.recebimento.placeholders.typeFirst")
        : t("painel.logistica.recebimento.placeholders.productDisabled")
    : isIndustrializacao && tipoRecebimento === "embalado"
      ? t("painel.logistica.recebimento.placeholders.productMp")
      : isIndustrializacao && tipoRecebimento === "vasilhame"
        ? t("painel.logistica.recebimento.placeholders.productPa")
        : t("painel.logistica.recebimento.placeholders.product");

  const qtdKg = lotes.reduce((sum, l) => sum + loteToKg(l), 0);

  const clearClienteProduto = () => {
    setClienteId("");
    setClienteNome("");
    setProdutoId("");
    setProdutoNome("");
    setProdutoCodigo("");
    setLotes([]);
  };

  const syncLotesFromHeader = ({
    nextTipo = tipoRecebimento,
    nextProdutoId = produtoId,
    nextProdutoNome = produtoNome,
    nextProdutoCodigo = produtoCodigo,
    nextDensidade,
  }) => {
    if (!nextTipo) {
      setLotes([]);
      return;
    }
    const dens =
      nextDensidade ??
      (produtoSelecionado?.densidade_tabelada ? produtoSelecionado.densidade : "");
    setLotes((prev) => {
      const source = prev.length
        ? prev
        : [
            seedLote({
              tipo: nextTipo,
              produtoId: nextProdutoId,
              produtoNome: nextProdutoNome,
              produtoCodigo: nextProdutoCodigo,
              densidade: dens,
            }),
          ];
      return source.map((l) => {
        let next = applyTipoRecebimento(l, nextTipo);
        next = {
          ...next,
          produto_id: nextProdutoId || next.produto_id || "",
          produto_nome: nextProdutoNome || next.produto_nome || "",
          produto_codigo: nextProdutoCodigo || next.produto_codigo || "",
        };
        if (nextTipo === "vasilhame" && dens && !next.densidade) {
          next.densidade = dens;
        }
        return next;
      });
    });
  };

  const handleClienteChange = (_label, item) => {
    setClienteId(item?.id || "");
    setClienteNome(item?.nome || "");
    setProdutoId("");
    setProdutoNome("");
    setProdutoCodigo("");
    setLotes((prev) =>
      prev.map((l) => ({
        ...l,
        produto_id: "",
        produto_nome: "",
        produto_codigo: "",
      }))
    );
    setFormError("");
  };

  const handleProdutoChange = (_label, item) => {
    const nextId = item?.id || "";
    const nextNome = item?.produto || item?.nome || "";
    const nextCodigo = item?.codigo || "";
    setProdutoId(nextId);
    setProdutoNome(nextNome);
    setProdutoCodigo(nextCodigo);
    setFormError("");
    if (tipoRecebimento && nextId) {
      syncLotesFromHeader({
        nextProdutoId: nextId,
        nextProdutoNome: nextNome,
        nextProdutoCodigo: nextCodigo,
        nextDensidade: item?.densidade_tabelada ? item.densidade || "" : "",
      });
    }
  };

  const handleTipoChange = (_label, item) => {
    const nextTipo = item?.value || "";
    setTipoRecebimento(nextTipo);
    setFormError("");
    if (destino === "industrializacao") {
      clearClienteProduto();
      return;
    }
    syncLotesFromHeader({ nextTipo });
  };

  const handleDestinoChange = (_label, item) => {
    setDestino(item?.value || "");
    setFormError("");
    clearClienteProduto();
  };

  const addLote = () => {
    setLotes((prev) => [
      ...prev,
      seedLote({
        tipo: tipoRecebimento,
        produtoId,
        produtoNome,
        produtoCodigo,
        densidade: produtoSelecionado?.densidade_tabelada
          ? produtoSelecionado.densidade
          : "",
      }),
    ]);
  };

  const resetForm = () => {
    setDataOp(todayISO());
    setClienteId("");
    setClienteNome("");
    setProdutoId("");
    setProdutoNome("");
    setProdutoCodigo("");
    setTipoRecebimento("");
    setDestino("");
    setLotes([]);
    setFormError("");
  };

  const handleSubmit = async () => {
    if (!detailsReady) {
      setFormError(t("painel.logistica.recebimento.errors.details"));
      return;
    }
    const loteErr = validateEntradaLotes(lotes, catalogProdutos);
    if (loteErr) {
      setFormError(loteErr);
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const origem = destino === "industrializacao" ? "industrializacao" : "convencional";
      const payload = buildEntradaPayload({
        dataEntrada: dataOp,
        clienteId,
        clienteNome,
        lotes,
        statusWms: false,
        origem,
      });
      const criadoPor = user
        ? { id: user.id, nome: user.nome || user.email || null }
        : null;
      const header = {
        data: dataOp,
        cliente_id: clienteId,
        cliente_nome: clienteNome,
        produto_id: produtoId,
        produto_nome: produtoNome,
        produto_codigo: produtoCodigo,
      };

      if (destino === "industrializacao") {
        await criarValidacaoIndustrializacao({
          header,
          origemTipo: tipoRecebimento,
          entradaPayload: payload,
          criadoPor,
        });
        toast({
          title: t("painel.logistica.recebimento.saveSuccessTitle"),
          description: t("painel.logistica.recebimento.saveSuccessIndDescription"),
        });
      } else {
        await criarValidacao({
          tipo: "entrada",
          origemTipo: tipoRecebimento,
          header,
          granelPayload: payload,
          transbordoPayload: null,
          criadoPor,
        });
        toast({
          title: t("painel.logistica.recebimento.saveSuccessTitle"),
          description: t("painel.logistica.recebimento.saveSuccessTbDescription"),
        });
      }
      resetForm();
      setModalOpen(false);
      lastTrioKey.current = "";
      await loadData({ silent: true });
    } catch (err) {
      console.error("[LogisticaRecebimento] save:", err);
      setFormError(
        err?.message || t("painel.logistica.recebimento.errors.save")
      );
    } finally {
      setSaving(false);
    }
  };

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
          {t("painel.logistica.sections.recebimento.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t("painel.logistica.recebimento.subtitle")}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pr-0.5 space-y-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t("painel.logistica.recebimento.formTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>{t("painel.logistica.recebimento.fields.date")} *</Label>
                <DateInputBr
                  value={dataOp}
                  onChange={setDataOp}
                  className={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("painel.logistica.recebimento.fields.destino")} *</Label>
                <SearchableSelect
                  value={
                    destinoOptions.find((o) => o.value === destino)?.label || ""
                  }
                  onChange={handleDestinoChange}
                  options={destinoOptions}
                  getOptionLabel={(o) => o.label}
                  getOptionValue={(o) => o.value}
                  placeholder={t("painel.logistica.recebimento.placeholders.destino")}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("painel.logistica.recebimento.fields.type")} *</Label>
                <SearchableSelect
                  value={
                    tipoOptions.find((o) => o.value === tipoRecebimento)?.label || ""
                  }
                  onChange={handleTipoChange}
                  options={tipoOptions}
                  getOptionLabel={(o) => o.label}
                  getOptionValue={(o) => o.value}
                  placeholder={t("painel.logistica.recebimento.placeholders.type")}
                  inputClassName={INPUT_EDITABLE}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => setModalOpen(true)}
                disabled={!trioReady}
                className="gap-2"
              >
                {t("painel.logistica.recebimento.openDetails")}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <PendentesCard pendentes={pendentes} t={t} />
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("painel.logistica.recebimento.detailsTitle")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {formError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("painel.logistica.recebimento.fields.client")} *</Label>
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
              <div className="space-y-1.5">
                <Label>{t("painel.logistica.recebimento.fields.product")} *</Label>
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

            <div className="space-y-4">
              {lotes.map((lote, i) => (
                <LoteBlock
                  key={i}
                  index={i}
                  lote={lote}
                  onChange={(data) => {
                    setLotes((prev) => prev.map((l, idx) => (idx === i ? data : l)));
                  }}
                  onRemove={() => setLotes((prev) => prev.filter((_, idx) => idx !== i))}
                  produtos={produtosDoCliente}
                  vasilhames={vasilhames}
                  clienteSelected={!!clienteNome}
                  canRemove={lotes.length > 1}
                  collapsed={false}
                  onToggleCollapse={() => {}}
                  hideTipoSelect
                  hideProduto
                  lockTipo
                  allowedTipos={["embalado", "vasilhame"]}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={addLote}
                className="w-full border-dashed gap-2"
              >
                <Plus className="w-4 h-4" />
                {t("painel.logistica.recebimento.addBlock")}
              </Button>

              <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-blue-200">
                <span className="text-sm text-muted-foreground">
                  {t("painel.logistica.recebimento.totalQty", { count: lotes.length })}
                </span>
                <span className="text-lg font-bold text-primary">
                  {formatMass(qtdKg)} kg
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              {t("common.cancel", "Cancelar")}
            </Button>
            <Can permission={`${PERM}.create`}>
              <Button type="button" onClick={handleSubmit} disabled={saving || !detailsReady}>
                {saving
                  ? t("common.processing", "Enviando...")
                  : t("painel.logistica.recebimento.submit")}
              </Button>
            </Can>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDateBR(iso) {
  if (!iso) return "-";
  try {
    const [y, m, d] = String(iso).slice(0, 10).split("-");
    if (!y || !m || !d) return iso;
    return `${d}/${m}/${y}`;
  } catch {
    return iso;
  }
}

function mergeRecebimentoPendentes(valsTb, valsInd) {
  const convencionais = (valsTb || [])
    .filter((v) => v.status === "pendente" && v.tipo === "entrada")
    .map((v) => {
      const qtd = resumoQuantidadeValidacao(v);
      return {
        id: `tb-${v.id}`,
        numero: v.numero,
        data: v.data,
        destino: "convencional",
        tipo: v.origem_tipo,
        cliente_nome: v.cliente_nome,
        produto_codigo: v.produto_codigo,
        produto_nome: v.produto_nome,
        lote: v.lote,
        quantidade: qtd.quantidade,
        unidade_medida: qtd.unidade_medida,
        criado_por_nome: v.criado_por_nome,
        sortAt: v.created_at || v.data || "",
      };
    });

  const industriais = (valsInd || [])
    .filter((v) => v.status === "pendente")
    .map((v) => {
      const qtd = resumoQuantidadeValidacaoInd(v);
      return {
        id: `ind-${v.id}`,
        numero: v.numero,
        data: v.data,
        destino: "industrializacao",
        tipo: v.origem_tipo,
        cliente_nome: v.cliente_nome,
        produto_codigo: v.produto_codigo,
        produto_nome: v.produto_nome,
        lote: v.lote,
        quantidade: qtd.quantidade || Number(v.quantidade) || 0,
        unidade_medida: qtd.unidade_medida || v.unidade_medida,
        criado_por_nome: v.criado_por_nome,
        sortAt: v.created_date || v.created_at || v.data || "",
      };
    });

  return [...convencionais, ...industriais].sort((a, b) => {
    const byDate = String(b.sortAt).localeCompare(String(a.sortAt));
    if (byDate !== 0) return byDate;
    return (Number(b.numero) || 0) - (Number(a.numero) || 0);
  });
}

function PendentesCard({ pendentes, t }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-600" />
          <CardTitle className="text-base">
            {t("painel.logistica.recebimento.pendentes.title")}
          </CardTitle>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">
            {pendentes.length}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">
                  {t("painel.logistica.recebimento.pendentes.columns.id")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("painel.logistica.recebimento.pendentes.columns.data")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("painel.logistica.recebimento.pendentes.columns.destino")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("painel.logistica.recebimento.pendentes.columns.tipo")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("painel.logistica.recebimento.pendentes.columns.cliente")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("painel.logistica.recebimento.pendentes.columns.produto")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("painel.logistica.recebimento.pendentes.columns.lote")}
                </th>
                <th className="px-4 py-2 font-medium text-right">
                  {t("painel.logistica.recebimento.pendentes.columns.quantidade")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("painel.logistica.recebimento.pendentes.columns.unidade")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("painel.logistica.recebimento.pendentes.columns.operador")}
                </th>
              </tr>
            </thead>
            <tbody>
              {pendentes.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    {t("painel.logistica.recebimento.pendentes.empty")}
                  </td>
                </tr>
              ) : (
                pendentes.map((v) => (
                  <tr
                    key={v.id}
                    className="border-t border-border hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-2 font-medium text-foreground whitespace-nowrap">
                      {v.numero ?? "-"}
                    </td>
                    <td className="px-4 py-2 text-foreground/80 whitespace-nowrap">
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
                    <td className="px-4 py-2 text-foreground/80 whitespace-nowrap">
                      {v.tipo
                        ? t(`painel.logistica.recebimento.tipo.${v.tipo}`, {
                            defaultValue: v.tipo,
                          })
                        : "-"}
                    </td>
                    <td className="px-4 py-2 text-foreground/80">
                      {v.cliente_nome || "-"}
                    </td>
                    <td className="px-4 py-2 text-foreground/80">
                      {[v.produto_codigo, v.produto_nome].filter(Boolean).join(" - ") ||
                        "-"}
                    </td>
                    <td className="px-4 py-2 text-foreground/80 whitespace-nowrap">
                      {v.lote || "-"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground/80">
                      {v.quantidade > 0 ? formatNum(v.quantidade, 2) : "-"}
                    </td>
                    <td className="px-4 py-2 uppercase text-foreground/60 text-xs">
                      {v.unidade_medida || "-"}
                    </td>
                    <td className="px-4 py-2 text-foreground/80">
                      {v.criado_por_nome || "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
