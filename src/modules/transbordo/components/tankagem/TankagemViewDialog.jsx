import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { formatVolume, formatMass, formatDensidade } from "@transbordo/lib/format";

const formatDate = (d) => {
  if (!d) return "—";
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR");
  }
  const raw = String(d);
  const date = raw.includes("T")
    ? new Date(raw)
    : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("pt-BR");
};

function InfoItem({ label, value, highlight, nowrap = false }) {
  return (
    <div className="space-y-0.5 min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`text-sm font-medium ${highlight || "text-foreground"} ${
          nowrap ? "whitespace-nowrap" : ""
        }`}
        title={value ? String(value) : undefined}
      >
        {value || "—"}
      </p>
    </div>
  );
}

function Section({ title, cols = 3, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
        {title}
      </h3>
      <div
        className={`grid gap-4 pl-2 ${
          cols === 5 ? "grid-cols-5" : "grid-cols-3"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export default function TankagemViewDialog({ open, onClose, detalhe }) {
  if (!detalhe) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalhe da Tanka — {detalhe.tanka || "—"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[auto_1fr_auto] gap-6 rounded-lg bg-primary/10 p-4">
          <InfoItem
            label="TANKA"
            value={detalhe.tanka}
            highlight="text-foreground text-lg font-bold"
            nowrap
          />
          <InfoItem
            label="PRODUTO"
            value={detalhe.produto_nome}
            highlight="text-foreground text-lg font-bold"
            nowrap
          />
          <InfoItem
            label="VOLUME ATUAL"
            value={`${formatVolume(detalhe.volume_atual, { empty: "—" })} L`}
            highlight="text-primary text-lg font-bold"
            nowrap
          />
        </div>

        <div className="space-y-6 mt-2">
          <Section title="DADOS GERAIS" cols={5}>
            <InfoItem label="Cliente" value={detalhe.cliente_nome} nowrap />
            <InfoItem label="Produto" value={detalhe.produto_nome} nowrap />
            <InfoItem
              label="Código"
              value={detalhe.produto_codigo}
              nowrap
            />
            <InfoItem
              label="Densidade"
              value={formatDensidade(detalhe.densidade)}
              nowrap
            />
            <InfoItem
              label="Capacidade"
              value={`${formatVolume(detalhe.capacidade, { empty: "—" })} L`}
              nowrap
            />
          </Section>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
              COMPOSIÇÃO POR LOTE
            </h3>
            <div className="pl-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                    <th className="px-3 py-2 text-left font-medium">Lote</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Volume (L)
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Massa (kg)
                    </th>
                    <th className="px-3 py-2 text-left font-medium">
                      Data de Envase
                    </th>
                    <th className="px-3 py-2 text-left font-medium">
                      Operador
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(detalhe.lotes || []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        Tanka vazia — nenhum lote disponível.
                      </td>
                    </tr>
                  ) : (
                    detalhe.lotes.map((l, i) => (
                      <tr
                        key={`${l.lote}-${i}`}
                        className="border-t border-border"
                      >
                        <td className="px-3 py-2 font-medium text-foreground">
                          {l.lote || "—"}
                          {i === 0 && detalhe.lotes.length > 1 && (
                            <span className="ml-2 text-xs text-primary font-medium">
                              (maior volume)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground/80">
                          {formatVolume(l.volume, { empty: "—" })}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground/80">
                          {formatMass(l.massa, { empty: "—" })}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDate(l.data_envase)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {(l.operadores || []).join(", ") || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {(detalhe.historico || []).length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
                HISTÓRICO DE ENVASE
              </h3>
              <div className="pl-2 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                      <th className="px-3 py-2 text-left font-medium">OP</th>
                      <th className="px-3 py-2 text-left font-medium">Data</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Volume (L)
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Massa (kg)
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Lotes origem
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Operadores
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhe.historico.map((h, i) => (
                      <tr key={`${h.codigo}-${i}`} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-primary">
                          {h.codigo || "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDate(h.data)}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground/80">
                          {formatVolume(h.volume, { empty: "—" })}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground/80">
                          {formatMass(h.massa, { empty: "—" })}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {h.lotes || "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {(h.operadores || []).join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
