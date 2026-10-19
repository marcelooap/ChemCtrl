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
import NumberInputBr from "@transbordo/components/NumberInputBr";
import { resolveEtiquetaPrintConfig } from "@transbordo/lib/etiquetaConfig";
import {
  buildEntradaEtiquetaModel,
  entradaEtiquetaOptionLabel,
  getEntradaLotes,
  printEntradaEtiqueta,
} from "@transbordo/lib/entradaEtiqueta";

function FieldRow({ label, value }) {
  return (
    <div className="flex items-baseline gap-1 min-w-0 text-[12px] leading-tight">
      <span className="font-extrabold uppercase shrink-0">{label}</span>
      <span className="font-bold text-black/80 shrink-0">•</span>
      <span className="font-bold min-w-0 flex-1 truncate">{value}</span>
    </div>
  );
}

function EtiquetaPreviewCard({ model, labels, vertical }) {
  const footer = model.granel ? (
    <div className="font-extrabold uppercase text-[15px] shrink-0 border-t border-black pt-1">
      {model.embalagem}
    </div>
  ) : (
    <div className="font-extrabold uppercase flex gap-1 shrink-0 min-w-0 text-[12px] items-baseline border-t border-black pt-1">
      <span className="shrink-0">{labels.embalagem}</span>
      <span className="font-bold text-black/80 shrink-0">•</span>
      <span className="font-bold min-w-0 flex-1 truncate text-[13px]">{model.embalagem}</span>
    </div>
  );

  return (
    <div className="overflow-x-auto rounded-lg bg-muted/40 px-2 py-2">
      <div
        className="mx-auto flex flex-col bg-white text-black border border-black shadow-lg overflow-hidden"
        style={
          vertical
            ? { width: 200, height: 420, padding: "8px 9px", gap: 6 }
            : { width: 420, height: 200, padding: "7px 12px", gap: 4 }
        }
      >
        <div className={`flex shrink-0 gap-2 ${vertical ? "flex-col items-center text-center" : "items-start justify-between"}`}>
          <div className={`font-extrabold leading-tight line-clamp-2 ${vertical ? "text-[16px]" : "text-[18px] min-w-0"}`}>
            {model.produto}
          </div>
          <div className="font-extrabold text-[11px] leading-tight shrink-0 pt-0.5">
            <span className="uppercase">{labels.id}</span>
            <span className="font-bold text-black/80 mx-1">•</span>
            <span>{model.id}</span>
          </div>
        </div>
        <div className={`flex items-baseline gap-2 border-y border-black shrink-0 ${vertical ? "justify-center py-1.5" : "py-1"}`}>
          <span className="font-extrabold uppercase text-[9px] tracking-wide shrink-0">{labels.cliente}</span>
          <span className="font-extrabold uppercase text-[16px] leading-none truncate">{model.cliente}</span>
        </div>
        <div className={`grid min-h-0 flex-1 content-evenly ${vertical ? "grid-cols-1 gap-1.5" : "grid-cols-2 gap-x-4 gap-y-1"}`}>
          <FieldRow label={labels.lote} value={model.lote} />
          <FieldRow label={labels.data} value={model.data} />
          <FieldRow label={labels.quantidade} value={model.quantidade} />
          <FieldRow label={labels.origem} value={model.origem} />
        </div>
        {footer}
      </div>
    </div>
  );
}

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

  if (sessionKey !== formSession) {
    setFormSession(sessionKey);
    setSelectedIndex(0);
    setQty(1);
    setPrintConfig(null);
    setLoading(Boolean(sessionKey));
  }

  const loteIndex = Math.min(selectedIndex, Math.max(lotes.length - 1, 0));
  const lote = lotes[loteIndex] || null;
  const multiple = lotes.length > 1;
  const qtyOk = Number.isFinite(Number(qty)) && Number(qty) >= 1;

  const labels = {
    cliente: t("pdf.label.client"),
    lote: t("pdf.label.lot"),
    data: t("common.date"),
    quantidade: t("common.quantity"),
    embalagem: t("pdf.label.packaging"),
    id: "ID",
    origem: "Origem",
  };

  const model = lote
    ? buildEntradaEtiquetaModel(entrada, lote, {
        dateFormat: printConfig?.dateFormat || "dmy",
        language: i18n.language,
        entradaCodigo,
      })
    : null;

  useEffect(() => {
    if (!open || !entrada) return undefined;
    let cancelled = false;
    setLoading(true);
    resolveEtiquetaPrintConfig({
      clienteId: entrada.cliente_id,
      clienteNome: entrada.cliente_nome,
      contexto: "convencional",
    })
      .then((config) => {
        if (!cancelled) setPrintConfig(config);
      })
      .catch(() => {
        if (!cancelled) setPrintConfig(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entrada?.id, entrada?.cliente_id, entrada?.cliente_nome]);

  const handlePrint = () => {
    if (!model || !qtyOk) return;
    setPrinting(true);
    try {
      printEntradaEtiqueta(model, {
        copies: Math.round(Number(qty)),
        orientation: printConfig?.orientation || "horizontal",
        locale: i18n.language,
        labels,
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

  const vertical = printConfig?.orientation === "vertical";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-[520px] flex-col overflow-hidden">
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
              <EtiquetaPreviewCard model={model} labels={labels} vertical={vertical} />
            )}

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
            disabled={printing || loading || !qtyOk || !model}
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
