import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { formatVolume } from "@transbordo/lib/format";
import {
  aggregateComposicaoByLote,
  getDominantLote,
  LOTE_APORTE_ANTERIOR,
} from "@transbordo/lib/vasilhameComposicao";
import { PARTICULA_TAMANHOS, formatParticulaCount } from "@transbordo/lib/filtracao";

function InfoItem({ label, value, highlight }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${highlight || "text-foreground"}`}>
        {value ?? "—"}
      </p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
        {title}
      </h3>
      <div className="grid grid-cols-3 gap-4 pl-2">{children}</div>
    </div>
  );
}

export default function FiltracaoViewDialog({ open, onClose, filtracao }) {
  if (!filtracao) return null;

  const loteDominante =
    getDominantLote(filtracao.composicao) || filtracao.lote || "—";
  const composicaoAgg = aggregateComposicaoByLote(filtracao.composicao || []).filter(
    (c) => (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalhe da Filtração</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4 rounded-lg bg-primary/10 p-4">
          <InfoItem
            label="ID (Transbordo)"
            value={filtracao.codigo}
            highlight="text-primary text-lg font-bold"
          />
          <InfoItem
            label="Nº PLACA"
            value={filtracao.placa}
            highlight="text-foreground text-lg font-bold"
          />
          <InfoItem
            label="Nº BARRIL"
            value={filtracao.barril}
            highlight="text-foreground text-lg font-bold"
          />
        </div>

        <div className="space-y-6">
          <Section title="PRODUTO">
            <InfoItem label="Código" value={filtracao.produto_codigo} />
            <InfoItem label="Produto" value={filtracao.produto_nome} />
            <InfoItem label="Cliente" value={filtracao.cliente_nome} />
            <InfoItem label="Lote (maior volume)" value={loteDominante} />
            <InfoItem
              label="Volume (L)"
              value={formatVolume(filtracao.volume, { empty: "—" })}
              highlight="text-primary font-bold"
            />
          </Section>

          <Section title="FILTRAÇÃO">
            <InfoItem
              label="Filtro"
              value={filtracao.filtro_codigo || "—"}
              highlight="text-primary font-bold"
            />
            <InfoItem
              label="SAE"
              value={formatParticulaCount(filtracao.sae)}
              highlight="text-foreground font-bold"
            />
            {PARTICULA_TAMANHOS.map(({ key, label }) => (
              <InfoItem
                key={key}
                label={label}
                value={formatParticulaCount(filtracao[key])}
              />
            ))}
          </Section>

          {composicaoAgg.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
                Composição de Lotes
              </h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                      <th className="px-3 py-2 text-left font-medium">Lote</th>
                      <th className="px-3 py-2 text-right font-medium">Volume (L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {composicaoAgg.map((c, i) => (
                      <tr key={`${c.lote}-${i}`} className="border-t border-border">
                        <td className="px-3 py-2">{c.lote || "—"}</td>
                        <td className="px-3 py-2 text-right font-medium">
                          {formatVolume(c.quantidade_l, { empty: "—" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
