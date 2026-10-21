import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { buildTransbordoViewModel } from "@transbordo/lib/transbordoViewData";

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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Transbordo {transbordo.codigo_transbordo || ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-primary mb-2">
              Dados Gerais
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Data" value={view.data} />
              <Info label="Produto" value={view.produto} />
              <Info label="Cliente" value={view.cliente} />
              <Info label="Densidade" value={view.densidade} />
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">Operadores</p>
                <div className="flex flex-wrap gap-1.5">
                  {view.operadores.map((op) => (
                    <span
                      key={op}
                      className="inline-flex px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                    >
                      {op}
                    </span>
                  ))}
                </div>
              </div>
              {view.observacoes && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">
                    Observações
                  </p>
                  <p className="text-sm text-foreground">{view.observacoes}</p>
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-primary mb-2">Origens</h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-center text-xs text-muted-foreground border-b border-border bg-muted/40/50 uppercase">
                    <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">
                      Origem
                    </th>
                    <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">Produto</th>
                    <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">Lote</th>
                    <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">Vol. Retirado (L)</th>
                    <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">Massa (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {view.origemRows.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-center align-middle text-foreground font-medium whitespace-nowrap">
                        {row.origem}
                      </td>
                      <td className="px-3 py-2 text-center align-middle text-foreground whitespace-nowrap">
                        {row.produto}
                      </td>
                      <td className="px-3 py-2 text-center align-middle text-muted-foreground whitespace-nowrap">
                        {row.lote}
                      </td>
                      <td className="px-3 py-2 text-center align-middle text-foreground font-medium whitespace-nowrap">
                        {row.volume}
                      </td>
                      <td className="px-3 py-2 text-center align-middle text-muted-foreground whitespace-nowrap">
                        {row.massa}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-primary mb-2">
              Destinos
            </h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-center text-xs text-muted-foreground border-b border-border bg-muted/40/50 uppercase">
                    {view.showEmbalagem && (
                      <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">
                        Embalagem
                      </th>
                    )}
                    <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">Lote</th>
                    {view.showQtd && (
                      <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">Qtd. Embalagens</th>
                    )}
                    <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">Volume (L)</th>
                    <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">Massa (kg)</th>
                    <th className="px-3 py-2 font-medium align-middle whitespace-nowrap">Lacre</th>
                  </tr>
                </thead>
                <tbody>
                  {view.destinoRows.map((row, i) => {
                    const mixed = row.groupSize > 1;
                    const firstOfGroup = row.groupIndex === 0;
                    const lastOfGroup = row.groupIndex === row.groupSize - 1;
                    const groupLastIndex = i + row.groupSize - row.groupIndex - 1;
                    const groupIsLast = groupLastIndex === view.destinoRows.length - 1;
                    const divider =
                      lastOfGroup && !groupIsLast ? "border-b border-border" : "";
                    return (
                      <tr key={`${row.groupId}-${row.groupIndex}`}>
                        {view.showEmbalagem && (
                          <td
                            className={`px-3 py-2 text-center align-middle text-foreground font-medium whitespace-nowrap ${divider}`}
                          >
                            {row.embalagem}
                          </td>
                        )}
                        <td
                          className={`px-3 py-2 text-center align-middle text-muted-foreground whitespace-nowrap ${divider}`}
                        >
                          {row.lote}
                        </td>
                        {view.showQtd && (
                          <td
                            className={`px-3 py-2 text-center align-middle text-muted-foreground whitespace-nowrap ${divider}`}
                          >
                            {row.qtd}
                          </td>
                        )}
                        <td
                          className={`px-3 py-2 text-center align-middle text-primary font-medium whitespace-nowrap ${divider}`}
                        >
                          {row.volume}
                        </td>
                        <td
                          className={`px-3 py-2 text-center align-middle text-muted-foreground whitespace-nowrap ${divider}`}
                        >
                          {row.massa}
                        </td>
                        {(!mixed || firstOfGroup) && (
                          <td
                            rowSpan={mixed ? row.groupSize : undefined}
                            className={`px-3 py-2 text-center align-middle text-muted-foreground whitespace-nowrap ${
                              groupIsLast ? "" : "border-b border-border"
                            }`}
                          >
                            {row.lacre}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-4 flex justify-between text-sm">
            <span className="text-muted-foreground">
              Volume Total:{" "}
              <span className="font-bold text-foreground">{view.volumeTotal}</span>
            </span>
            <span className="text-muted-foreground">
              {view.massaCaption}:{" "}
              <span className="font-bold text-foreground">{view.massaTotal}</span>
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
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
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm text-foreground font-medium">{value}</p>
    </div>
  );
}
