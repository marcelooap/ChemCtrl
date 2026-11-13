import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Check,
  CheckCircle,
  Package,
  Pencil,
  Printer,
  Scale,
  User,
  Warehouse,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import TransbordoViewDialog from "@transbordo/components/transbordo/TransbordoViewDialog";
import PrintContainerLabelDialog from "@industrializacao/components/vasilhames/PrintContainerLabelDialog";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import DateInputBr from "@transbordo/components/cadastro/DateInputBr";
import {
  formatMass,
  formatNum,
  formatVolume,
  parseDensidade,
  roundMass,
  roundVolume,
} from "@transbordo/lib/format";
import {
  applyPesoLiquidoForaMargem,
  getLoteQuantidadeDeclarada,
  loteToKg,
} from "@transbordo/lib/conversao";
import { resolveProdutoPublicToken } from "@transbordo/lib/ensureProdutoPublicToken";
import {
  labelRequiresManualVolume,
  suggestLabelVolumePlaceholder,
  stripAggregatedQtyPrefix,
} from "@industrializacao/lib/packagingTypes";

const INPUT_EDITABLE = "bg-white";

function asObject(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return typeof parsed === "object" && parsed != null ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? v : null;
}

/** Normaliza payloads (IndValidacao pode vir como string JSON). */
export function normalizeValidacaoView(validacao) {
  if (!validacao) return null;
  const granel =
    asObject(validacao.granel_payload) ||
    asObject(validacao.entrada_payload) ||
    null;
  const transbordo = asObject(validacao.transbordo_payload) || null;
  return {
    ...validacao,
    granel_payload: granel,
    entrada_payload: asObject(validacao.entrada_payload) || granel,
    transbordo_payload: transbordo,
  };
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(
      d + (String(d).length === 10 ? "T00:00:00" : "")
    ).toLocaleDateString("pt-BR");
  } catch {
    return d;
  }
}

function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("pt-BR");
  } catch {
    return d;
  }
}

const ORIGEM_TIPO_LABELS = {
  entrada: "transbordo.validacao.origemTipo.granel",
  granel: "transbordo.validacao.origemTipo.granel",
  tanka: "transbordo.validacao.origemTipo.tanka",
  vasilhame: "transbordo.validacao.origemTipo.vasilhame",
  embalado: "transbordo.validacao.origemTipo.embalado",
};

function describeDestino(destino) {
  const tipo = destino?.tipo_embalagem || "—";
  const placa = String(destino?.placa || "").trim();
  const barril = String(destino?.barril || "").trim();
  const qtdEmb = Number(destino?.quantidade_embalagens) || 0;
  const parts = [tipo];
  if (placa) parts.push(placa);
  if (barril) parts.push(`/ ${barril}`);
  const primary = parts.join(" — ").replace(" — /", " /");
  const detailParts = [];
  if (qtdEmb > 0) detailParts.push(`${qtdEmb}×`);
  if (destino?.tanka_codigo) detailParts.push(destino.tanka_codigo);
  if (destino?.lote) detailParts.push(`Lote ${destino.lote}`);
  const secondary = detailParts.join(" · ");
  return { primary, secondary };
}

function destinoPodeImprimirEtiqueta(destino) {
  const tipo = String(destino?.tipo_embalagem || "").trim();
  if (!tipo || tipo === "Tankagem") return false;
  return true;
}

function buildLabelContainerFromDestino(destino, validacao) {
  const vol = roundVolume(destino?.volume_total || destino?.volume || 0);
  const dens = parseDensidade(
    validacao?.transbordo_payload?.densidade ||
      validacao?.granel_payload?.densidade ||
      destino?.densidade
  );
  const tara = roundMass(destino?.tara || 0);
  const net =
    roundMass(destino?.peso_liquido || 0) ||
    (dens > 0 && vol > 0 ? roundMass(vol * dens) : 0);
  const gross =
    roundMass(destino?.peso_bruto || 0) ||
    (net > 0 ? roundMass(tara + net) : 0);
  const lote =
    String(destino?.lote || "").trim() ||
    String(validacao?.lote || "").trim() ||
    "—";
  const placa = String(destino?.placa || "").trim();
  const barril = String(destino?.barril || "").trim();
  const tipo = String(destino?.tipo_embalagem || "").trim();
  const volEmb = roundVolume(destino?.volume_por_embalagem || 0);
  const unitHint = labelRequiresManualVolume({
    type: tipo,
    tipo,
    container_number: placa,
    placa,
  })
    ? volEmb ||
      suggestLabelVolumePlaceholder(tipo) ||
      suggestLabelVolumePlaceholder(stripAggregatedQtyPrefix(placa)) ||
      0
    : 0;

  return {
    id:
      destino?.vasilhame_id ||
      destino?.vasilhame_existente_id ||
      `destino-${placa || barril || tipo}-${lote}`,
    product: validacao?.produto_nome || "—",
    lot: lote,
    client: validacao?.cliente_nome || "",
    op_number: String(validacao?.numero ?? "").padStart(2, "0") || "—",
    container_number: placa,
    barril_number: barril,
    type: tipo,
    volume: vol,
    volume_por_embalagem: unitHint || volEmb,
    tare: tara,
    net_weight: net,
    gross_weight: gross,
    created_date:
      validacao?.created_at || validacao?.created_date || validacao?.data || null,
  };
}

