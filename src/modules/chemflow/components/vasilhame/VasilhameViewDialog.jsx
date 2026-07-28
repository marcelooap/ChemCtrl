import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { FileDown, FileText } from "lucide-react";
import { formatVolume, formatMass } from "@chemflow/lib/format";
import { generateBoletaPDF } from "@chemflow/lib/pdfBoleta";
import { generateRelatorioFiscalPDF } from "@chemflow/lib/pdfFiscal";
import {
  aggregateComposicaoByLote,
  getDominantLote,
  LOTE_APORTE_ANTERIOR,
} from "@chemflow/lib/vasilhameComposicao";

const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("pt-BR");
};

  function InfoItem({ label, value, highlight }) {
    return (
      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-sm font-medium ${highlight || "text-foreground"}`}>{value || "—"}</p>
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
  
  export default function VasilhameViewDialog({ open, onClose, vasilhame }) {
    if (!vasilhame) return null;
    const status = vasilhame.status || (vasilhame.data_saida ? "Expedido" : "No Pátio");
    const loteDominante =
      getDominantLote(vasilhame.composicao) || vasilhame.lote || "—";
    const composicaoAgg = aggregateComposicaoByLote(vasilhame.composicao || []).filter(
      (c) => (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR
    );
    const historico = (vasilhame.composicao || []).filter(
      (c) =>
        (c.quantidade_l || 0) > 0 &&
        (c.lote || "").trim() !== LOTE_APORTE_ANTERIOR
    );
  
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhe do Vasilhame</DialogTitle>
          </DialogHeader>
  
          {/* Top Info Strip */}
          <div className="grid grid-cols-3 gap-4 rounded-lg bg-primary/10 p-4">
            <InfoItem label="Nº PLACA" value={vasilhame.placa} highlight="text-foreground text-lg font-bold" />
            <InfoItem label="Nº BARRIL" value={vasilhame.barril} highlight="text-foreground text-lg font-bold" />
            <InfoItem label="ID REGISTRO" value={vasilhame.codigo} highlight="text-primary text-lg font-bold" />
          </div>
  
          <div className="space-y-6">
            <Section title="DADOS DA OP">
              <InfoItem label="Nº OP" value={vasilhame.numero_op} />
              <InfoItem label="Lote (maior volume)" value={loteDominante} />
              <InfoItem label="Produto" value={vasilhame.produto_nome} />
              <InfoItem label="Cliente" value={vasilhame.cliente_nome} />
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Status</p>
                <span
                  className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                    status === "No Pátio" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                  }`}
                >
                  {status}
                </span>
              </div>
              <InfoItem label="Data Saída" value={formatDate(vasilhame.data_saida)} />
            </Section>
  
            <Section title="DADOS DA EMBALAGEM">
              <InfoItem label="Tipo" value={vasilhame.tipo} />
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Volume (L)</p>
                <p className="text-sm font-medium text-primary font-bold inline-flex items-center gap-2 flex-wrap">
                  <span>{formatVolume(vasilhame.volume, { empty: "—" })}</span>
                  {vasilhame.fracionado && (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-blue-800">
                      Fracionado
                    </span>
                  )}
                </p>
              </div>
              <InfoItem label="Tara (kg)" value={formatMass(vasilhame.tara, { empty: "—" })} />
              <InfoItem label="Peso Líquido (kg)" value={formatMass(vasilhame.peso_liquido, { empty: "—" })} highlight="text-green-600 font-bold" />
              <InfoItem label="Peso Bruto (kg)" value={formatMass(vasilhame.peso_bruto, { empty: "—" })} highlight="text-foreground font-bold" />
              <InfoItem label="Menor Teste" value={formatDate(vasilhame.menor_teste)} />
            </Section>
  
            <Section title="LOGÍSTICA">
              <InfoItem label="Lacres" value={vasilhame.lacres} />
              <InfoItem label="Eslinga" value={vasilhame.eslinga} />
              <InfoItem label="GPS" value={vasilhame.gps} />
              <InfoItem label="Responsável" value={vasilhame.responsavel} />
            </Section>
  
            {composicaoAgg.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
                  COMPOSIÇÃO POR LOTE
                </h3>
                <div className="pl-2">
                  <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                    <thead>
                      <tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                        <th className="px-4 py-2 text-left font-medium">Lote</th>
                        <th className="px-4 py-2 text-right font-medium">Volume (L)</th>
                        <th className="px-4 py-2 text-right font-medium">Massa (kg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {composicaoAgg.map((c, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-4 py-2 font-medium text-foreground">
                            {c.lote || "—"}
                            {i === 0 && composicaoAgg.length > 1 && (
                              <span className="ml-2 text-xs text-primary font-medium">
                                (maior volume)
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right text-foreground/80">
                            {formatVolume(c.quantidade_l, { empty: "—" })}
                          </td>
                          <td className="px-4 py-2 text-right text-foreground/80">
                            {formatMass(c.quantidade_kg, { empty: "—" })}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td className="px-4 py-2 font-bold text-foreground">Total</td>
                        <td className="px-4 py-2 text-right font-bold text-primary">
                          {formatVolume(
                            composicaoAgg.reduce((s, c) => s + (c.quantidade_l || 0), 0),
                            { empty: "—" }
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-bold text-green-600">
                          {formatMass(
                            composicaoAgg.reduce((s, c) => s + (c.quantidade_kg || 0), 0),
                            { empty: "—" }
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {historico.length > 1 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-primary border-l-2 border-primary pl-2">
                  HISTÓRICO DE ENVASES / LOTES
                </h3>
                <div className="pl-2">
                  <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                    <thead>
                      <tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                        <th className="px-4 py-2 text-left font-medium">Lote</th>
                        <th className="px-4 py-2 text-right font-medium">Volume (L)</th>
                        <th className="px-4 py-2 text-right font-medium">Massa (kg)</th>
                        <th className="px-4 py-2 text-left font-medium">Transbordo</th>
                        <th className="px-4 py-2 text-left font-medium">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historico.map((c, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-4 py-2 font-medium text-foreground">
                            {c.lote || "—"}
                          </td>
                          <td className="px-4 py-2 text-right text-foreground/80">
                            {formatVolume(c.quantidade_l, { empty: "—" })}
                          </td>
                          <td className="px-4 py-2 text-right text-foreground/80">
                            {formatMass(c.quantidade_kg, { empty: "—" })}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {c.transbordo_codigo || "—"}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {c.data ? formatDate(c.data) : "—"}
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
            <Button type="button" variant="default" onClick={() => generateBoletaPDF(vasilhame)}>
              <FileDown className="w-4 h-4" />
              Gerar Boleta
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => generateRelatorioFiscalPDF(vasilhame)}
            >
              <FileText className="w-4 h-4" />
              Relatório Fiscal
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }