import { useEffect, useState } from "react";
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
import { useToast } from "@shared/components/ui/use-toast";
import EtiquetaPreview from "@painel/components/configuracao/EtiquetaPreview";
import NumberInputBr from "@transbordo/components/NumberInputBr";
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

export default function EntradaEtiquetaDialog({ open, onOpenChange, entrada, entradaCodigo }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const lotes = entrada ? getEntradaLotes(entrada) : [];
  const sessionKey = open && entrada ? String(entrada.id || "") : "";
  const [formSession, setFormSession] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [printConfig, setPrintConfig] = useState(null);
  const [publicToken, setPublicToken] = useState("");
  const [responsavelTecnico, setResponsavelTecnico] = useState("");
  const [tokenError, setTokenError] = useState("");

  if (sessionKey !== formSession) {
    setFormSession(sessionKey);
    setSelectedIndex(0);
    setQty(1);
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

  const model = lote
    ? buildEntradaEtiquetaModel(entrada, lote, { entradaCodigo })
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
    if (!model || !qtyOk || !publicToken) return;
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
        expiryDate: model.validade,
        net_weight: model.netWeight || 0,
        gross_weight: model.grossWeight || 0,
        volume: model.volumeLitros,
        embalagem: model.embalagem,
        publicToken: publicToken || "preview",
        responsavel_tecnico: responsavelTecnico,
      }
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-[760px] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("containers.vasilhames.printLabelTitle")}</DialogTitle>
        </DialogHeader>

        {model && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
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

            <div className={`grid grid-cols-1 gap-4 ${multiple ? "sm:grid-cols-2" : ""}`}>
              {multiple && (
                <div>
                  <label
                    htmlFor="entrada-etiqueta-produto"
                    className="text-xs font-medium text-muted-foreground mb-1 block"
                  >
                    {t("common.product")}
                  </label>
                  <Select
                    value={String(loteIndex)}
                    onValueChange={(value) => setSelectedIndex(Number(value))}
                  >
                    <SelectTrigger id="entrada-etiqueta-produto" className="bg-white">
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
                </div>
              )}
              <div className={multiple ? "" : "max-w-xs"}>
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
          </div>
        )}

        <DialogFooter className="mt-2 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={printing}>
            {t("buttons.cancel")}
          </Button>
          <Button
            onClick={handlePrint}
            disabled={printing || loading || !qtyOk || !model || !publicToken}
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