function StatusBadge({ status, t }) {
  const isValidado = status === "validado";
  const isProcessando = status === "processando";
  const cls = isValidado
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : isProcessando
      ? "bg-sky-50 text-sky-700 border-sky-200"
      : "bg-amber-50 text-amber-800 border-amber-200";
  const label = isValidado
    ? t("transbordo.validacao.status.validado")
    : isProcessando
      ? t("transbordo.validacao.status.processando")
      : t("transbordo.validacao.status.pendente");
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${cls}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function SectionCard({ icon: Icon, title, children, action = null }) {
  return (
    <section className="rounded-xl border border-border/80 bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {Icon ? (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Icon className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
        </div>
        {action ? (
          <div className="flex items-center gap-1.5 shrink-0">{action}</div>
        ) : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function InfoField({ label, value, mono = false }) {
  const display =
    value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`text-sm text-foreground break-words ${
          mono ? "font-semibold tabular-nums" : "font-medium"
        }`}
      >
        {display}
      </div>
    </div>
  );
}

function EditTextField({ label, value, onChange, type = "text" }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_EDITABLE}
      />
    </div>
  );
}

function EditNumberField({ label, value, onChange, decimals = 0 }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <NumberInputBr
        decimals={decimals}
        trimTrailingZeros={decimals > 0}
        min={0}
        value={value === "" || value == null ? "" : value}
        onChange={(v) => onChange(v === "" ? "" : v)}
        className={INPUT_EDITABLE}
      />
    </div>
  );
}

function EditDateField({ label, value, onChange }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <DateInputBr
        value={value || ""}
        onChange={(v) => onChange(v || "")}
        className={INPUT_EDITABLE}
      />
    </div>
  );
}

function ListRow({ primary, secondary, trailing, action = null }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground truncate" title={primary}>
          {primary}
        </div>
        {secondary ? (
          <div
            className="text-xs text-muted-foreground truncate mt-0.5"
            title={secondary}
          >
            {secondary}
          </div>
        ) : null}
      </div>
      {trailing ? (
        <span className="text-xs font-semibold tabular-nums text-foreground/80 whitespace-nowrap">
          {trailing}
        </span>
      ) : null}
      {action}
    </li>
  );
}

function resolveGranelQty(granel) {
  if (!granel) return null;
  const lote0 = Array.isArray(granel.lotes) ? granel.lotes[0] : null;
  const qty =
    Number(lote0?.quantidade) ||
    Number(granel.quantidade) ||
    Number(granel.saldo_inicial) ||
    0;
  const unit = lote0?.unidade_medida || granel.unidade_medida || "";
  if (!(qty > 0)) return null;
  return `${formatNum(qty, 2)} ${unit}`.trim();
}

function resolveGranelDensidade(granel, transbordo) {
  const dens =
    granel?.densidade ||
    granel?.lotes?.[0]?.densidade ||
    transbordo?.densidade ||
    "";
  const n = parseDensidade(dens);
  return n > 0 ? formatNum(n, 4) : dens || null;
}

function buildResumoDraft(view, granel, transbordo) {
  return {
    data: view?.data || "",
    cliente_nome: view?.cliente_nome || "",
    lote: view?.lote || granel?.lote || granel?.lotes?.[0]?.lote || "",
    quantidade:
      view?.quantidade ??
      granel?.quantidade ??
      granel?.lotes?.[0]?.quantidade ??
      "",
    unidade_medida:
      view?.unidade_medida ||
      granel?.unidade_medida ||
      granel?.lotes?.[0]?.unidade_medida ||
      "kg",
    densidade:
      granel?.densidade ||
      granel?.lotes?.[0]?.densidade ||
      transbordo?.densidade ||
      "",
  };
}

function buildRecebimentoDraft(granel) {
  const lote0 = Array.isArray(granel?.lotes) ? granel.lotes[0] : null;
  // Quantidade declarada (NF) — base da margem; não confundir com qty efetiva fora da margem.
  const qtyDeclarada =
    getLoteQuantidadeDeclarada(lote0 || granel) ||
    granel?.quantidade_nf ||
    lote0?.quantidade_nf ||
    granel?.quantidade ||
    lote0?.quantidade ||
    "";
  return {
    nota_fiscal: granel?.nota_fiscal || lote0?.nota_fiscal || "",
    fornecedor: granel?.fornecedor || lote0?.fornecedor || "",
    data_fabricacao: granel?.data_fabricacao || lote0?.data_fabricacao || "",
    data_validade: granel?.data_validade || lote0?.data_validade || "",
    quantidade: qtyDeclarada === "" || qtyDeclarada == null ? "" : qtyDeclarada,
    unidade_medida: granel?.unidade_medida || lote0?.unidade_medida || "kg",
    densidade: granel?.densidade || lote0?.densidade || "",
    preco_unitario: granel?.preco_unitario ?? lote0?.preco_unitario ?? "",
    granel_ticket: granel?.granel_ticket || "",
    granel_peso_bruto: granel?.granel_peso_bruto ?? "",
    granel_peso_liquido: granel?.granel_peso_liquido ?? "",
  };
}

