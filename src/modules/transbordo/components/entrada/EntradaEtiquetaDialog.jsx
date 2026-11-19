import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@shared/components/ui/radio-group";
import { useToast } from "@shared/components/ui/use-toast";
import EtiquetaPreview from "@painel/components/configuracao/EtiquetaPreview";
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { fmtNumber } from "@/i18n/formatters";
import {
  resolveEtiquetaPrintConfig,
  resolveResponsavelTecnico,
} from "@transbordo/lib/etiquetaConfig";
import { ensureEntradaPublicToken, CONSULTA_ENTRADA_PATH } from "@transbordo/lib/ensureEntradaPublicToken";
import {
  buildEntradaEtiquetaModel,
  entradaEtiquetaOptionLabel,
  getEntradaLotes,
  printEntradaEtiqueta,
  withEntradaEtiquetaCampos,
} from "@transbordo/lib/entradaEtiqueta";

/** Opções de embalagem para etiqueta de origem granel no transbordo. */
export const EMBALAGEM_ORIGEM_GRANEL_OPTIONS = [
  "ORIGEM SUPERIOR",
  "ORIGEM INFERIOR",
];

function resolveInitialLoteIndex(lotes, initialLote) {
  const key = String(initialLote || "").trim().toLowerCase();
  if (!key || !lotes.length) return 0;
  const found = lotes.findIndex(
    (item) => String(item?.lote || "").trim().toLowerCase() === key
  );
  return found >= 0 ? found : 0;
}

