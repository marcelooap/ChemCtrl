import { useState } from "react";
import {
  FileText,
  Loader2,
  Package,
  Scale,
  User,
  Warehouse,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { buildTransbordoViewModel } from "@transbordo/lib/transbordoViewData";

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

const thClass =
  "px-3 py-1.5 text-center text-[11px] font-medium text-muted-foreground uppercase bg-muted/40";
const tdClass =
  "px-3 py-2 text-center align-middle text-sm border-t border-border whitespace-nowrap";

export default function TransbordoViewDialog({
  open,
  onClose,
  transbordo,
  produtos = [],
  entradas = [],
  isotanques = [],
  vasilhames = [],
}) {
  const [generatingPdf, setGeneratingPdf] = useState(false);
  if (!transbordo) return null;

  const view = buildTransbordoViewModel({
    transbordo,
    produtos,
    entradas,
    isotanques,
    vasilhames,
  });

  const codigo = transbordo.codigo_transbordo || "";
  const produtoSubtitle = [view.produto, view.cliente].filter(Boolean).join(" · ") || "—";

  const handlePdf = async () => {
    setGeneratingPdf(true);
    try {
      const { downloadTransbordoViewPdf } = await import(
        "@transbordo/lib/pdfTransbordoView"
      );
      downloadTransbordoViewPdf({
        transbordo,
        produtos,
        entradas,
        isotanques,
        vasilhames,
      });
    } catch (err) {
      window.alert(err?.message || "Não foi possível gerar o PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left space-y-1">
          <DialogTitle className="flex items-center gap-3 flex-wrap text-base">
            <span>Transbordo {codigo}</span>
            {codigo ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-slate-50 text-slate-700 border-slate-200">
                {codigo}
              </span>
            ) : null}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{produtoSubtitle}</p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <SectionCard icon={Package} title="Dados gerais">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <InfoField label="Data" value={view.data} />
              <InfoField label="Cliente" value={view.cliente} />
              <InfoField label="Produto" value={view.produto} />
              <InfoField label="Densidade" value={view.densidade} mono />
              <div className="col-span-2 sm:col-span-3 lg:col-span-4 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Operadores
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(view.operadores || []).length > 0 ? (
                    view.operadores.map((op) => (
                      <span
                        key={op}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold bg-primary/5 text-primary border-primary/20"
                      >
                        <User className="h-3 w-3" />
                        {op}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
              {view.observacoes ? (
                <div className="col-span-2 sm:col-span-3 lg:col-span-4 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Observações
                  </div>
                  <div className="text-sm text-foreground whitespace-pre-wrap">
                    {view.observacoes}
                  </div>
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            icon={Scale}
            title="Origens"
            action={
              view.origemRows.length > 0 ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/70">
                  {view.origemRows.length}
                </span>
              ) : null
            }
          >
            <div className="overflow-x-auto -mx-1">
              <table className="w-full border border-border rounded-lg overflow-hidden">
                <thead>
                  <tr>
                    <th className={thClass}>Origem</th>
                    <th className={thClass}>Produto</th>
                    <th className={thClass}>Lote</th>
                    <th className={thClass}>Vol. Retirado (L)</th>
                    <th className={thClass}>Massa (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {view.origemRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-3 text-center text-sm text-muted-foreground"
                      >
                        Nenhuma origem registrada.
                      </td>
                    </tr>
                  ) : (
                    view.origemRows.map((row, i) => (
                      <tr key={i}>
                        <td className={`${tdClass} font-medium text-foreground`}>
                          {row.origem}
                        </td>
                        <td className={`${tdClass} text-foreground`}>{row.produto}</td>
                        <td className={`${tdClass} text-muted-foreground`}>
                          {row.lote}
                        </td>
                        <td className={`${tdClass} font-medium tabular-nums text-foreground`}>
                          {row.volume}
                        </td>
                        <td className={`${tdClass} text-muted-foreground tabular-nums`}>
                          {row.massa}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard
            icon={Warehouse}
            title="Destinos"
            action={
              view.destinoRows.length > 0 ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/70">
                  {view.destinoRows.length}
                </span>
              ) : null
            }
          >
            <div className="space-y-4">
              <div className="overflow-x-auto -mx-1">
                <table className="w-full border border-border rounded-lg overflow-hidden">
                  <thead>
                    <tr>
                      {view.showEmbalagem ? (
                        <th className={thClass}>Embalagem</th>
                      ) : null}
                      <th className={thClass}>Lote</th>
                      {view.showQtd ? (
                        <th className={thClass}>Qtd. Embalagens</th>
                      ) : null}
                      <th className={thClass}>Volume (L)</th>
                      <th className={thClass}>Massa (kg)</th>
                      <th className={thClass}>Lacre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.destinoRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={
                            3 +
                            (view.showEmbalagem ? 1 : 0) +
                            (view.showQtd ? 1 : 0)
                          }
                          className="px-3 py-3 text-center text-sm text-muted-foreground"
                        >
                          Nenhum destino registrado.
                        </td>
                      </tr>
                    ) : (
                      view.destinoRows.map((row, i) => {
                        const mixed = row.groupSize > 1;
                        const firstOfGroup = row.groupIndex === 0;
                        const lastOfGroup = row.groupIndex === row.groupSize - 1;
                        const groupLastIndex =
                          i + row.groupSize - row.groupIndex - 1;
                        const groupIsLast =
                          groupLastIndex === view.destinoRows.length - 1;
                        const divider =
                          lastOfGroup && !groupIsLast
                            ? "border-b border-border"
                            : "";
                        return (
                          <tr key={`${row.groupId}-${row.groupIndex}`}>
                            {view.showEmbalagem ? (
                              <td
                                className={`${tdClass} font-medium text-foreground ${divider}`}
                              >
                                {row.embalagem}
                              </td>
                            ) : null}
                            <td
                              className={`${tdClass} text-muted-foreground ${divider}`}
                            >
                              {row.lote}
                            </td>
                            {view.showQtd ? (
                              <td
                                className={`${tdClass} text-muted-foreground ${divider}`}
                              >
                                {row.qtd}
                              </td>
                            ) : null}
                            <td
                              className={`${tdClass} text-primary font-medium tabular-nums ${divider}`}
                            >
                              {row.volume}
                            </td>
                            <td
                              className={`${tdClass} text-muted-foreground tabular-nums ${divider}`}
                            >
                              {row.massa}
                            </td>
                            {!mixed || firstOfGroup ? (
                              <td
                                rowSpan={mixed ? row.groupSize : undefined}
                                className={`${tdClass} text-muted-foreground ${
                                  groupIsLast ? "" : "border-b border-border"
                                }`}
                              >
                                {row.lacre}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex flex-wrap justify-between gap-3 text-sm">
                <div className="space-y-0.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Volume total
                  </div>
                  <div className="font-bold tabular-nums text-foreground">
                    {view.volumeTotal}
                  </div>
                </div>
                <div className="space-y-0.5 text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {view.massaCaption}
                  </div>
                  <div className="font-bold tabular-nums text-foreground">
                    {view.massaTotal}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="shrink-0 flex justify-end gap-2 border-t border-border px-5 py-3 bg-muted/20">
          <Button
            type="button"
            className="gap-2"
            onClick={handlePdf}
            disabled={generatingPdf}
          >
            {generatingPdf ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Gerar PDF
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