/** Mesma regra de Entrada / Ordem de Transbordo (tolerância balança). */
function computePesagemMargem({
  quantidade,
  unidade_medida,
  densidade,
  pesoBruto,
  pesoLiquido,
}) {
  const gPb = Number(pesoBruto) || 0;
  const gPl = Number(pesoLiquido) || 0;
  const dens = parseDensidade(densidade);
  const qtdKgDeclarada = loteToKg({
    quantidade,
    unidade_medida: unidade_medida || "kg",
    densidade: dens,
    tipo_recebimento: "granel",
  });
  const valBruto = gPb >= 10000 && gPb <= 40000 ? 60 : 80;
  const valLiquido = gPl >= 10000 && gPl <= 40000 ? 60 : 80;
  const erroAdmissivel = valBruto + valLiquido;
  const pesoMinimo = qtdKgDeclarada - erroAdmissivel;
  const pesoMaximo = qtdKgDeclarada + erroAdmissivel;
  const dentro = gPl > 0 && gPl >= pesoMinimo && gPl <= pesoMaximo;
  return {
    qtdKgDeclarada,
    valBruto,
    valLiquido,
    erroAdmissivel,
    pesoMinimo,
    pesoMaximo,
    dentroMargem: dentro,
    foraMargem: gPl > 0 && !dentro,
    margem: gPl > 0 ? (dentro ? "dentro" : "fora") : null,
  };
}

function MargemBadge({ margem, t }) {
  if (!margem) return <span className="text-sm text-muted-foreground">—</span>;
  const dentro = margem === "dentro";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
        dentro
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-red-50 text-red-700 border-red-200"
      }`}
    >
      {dentro ? (
        <CheckCircle className="w-3 h-3" />
      ) : (
        <AlertCircle className="w-3 h-3" />
      )}
      {dentro
        ? t("transbordo.validacao.margem.dentro", {
            defaultValue: "Dentro da margem",
          })
        : t("transbordo.validacao.margem.fora", {
            defaultValue: "Fora da margem",
          })}
    </span>
  );
}

function mergeRecebimentoIntoGranel(granel, draft) {
  const base = granel && typeof granel === "object" ? { ...granel } : {};
  const qtyDeclarada =
    draft.quantidade === "" ? 0 : Number(draft.quantidade) || 0;
  const dens = draft.densidade || base.densidade || "";
  const unidade = draft.unidade_medida || base.unidade_medida || "kg";
  const gPb =
    draft.granel_peso_bruto === "" ? 0 : Number(draft.granel_peso_bruto) || 0;
  const gPl =
    draft.granel_peso_liquido === ""
      ? 0
      : Number(draft.granel_peso_liquido) || 0;
  const pesagem = computePesagemMargem({
    quantidade: qtyDeclarada,
    unidade_medida: unidade,
    densidade: dens,
    pesoBruto: gPb,
    pesoLiquido: gPl,
  });

  const loteBase = {
    ...(Array.isArray(base.lotes) && base.lotes[0] ? base.lotes[0] : {}),
    nota_fiscal: draft.nota_fiscal || "",
    quantidade: qtyDeclarada,
    quantidade_nf: qtyDeclarada,
    quantidade_declarada: qtyDeclarada,
    unidade_medida: unidade,
    lote: base.lote || base.lotes?.[0]?.lote || "",
    fornecedor: draft.fornecedor || "",
    data_fabricacao: draft.data_fabricacao || null,
    data_validade: draft.data_validade || null,
    densidade: dens,
    preco_unitario: Number(draft.preco_unitario) || 0,
    tipo_recebimento: "granel",
    embalado: false,
  };

  const lotes = pesagem.foraMargem
    ? applyPesoLiquidoForaMargem([loteBase], gPl)
    : [loteBase];
  const first = lotes[0] || loteBase;
  const qtdKgEfetiva = lotes.reduce((sum, l) => sum + loteToKg(l), 0);

  return {
    ...base,
    nota_fiscal: draft.nota_fiscal || "",
    quantidade: qtdKgEfetiva,
    unidade_medida: "kg",
    fornecedor: draft.fornecedor || "",
    data_fabricacao: draft.data_fabricacao || null,
    data_validade: draft.data_validade || null,
    densidade: dens,
    preco_unitario: Number(draft.preco_unitario) || 0,
    saldo_inicial: qtdKgEfetiva,
    saldo_final: qtdKgEfetiva,
    saldo_atual: qtdKgEfetiva,
    granel_pesagem: true,
    granel_ticket: draft.granel_ticket || null,
    granel_peso_bruto: gPb > 0 ? gPb : null,
    granel_validacao_bruto: pesagem.valBruto,
    granel_peso_liquido: gPl > 0 ? gPl : null,
    granel_validacao_liquido: pesagem.valLiquido,
    granel_erro_admissivel: pesagem.erroAdmissivel,
    granel_peso_minimo: pesagem.pesoMinimo,
    granel_peso_maximo: pesagem.pesoMaximo,
    granel_margem: pesagem.margem,
    lotes: lotes.map((l) => ({
      ...l,
      quantidade_declarada: qtyDeclarada,
      quantidade_nf: qtyDeclarada,
    })),
    // Meta para ajuste de envase (litros a partir da qty efetiva).
    _qtdKgEfetiva: qtdKgEfetiva,
    _densidadeEfetiva: dens,
  };
}

/**
 * Visualização da validação com edição inline (Resumo / Recebimento)
 * e atalho para editar envase (Transbordo).
 *
 * onSaveCampos({ granelPayload?, header?, openEnvase?, deferPersist? })
 * — deferPersist: não grava ainda; abre envase com draft. Só confirma ao salvar o envase.
 * onEditTransbordo(validacao)
 */
export default function ValidacaoViewDialog({
  open,
  onClose,
  validacao,
  produtos = [],
  entradas = [],
  canEdit = false,
  onSaveCampos,
  onEditTransbordo,
  saving = false,
}) {
  const { t } = useTranslation();
  const [labelDestino, setLabelDestino] = useState(null);
  const [editingCard, setEditingCard] = useState(null); // 'resumo' | 'recebimento' | null
  const [resumoDraft, setResumoDraft] = useState(null);
  const [recebDraft, setRecebDraft] = useState(null);
  const [saveError, setSaveError] = useState("");

  const view = useMemo(() => normalizeValidacaoView(validacao), [validacao]);
  const granel = view?.granel_payload || null;
  const transbordo = view?.transbordo_payload || null;
  const destinos = Array.isArray(transbordo?.destinos) ? transbordo.destinos : [];
  const isPendente = view?.status === "pendente";
  const allowEdit = Boolean(canEdit && isPendente && onSaveCampos);

  const produtoCadastro = useMemo(() => {
    if (!view && !granel && !transbordo) return null;
    const pid =
      view?.produto_id || granel?.produto_id || transbordo?.produto_id || "";
    const codigo =
      view?.produto_codigo ||
      granel?.produto_codigo ||
      transbordo?.produto_codigo ||
      "";
    const list = Array.isArray(produtos) ? produtos : [];
    return (
      list.find((p) => pid && String(p.id) === String(pid)) ||
      list.find((p) => codigo && String(p.codigo) === String(codigo)) ||
      null
    );
  }, [view, granel, transbordo, produtos]);

  /** Densidade do cadastro (tabelada) → bloqueia edição no Resumo. */
  const densidadeFromCadastro = Boolean(produtoCadastro?.densidade_tabelada);

  const recebimentoMargemLive = useMemo(() => {
    if (!recebDraft) {
      return granel?.granel_margem || null;
    }
    return computePesagemMargem({
      quantidade: recebDraft.quantidade,
      unidade_medida: recebDraft.unidade_medida,
      densidade: recebDraft.densidade,
      pesoBruto: recebDraft.granel_peso_bruto,
      pesoLiquido: recebDraft.granel_peso_liquido,
    }).margem;
  }, [recebDraft, granel?.granel_margem]);

  useEffect(() => {
    if (!open) {
      setEditingCard(null);
      setResumoDraft(null);
      setRecebDraft(null);
      setSaveError("");
      setLabelDestino(null);
    }
  }, [open]);

  useEffect(() => {
    if (!view) return;
    if (editingCard === "resumo") {
      setResumoDraft(buildResumoDraft(view, granel, transbordo));
    }
    if (editingCard === "recebimento") {
      setRecebDraft(buildRecebimentoDraft(granel));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCard, view?.id]);

  const labelContainer = useMemo(() => {
    if (!labelDestino || !view) return null;
    return buildLabelContainerFromDestino(labelDestino, view);
  }, [labelDestino, view]);

  const labelDensity = useMemo(() => {
    if (!view) return undefined;
    const dens = parseDensidade(
      view?.transbordo_payload?.densidade || view?.granel_payload?.densidade
    );
    return dens > 0 ? dens : undefined;
  }, [view]);

  const labelInitialVolume = useMemo(() => {
    if (!labelContainer) return "";
    if (labelRequiresManualVolume(labelContainer)) {
      const unit = Number(labelContainer.volume_por_embalagem) || 0;
      if (unit > 0) return Math.round(unit);
    }
    const tankVol = Number(labelContainer.volume) || 0;
    return tankVol > 0 ? Math.round(tankVol) : "";
  }, [labelContainer]);

  const labelContexto =
    view?.destino === "industrializacao" ||
    view?.granel_payload?.origem === "industrializacao" ||
    view?.entrada_payload?.origem === "industrializacao"
      ? "industrializacao"
      : "convencional";

  const labelManufactureDate =
    view?.granel_payload?.data_fabricacao ||
    view?.granel_payload?.lotes?.[0]?.data_fabricacao ||
    null;

  const labelExpiryDate =
    view?.granel_payload?.data_validade ||
    view?.granel_payload?.lotes?.[0]?.data_validade ||
    null;

  const printLabelTitle = t("containers.vasilhames.printLabel", {
    defaultValue: "Imprimir etiqueta",
  });
  const editLabel = t("common.edit", { defaultValue: "Editar" });
  const saveLabel = t("common.save", { defaultValue: "Salvar" });
  const cancelLabel = t("common.cancel", { defaultValue: "Cancelar" });

  const origemTipoLabel = (() => {
    const raw =
      view?.origem_tipo ||
      (Array.isArray(transbordo?.origens) && transbordo.origens[0]?.tipo_origem) ||
      "";
    const key = ORIGEM_TIPO_LABELS[raw];
    return key ? t(key) : raw ? String(raw).toUpperCase() : "—";
  })();

  const qtdHeader =
    view?.quantidade != null && Number(view.quantidade) > 0
      ? `${formatNum(Number(view.quantidade), 2)} ${view.unidade_medida || ""}`.trim()
      : resolveGranelQty(granel) ||
        (transbordo?.volume_total
          ? `${formatVolume(transbordo.volume_total)} L`
          : "—");

  const startEditResumo = () => {
    setSaveError("");
    setEditingCard("resumo");
    setResumoDraft(buildResumoDraft(view, granel, transbordo));
  };

  const startEditRecebimento = () => {
    setSaveError("");
    setEditingCard("recebimento");
    setRecebDraft(buildRecebimentoDraft(granel));
  };

  const cancelEdit = () => {
    setEditingCard(null);
    setResumoDraft(null);
    setRecebDraft(null);
    setSaveError("");
  };

  const handleSaveResumo = async () => {
    if (!resumoDraft || !onSaveCampos) return;
    setSaveError("");
    try {
      const qty =
        resumoDraft.quantidade === "" ? 0 : Number(resumoDraft.quantidade) || 0;
      // Densidade tabelada no cadastro não pode ser alterada pela tela.
      const dens = densidadeFromCadastro
        ? granel?.densidade ||
          transbordo?.densidade ||
          produtoCadastro?.densidade ||
          resumoDraft.densidade ||
          ""
        : resumoDraft.densidade || "";
      let nextGranel = granel
        ? {
            ...granel,
            lote: resumoDraft.lote || granel.lote,
            quantidade: qty || granel.quantidade,
            unidade_medida:
              resumoDraft.unidade_medida || granel.unidade_medida,
            densidade: dens || granel.densidade,
            data: resumoDraft.data || granel.data,
            cliente_nome: resumoDraft.cliente_nome || granel.cliente_nome,
            lotes: Array.isArray(granel.lotes) && granel.lotes[0]
              ? [
                  {
                    ...granel.lotes[0],
                    lote: resumoDraft.lote || granel.lotes[0].lote,
                    quantidade: qty || granel.lotes[0].quantidade,
                    unidade_medida:
                      resumoDraft.unidade_medida ||
                      granel.lotes[0].unidade_medida,
                    densidade: dens || granel.lotes[0].densidade,
                  },
                ]
              : granel.lotes,
          }
        : null;
      const nextTransbordo = transbordo
        ? {
            ...transbordo,
            data: resumoDraft.data || transbordo.data,
            cliente_nome: resumoDraft.cliente_nome || transbordo.cliente_nome,
            densidade: dens || transbordo.densidade,
          }
        : null;
      await onSaveCampos({
        header: {
          data: resumoDraft.data || null,
          cliente_nome: resumoDraft.cliente_nome || null,
          lote: resumoDraft.lote || null,
          quantidade: qty,
          unidade_medida: resumoDraft.unidade_medida || null,
        },
        granelPayload: nextGranel,
        transbordoPayload: nextTransbordo,
      });
      setEditingCard(null);
      setResumoDraft(null);
    } catch (err) {
      setSaveError(err?.message || t("transbordo.validacao.errors.editGeneric"));
    }
  };

  const handleSaveRecebimento = async () => {
    if (!recebDraft || !onSaveCampos) return;
    setSaveError("");
    try {
      const nextGranel = mergeRecebimentoIntoGranel(granel, recebDraft);
      // Mantém lote do header se o draft de recebimento não tiver lote próprio.
      if (!nextGranel.lote && view?.lote) nextGranel.lote = view.lote;
      if (Array.isArray(nextGranel.lotes) && nextGranel.lotes[0] && !nextGranel.lotes[0].lote) {
        nextGranel.lotes[0].lote = view?.lote || nextGranel.lote || "";
      }

      const densEfetiva =
        nextGranel._densidadeEfetiva ||
        recebDraft.densidade ||
        transbordo?.densidade ||
        "";
      const qtdKg = Number(nextGranel._qtdKgEfetiva || nextGranel.quantidade) || 0;

      const volumeRelatedChanged = (() => {
        const oldPl = Number(granel?.granel_peso_liquido) || 0;
        const newPl = Number(recebDraft.granel_peso_liquido) || 0;
        const oldPb = Number(granel?.granel_peso_bruto) || 0;
        const newPb = Number(recebDraft.granel_peso_bruto) || 0;
        const oldQty = Number(granel?.quantidade) || 0;
        const oldDens = parseDensidade(granel?.densidade);
        const newDens = parseDensidade(recebDraft.densidade);
        return (
          oldPl !== newPl ||
          oldPb !== newPb ||
          Math.abs(oldQty - qtdKg) > 0.001 ||
          Math.abs(oldDens - newDens) > 0.00001
        );
      })();

      // Destinos permanecem iguais — o operador realoca o volume no envase.
      const nextTransbordo = transbordo
        ? {
            ...transbordo,
            densidade: densEfetiva || transbordo.densidade,
          }
        : null;

      // Remove metas internas antes de persistir / enviar ao envase.
      delete nextGranel._qtdKgEfetiva;
      delete nextGranel._densidadeEfetiva;

      const shouldOpenEnvase = Boolean(
        nextTransbordo && volumeRelatedChanged && onEditTransbordo
      );

      await onSaveCampos({
        header: {
          quantidade: qtdKg,
          unidade_medida: "kg",
          lote: view?.lote || nextGranel.lote || null,
        },
        granelPayload: nextGranel,
        transbordoPayload: nextTransbordo,
        openEnvase: shouldOpenEnvase,
        // Só confirma peso/volume no banco depois de salvar o envase.
        deferPersist: shouldOpenEnvase,
      });
      setEditingCard(null);
      setRecebDraft(null);
    } catch (err) {
      setSaveError(err?.message || t("transbordo.validacao.errors.editGeneric"));
    }
  };

  const cardEditActions = (card, onSave) => {
    if (!allowEdit) return null;
    if (editingCard === card) {
      return (
        <>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1 px-2"
            disabled={saving}
            onClick={cancelEdit}
          >
            <X className="h-3.5 w-3.5" />
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1 px-2"
            disabled={saving}
            onClick={onSave}
          >
            <Check className="h-3.5 w-3.5" />
            {saveLabel}
          </Button>
        </>
      );
    }
    if (editingCard) return null;
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 px-2.5"
        onClick={card === "resumo" ? startEditResumo : startEditRecebimento}
      >
        <Pencil className="h-3.5 w-3.5" />
        {editLabel}
      </Button>
    );
  };

  if (!view) return null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setLabelDestino(null);
            cancelEdit();
            onClose();
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left space-y-1">
            <DialogTitle className="flex items-center gap-3 flex-wrap text-base">
              <span>
                {t("transbordo.validacao.viewTitle", {
                  numero: String(view.numero || "").padStart(2, "0"),
                })}
              </span>
              <StatusBadge status={view.status} t={t} />
              {view.destino === "industrializacao" ||
              view.destino === "convencional" ? (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                    view.destino === "industrializacao"
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-slate-50 text-slate-700 border-slate-200"
                  }`}
                >
                  {t(`painel.logistica.recebimento.destino.${view.destino}`, {
                    defaultValue:
                      view.destino === "industrializacao"
                        ? "Industrialização"
                        : "Convencional",
                  })}
                </span>
              ) : null}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {[view.produto_codigo, view.produto_nome].filter(Boolean).join(" — ") ||
                "—"}
              {view.cliente_nome ? ` · ${view.cliente_nome}` : ""}
            </p>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {saveError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {saveError}
              </div>
            ) : null}

            <SectionCard
              icon={Package}
              title={t("transbordo.validacao.sections.geral", {
                defaultValue: "Resumo",
              })}
              action={cardEditActions("resumo", handleSaveResumo)}
            >
              {editingCard === "resumo" && resumoDraft ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  <EditDateField
                    label={t("transbordo.validacao.fields.data")}
                    value={resumoDraft.data}
                    onChange={(v) =>
                      setResumoDraft((p) => ({ ...p, data: v }))
                    }
                  />
                  <EditTextField
                    label={t("transbordo.validacao.fields.cliente")}
                    value={resumoDraft.cliente_nome}
                    onChange={(v) =>
                      setResumoDraft((p) => ({ ...p, cliente_nome: v }))
                    }
                  />
                  <InfoField
                    label={t("transbordo.validacao.fields.origemTipo")}
                    value={origemTipoLabel}
                  />
                  <EditTextField
                    label={t("transbordo.validacao.fields.lote")}
                    value={resumoDraft.lote}
                    onChange={(v) =>
                      setResumoDraft((p) => ({ ...p, lote: v }))
                    }
                  />
                  <EditNumberField
                    label={t("transbordo.validacao.fields.quantidade")}
                    value={resumoDraft.quantidade}
                    onChange={(v) =>
                      setResumoDraft((p) => ({ ...p, quantidade: v }))
                    }
                    decimals={3}
                  />
                  <EditTextField
                    label={t("transbordo.validacao.fields.unidade", {
                      defaultValue: "Unidade",
                    })}
                    value={resumoDraft.unidade_medida}
                    onChange={(v) =>
                      setResumoDraft((p) => ({ ...p, unidade_medida: v }))
                    }
                  />
                  {densidadeFromCadastro ? (
                    <InfoField
                      label={t("transbordo.validacao.fields.densidade")}
                      value={resolveGranelDensidade(granel, transbordo)}
                      mono
                    />
                  ) : (
                    <EditNumberField
                      label={t("transbordo.validacao.fields.densidade")}
                      value={resumoDraft.densidade}
                      onChange={(v) =>
                        setResumoDraft((p) => ({ ...p, densidade: v }))
                      }
                      decimals={4}
                    />
                  )}
                  <InfoField
                    label={t("transbordo.validacao.fields.operadores")}
                    value={
                      (transbordo?.operadores || []).filter(Boolean).join(", ") ||
                      view.criado_por_nome ||
                      "—"
                    }
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  <InfoField
                    label={t("transbordo.validacao.fields.data")}
                    value={fmtDate(view.data)}
                  />
                  <InfoField
                    label={t("transbordo.validacao.fields.cliente")}
                    value={view.cliente_nome}
                  />
                  <InfoField
                    label={t("transbordo.validacao.fields.origemTipo")}
                    value={origemTipoLabel}
                  />
                  <InfoField
                    label={t("transbordo.validacao.fields.lote")}
                    value={view.lote || granel?.lote || "—"}
                  />
                  <InfoField
                    label={t("transbordo.validacao.fields.quantidade")}
                    value={qtdHeader}
                    mono
                  />
                  <InfoField
                    label={t("transbordo.validacao.fields.densidade")}
                    value={resolveGranelDensidade(granel, transbordo)}
                    mono
                  />
                  <InfoField
                    label={t("transbordo.validacao.fields.operadores")}
                    value={
                      (transbordo?.operadores || []).filter(Boolean).join(", ") ||
                      view.criado_por_nome ||
                      "—"
                    }
                  />
                </div>
              )}
            </SectionCard>

            {granel ? (
              <SectionCard
                icon={Scale}
                title={
                  view.tipo === "entrada"
                    ? t("transbordo.validacao.sections.entrada")
                    : t("transbordo.validacao.sections.granel")
                }
                action={cardEditActions("recebimento", handleSaveRecebimento)}
              >
                {editingCard === "recebimento" && recebDraft ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    <EditTextField
                      label={t("transbordo.validacao.fields.notaFiscal")}
                      value={recebDraft.nota_fiscal}
                      onChange={(v) =>
                        setRecebDraft((p) => ({ ...p, nota_fiscal: v }))
                      }
                    />
                    <EditTextField
                      label={t(
                        "painel.operacional.ordemTransbordo.fields.supplier"
                      )}
                      value={recebDraft.fornecedor}
                      onChange={(v) =>
                        setRecebDraft((p) => ({ ...p, fornecedor: v }))
                      }
                    />
                    <EditDateField
                      label={t(
                        "painel.operacional.ordemTransbordo.fields.manufacture"
                      )}
                      value={recebDraft.data_fabricacao}
                      onChange={(v) =>
                        setRecebDraft((p) => ({ ...p, data_fabricacao: v }))
                      }
                    />
                    <EditDateField
                      label={t(
                        "painel.operacional.ordemTransbordo.fields.expiry"
                      )}
                      value={recebDraft.data_validade}
                      onChange={(v) =>
                        setRecebDraft((p) => ({ ...p, data_validade: v }))
                      }
                    />
                    <EditNumberField
                      label={t("transbordo.validacao.fields.quantidadeGranel")}
                      value={recebDraft.quantidade}
                      onChange={(v) =>
                        setRecebDraft((p) => ({ ...p, quantidade: v }))
                      }
                      decimals={3}
                    />
                    <EditNumberField
                      label={t("transbordo.validacao.fields.densidade")}
                      value={recebDraft.densidade}
                      onChange={(v) =>
                        setRecebDraft((p) => ({ ...p, densidade: v }))
                      }
                      decimals={4}
                    />
                    <EditNumberField
                      label={t("transbordo.validacao.fields.precoUnitario")}
                      value={recebDraft.preco_unitario}
                      onChange={(v) =>
                        setRecebDraft((p) => ({ ...p, preco_unitario: v }))
                      }
                      decimals={4}
                    />
                    <EditTextField
                      label={t("transbordo.validacao.fields.ticket")}
                      value={recebDraft.granel_ticket}
                      onChange={(v) =>
                        setRecebDraft((p) => ({ ...p, granel_ticket: v }))
                      }
                    />
                    <EditNumberField
                      label={t("transbordo.validacao.fields.pesoBruto")}
                      value={recebDraft.granel_peso_bruto}
                      onChange={(v) =>
                        setRecebDraft((p) => ({ ...p, granel_peso_bruto: v }))
                      }
                    />
                    <EditNumberField
                      label={t("transbordo.validacao.fields.pesoLiquido")}
                      value={recebDraft.granel_peso_liquido}
                      onChange={(v) =>
                        setRecebDraft((p) => ({
                          ...p,
                          granel_peso_liquido: v,
                        }))
                      }
                    />
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("transbordo.validacao.fields.margem")}
                      </div>
                      <MargemBadge margem={recebimentoMargemLive} t={t} />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    <InfoField
                      label={t("transbordo.validacao.fields.notaFiscal")}
                      value={granel.nota_fiscal || granel.lotes?.[0]?.nota_fiscal}
                    />
                    <InfoField
                      label={t(
                        "painel.operacional.ordemTransbordo.fields.supplier"
                      )}
                      value={granel.fornecedor || granel.lotes?.[0]?.fornecedor}
                    />
                    <InfoField
                      label={t(
                        "painel.operacional.ordemTransbordo.fields.manufacture"
                      )}
                      value={fmtDate(
                        granel.data_fabricacao ||
                          granel.lotes?.[0]?.data_fabricacao
                      )}
                    />
                    <InfoField
                      label={t(
                        "painel.operacional.ordemTransbordo.fields.expiry"
                      )}
                      value={fmtDate(
                        granel.data_validade || granel.lotes?.[0]?.data_validade
                      )}
                    />
                    <InfoField
                      label={t("transbordo.validacao.fields.quantidadeGranel")}
                      value={resolveGranelQty(granel)}
                      mono
                    />
                    <InfoField
                      label={t("transbordo.validacao.fields.densidade")}
                      value={resolveGranelDensidade(granel, null)}
                      mono
                    />
                    <InfoField
                      label={t("transbordo.validacao.fields.precoUnitario")}
                      value={
                        Number(granel.preco_unitario) > 0
                          ? `R$ ${formatNum(Number(granel.preco_unitario), 4)}`
                          : null
                      }
                      mono
                    />
                    <InfoField
                      label={t("transbordo.validacao.fields.ticket")}
                      value={granel.granel_ticket}
                    />
                    <InfoField
                      label={t("transbordo.validacao.fields.pesoBruto")}
                      value={
                        Number(granel.granel_peso_bruto) > 0
                          ? `${formatMass(granel.granel_peso_bruto)} kg`
                          : null
                      }
                      mono
                    />
                    <InfoField
                      label={t("transbordo.validacao.fields.pesoLiquido")}
                      value={
                        Number(granel.granel_peso_liquido) > 0
                          ? `${formatMass(granel.granel_peso_liquido)} kg`
                          : null
                      }
                      mono
                    />
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("transbordo.validacao.fields.margem")}
                      </div>
                      <MargemBadge margem={granel.granel_margem} t={t} />
                    </div>
                  </div>
                )}
              </SectionCard>
            ) : null}

            {transbordo ? (
              <SectionCard
                icon={Warehouse}
                title={t("transbordo.validacao.sections.transbordo")}
                action={
                  <>
                    {destinos.length > 0 ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/70">
                        {destinos.length}
                      </span>
                    ) : null}
                    {allowEdit && onEditTransbordo && !editingCard ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 px-2.5"
                        onClick={() => onEditTransbordo(view)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {editLabel}
                      </Button>
                    ) : null}
                  </>
                }
              >
                <div className="space-y-4">
                  {destinos.length > 0 ? (
                    <ul className="space-y-1.5">
                      {destinos.map((d, i) => {
                        const { primary, secondary } = describeDestino(d);
                        const canPrint = destinoPodeImprimirEtiqueta(d);
                        const qty =
                          Number(d.volume_total || d.volume) > 0
                            ? `${formatVolume(d.volume_total || d.volume)} L`
                            : Number(d.peso_liquido) > 0
                              ? `${formatMass(d.peso_liquido)} kg`
                              : "—";
                        return (
                          <ListRow
                            key={d._uid || i}
                            primary={primary}
                            secondary={secondary}
                            trailing={qty}
                            action={
                              canPrint ? (
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-colors"
                                  title={printLabelTitle}
                                  aria-label={printLabelTitle}
                                  onClick={() => setLabelDestino(d)}
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </button>
                              ) : null
                            }
                          />
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t("transbordo.validacao.emptyDestinos", {
                        defaultValue: "Nenhum destino registrado neste envase.",
                      })}
                    </p>
                  )}

                  {transbordo.observacoes ? (
                    <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        {t("transbordo.validacao.fields.observacoes")}
                      </div>
                      <div className="text-sm text-foreground whitespace-pre-wrap">
                        {transbordo.observacoes}
                      </div>
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            ) : null}

            <SectionCard
              icon={User}
              title={t("transbordo.validacao.sections.auditoria", {
                defaultValue: "Auditoria",
              })}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoField
                  label={t("transbordo.validacao.fields.criadoPor")}
                  value={
                    view.criado_por_nome
                      ? `${view.criado_por_nome} — ${fmtDateTime(
                          view.created_at || view.created_date
                        )}`
                      : fmtDateTime(view.created_at || view.created_date)
                  }
                />
                <InfoField
                  label={t("transbordo.validacao.fields.validadoPor")}
                  value={
                    view.validado_em
                      ? view.validado_por_nome
                        ? `${view.validado_por_nome} — ${fmtDateTime(
                            view.validado_em
                          )}`
                        : fmtDateTime(view.validado_em)
                      : "—"
                  }
                />
              </div>
            </SectionCard>
          </div>

          <div className="shrink-0 flex justify-end gap-2 border-t border-border px-5 py-3 bg-muted/20">
            <Button variant="outline" onClick={onClose}>
              {t("common.close", "Fechar")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PrintContainerLabelDialog
        key={labelContainer?.id || "closed"}
        open={Boolean(labelDestino && labelContainer)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setLabelDestino(null);
        }}
        container={labelContainer}
        initialVolume={labelInitialVolume}
        density={labelDensity}
        contexto={labelContexto}
        clienteId={view?.cliente_id}
        clienteNome={view?.cliente_nome}
        manufactureDate={labelManufactureDate || undefined}
        expiryDate={labelExpiryDate || undefined}
        resolvePublicToken={
          view
            ? () =>
                resolveProdutoPublicToken({
                  produtoId: view.produto_id,
                  codigo: view.produto_codigo,
                  nome: view.produto_nome,
                }).catch(() => null)
            : undefined
        }
      />
    </>
  );
}

export { TransbordoViewDialog };