export default function EntradaEtiquetaDialog({
  open,
  onOpenChange,
  entrada,
  entradaCodigo,
  /** Pré-seleciona o lote (ex.: lote da origem do transbordo). */
  initialLote = "",
  /**
   * Quando informado, substitui o campo embalagem da etiqueta por um select
   * (ex.: ORIGEM SUPERIOR / ORIGEM INFERIOR no print de granel no OP).
   */
  embalagemOptions = null,
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const lotes = entrada ? getEntradaLotes(entrada) : [];
  const hasEmbalagemChoices =
    Array.isArray(embalagemOptions) && embalagemOptions.length > 0;
  const embalagemChoices = hasEmbalagemChoices
    ? embalagemOptions.map((opt) => String(opt || "").trim()).filter(Boolean)
    : [];
  const sessionKey =
    open && entrada
      ? `${entrada.id || ""}|${String(initialLote || "").trim()}|${embalagemChoices.join(",")}`
      : "";

  const [formSession, setFormSession] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [volumeOverride, setVolumeOverride] = useState(null);
  const [embalagemChoice, setEmbalagemChoice] = useState(
    embalagemChoices[0] || ""
  );
  const [printing, setPrinting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [printConfig, setPrintConfig] = useState(null);
  const [publicToken, setPublicToken] = useState("");
  const [responsavelTecnico, setResponsavelTecnico] = useState("");
  const [tokenError, setTokenError] = useState("");

  if (sessionKey !== formSession) {
    setFormSession(sessionKey);
    setSelectedIndex(resolveInitialLoteIndex(lotes, initialLote));
    setQty(1);
    setVolumeOverride(null);
    setEmbalagemChoice(embalagemChoices[0] || "");
    setPrintConfig(null);
    setPublicToken("");
    setResponsavelTecnico("");
    setTokenError("");
    setLoading(Boolean(sessionKey));
  }

  const loteIndex = Math.min(selectedIndex, Math.max(lotes.length - 1, 0));
  const lote = lotes[loteIndex] || null;
  const multiple = lotes.length > 1;
  const qtyOk = Number.isFinite(Number(qty)) && Number(qty) >= 1;

  const baseModel = useMemo(
    () =>
      lote
        ? buildEntradaEtiquetaModel(entrada, lote, { entradaCodigo })
        : null,
    [entrada, lote, entradaCodigo]
  );

  const seedVolume =
    baseModel?.volumeLitros != null && Number(baseModel.volumeLitros) > 0
      ? Math.round(Number(baseModel.volumeLitros))
      : "";
  const volume = volumeOverride !== null ? volumeOverride : seedVolume;
  const volumeOk = Number(volume) > 0;
  const embalagemOk = !hasEmbalagemChoices || Boolean(String(embalagemChoice || "").trim());

  const model = baseModel
    ? {
        ...baseModel,
        volumeLitros: volumeOk ? Number(volume) : baseModel.volumeLitros,
        embalagem: hasEmbalagemChoices
          ? String(embalagemChoice || "").trim() || "—"
          : baseModel.embalagem,
      }
    : null;

  const etiquetaCampos = printConfig?.campos
    ? withEntradaEtiquetaCampos(printConfig.campos, {
        hasNet: model?.netWeight != null,
        hasGross: model?.grossWeight != null,
        hasVolume: model?.volumeLitros != null,
      })
    : null;

  useEffect(() => {
    if (!open || !entrada?.id) return undefined;
    let cancelled = false;
    setLoading(true);
    setTokenError("");

    Promise.all([
      resolveEtiquetaPrintConfig({
        clienteId: entrada.cliente_id,
        clienteNome: entrada.cliente_nome,
        contexto: "convencional",
      }),
      resolveResponsavelTecnico({
        clienteId: entrada.cliente_id,
        clienteNome: entrada.cliente_nome,
      }).catch(() => ""),
      ensureEntradaPublicToken(entrada)
        .then((token) => ({ token: token || "", error: "" }))
        .catch((err) => ({ token: "", error: err?.message || t("errors.saveFailed") })),
    ])
      .then(([config, responsavel, tokenResult]) => {
        if (cancelled) return;
        setPrintConfig(config);
        setResponsavelTecnico(responsavel || "");
        setPublicToken(tokenResult.token);
        setTokenError(tokenResult.error);
      })
      .catch((err) => {
        if (!cancelled) setTokenError(err?.message || t("errors.saveFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, entrada?.id, entrada?.cliente_id, entrada?.cliente_nome, entrada?.public_token, t]);

  const handlePrint = async () => {
    if (!model || !qtyOk || !publicToken || !embalagemOk) return;
    if (hasEmbalagemChoices && !volumeOk) {
      toast({
        title: t("containers.vasilhames.validationTitle"),
        description: t("containers.vasilhames.printLabelVolumeRequired"),
        variant: "destructive",
      });
      return;
    }
    setPrinting(true);
    try {
      await printEntradaEtiqueta(model, {
        copies: Math.round(Number(qty)),
        orientation: printConfig?.orientation || "horizontal",
        locale: i18n.language,
        dateFormat: printConfig?.dateFormat || "dmy",
        campos: etiquetaCampos,
        publicToken,
        responsavelTecnico,
        qrHint: t("pdf.label.qrHintEntrada"),
      });
      onOpenChange?.(false);
    } catch (err) {
      toast({
        title: t("errors.saveFailed"),
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  };

  const previewValues = model
    ? {
        product: model.produto,
        client: model.cliente,
        op_number: model.id,
        lot: model.lote,
        manufactureDate: model.fabricacao,
        fillingDate: model.envase,
        expiryDate: model.validade,
        net_weight: model.netWeight || 0,
        gross_weight: model.grossWeight || 0,
        volume: model.volumeLitros,
        embalagem: model.embalagem,
        publicToken: publicToken || "preview",
        responsavel_tecnico: responsavelTecnico,
      }
    : null;

  const canPrint =
    !printing &&
    !loading &&
    qtyOk &&
    !!model &&
    !!publicToken &&
    embalagemOk &&
    (!hasEmbalagemChoices || volumeOk);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-[760px] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("containers.vasilhames.printLabelTitle")}</DialogTitle>
        </DialogHeader>

        {model && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {loading && !printConfig ? (
              <div className="flex items-center justify-center h-[220px] text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                {t("common.loading")}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg bg-muted/40 px-3 py-4">
                <EtiquetaPreview
                  chrome={false}
                  weightDecimals={0}
                  convencional
                  campos={etiquetaCampos}
                  dateFormat={printConfig?.dateFormat || "dmy"}
                  orientation={printConfig?.orientation || "horizontal"}
                  consultaPath={CONSULTA_ENTRADA_PATH}
                  values={previewValues}
                />
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  {t("pdf.label.entradaPublicNote")}
                </p>
              </div>
            )}

            {tokenError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {tokenError}
              </p>
            ) : null}

            {multiple && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
                <label
                  htmlFor="entrada-etiqueta-lote"
                  className="text-xs font-medium text-muted-foreground mb-1.5 block"
                >
                  {t("common.lot")}
                </label>
                <Select
                  value={String(loteIndex)}
                  onValueChange={(value) => {
                    setSelectedIndex(Number(value));
                    setVolumeOverride(null);
                  }}
                >
                  <SelectTrigger id="entrada-etiqueta-lote" className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lotes.map((item, index) => (
                      <SelectItem key={`${item.produto_id || "p"}-${index}`} value={String(index)}>
                        {entradaEtiquetaOptionLabel(item, index, lotes)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">
                  {t("containers.vasilhames.printLabelLoteHint")}
                </p>
              </div>
            )}

            <div
              className={`grid grid-cols-1 gap-4 ${
                hasEmbalagemChoices ? "sm:grid-cols-2" : ""
              }`}
            >
              {hasEmbalagemChoices ? (
                <div>
                  <label
                    htmlFor="entrada-etiqueta-volume"
                    className="text-xs font-medium text-muted-foreground mb-1 block"
                  >
                    {t("containers.fields.volume")} (L) *
                  </label>
                  <NumberInputBr
                    id="entrada-etiqueta-volume"
                    key={`vol-${sessionKey}-${seedVolume || "empty"}`}
                    value={volume}
                    onChange={setVolumeOverride}
                    decimals={0}
                    min={0}
                    placeholder="0"
                    aria-label={t("containers.fields.volume")}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("containers.vasilhames.printLabelVolumeHintTank")}
                  </p>
                </div>
              ) : null}
              <div className={hasEmbalagemChoices ? "" : "max-w-xs"}>
                <label
                  htmlFor="entrada-etiqueta-qty"
                  className="text-xs font-medium text-muted-foreground mb-1 block"
                >
                  {t("containers.vasilhames.printLabelQty")} *
                </label>
                <NumberInputBr
                  id="entrada-etiqueta-qty"
                  value={qty}
                  onChange={(value) =>
                    setQty(value === "" ? "" : Math.max(1, Math.round(Number(value) || 1)))
                  }
                  decimals={0}
                  min={1}
                  placeholder="1"
                  aria-label={t("containers.vasilhames.printLabelQty")}
                />
              </div>
            </div>

            {hasEmbalagemChoices ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">
                    {t("containers.fields.netWeight")}
                  </p>
                  <p className="font-semibold text-green-700">
                    {model.netWeight != null
                      ? `${fmtNumber(
                          Math.round(Number(model.netWeight)),
                          { minimumFractionDigits: 0, maximumFractionDigits: 0 },
                          i18n.language
                        )} kg`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">
                    {t("containers.fields.grossWeight")}
                  </p>
                  <p className="font-semibold">
                    {model.grossWeight != null
                      ? `${fmtNumber(
                          Math.round(Number(model.grossWeight)),
                          { minimumFractionDigits: 0, maximumFractionDigits: 0 },
                          i18n.language
                        )} kg`
                      : "—"}
                  </p>
                </div>
              </div>
            ) : null}

            {hasEmbalagemChoices ? (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  {t("containers.vasilhames.printLabelEmbalagem")} *
                </div>
                <RadioGroup
                  value={embalagemChoice || embalagemChoices[0] || ""}
                  onValueChange={setEmbalagemChoice}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                >
                  {embalagemChoices.map((opt) => {
                    const selected = embalagemChoice === opt;
                    const id = `entrada-etiqueta-embalagem-${opt.replace(/\s+/g, "-").toLowerCase()}`;
                    return (
                      <label
                        key={opt}
                        htmlFor={id}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:bg-muted/40"
                        }`}
                      >
                        <RadioGroupItem value={opt} id={id} />
                        <span className="text-sm font-medium">{opt}</span>
                      </label>
                    );
                  })}
                </RadioGroup>
                <p className="text-xs text-muted-foreground mt-2">
                  Informação impressa no campo embalagem da etiqueta.
                </p>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter className="mt-2 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={printing}>
            {t("buttons.cancel")}
          </Button>
          <Button
            onClick={handlePrint}
            disabled={!canPrint}
            className="text-white"
            style={{ background: "#2575D1" }}
          >
            {printing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t("containers.vasilhames.printingLabels")}
              </>
            ) : (
              <>
                <Printer className="w-4 h-4 mr-2" />
                {t("containers.vasilhames.printLabelConfirm")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
