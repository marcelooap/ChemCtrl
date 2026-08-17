import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
  } from "@shared/components/ui/dialog";
  import { Button } from "@shared/components/ui/button";
  import { Package, FileText, CheckCircle, AlertCircle } from "lucide-react";
import { formatMass, formatVolume, formatDensidade } from "@transbordo/lib/format";
import { origemPertenceAEntrada } from "@transbordo/lib/entradaCodigo";
import { getQuantidadeNotaFiscal } from "@transbordo/lib/conversao";
  
  export default function EntradaViewDialog({ open, onClose, entrada, entradaId, transbordos = [], estoque = [] }) {
    if (!entrada) return null;
  
    const formatDate = (dateStr) => {
      if (!dateStr) return "-";
      const raw = String(dateStr);
      const d = raw.includes("T")
        ? new Date(raw)
        : new Date(`${raw.slice(0, 10)}T00:00:00`);
      if (isNaN(d)) return dateStr;
      return d.toLocaleDateString("pt-BR");
    };
  
    const lotes = (entrada.lotes && entrada.lotes.length > 0)
      ? entrada.lotes
      : [{
          produto_nome: entrada.produto_nome,
          produto_codigo: entrada.produto_codigo,
          lote: entrada.lote,
          quantidade: entrada.quantidade,
          quantidade_declarada: entrada.quantidade_declarada,
          unidade_medida: entrada.unidade_medida,
          data_fabricacao: entrada.data_fabricacao,
          data_validade: entrada.data_validade,
          densidade: entrada.densidade,
        }];
    const lotesCount = lotes.length;
    const foraMargem = entrada.granel_margem === "fora";

    const origemIds = new Set([entrada.id]);
    (estoque || []).forEach((row) => {
      if (String(row.grupo_entrada || "").startsWith("TB")) return;
      if (row.entrada_id === entrada.id) origemIds.add(row.id);
    });
  
    const transbordosUsados = transbordos.filter((t) =>
      (t.origens || []).some((o) =>
        origemPertenceAEntrada(o, origemIds, entradaId)
      )
    );
  
    const destinosList = transbordosUsados.flatMap((t) =>
      (t.destinos || []).map((d) => ({
        codigo: t.codigo_transbordo || "—",
        vasilhame: [d.placa, d.barril].filter(Boolean).join(" / ") || d.tanka_codigo || "-",
        volume: d.volume_total || d.volume || 0,
        pesoLiq: d.peso_liquido || 0,
        lacres: d.lacres || "-",
      }))
    );
  
    const hasPesagem = entrada.granel_pesagem;
  
    const thClass = "px-3 py-1.5 text-left text-xs font-medium text-muted-foreground uppercase border-b border-border bg-muted/40";
    const tdClass = "px-3 py-1.5 text-xs text-foreground/80 border-b border-border";
  
    const handleGerarPDF = async () => {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      let y = 20;
  
      doc.setFontSize(14);
      doc.setTextColor(0, 82, 204);
      doc.text(`Entrada ${entradaId || entrada.id}`, 14, y);
      y += 8;
  
      doc.setFontSize(9);
      doc.setTextColor(94, 108, 132);
      doc.text(`Cliente: ${entrada.cliente_nome || "-"}`, 14, y); y += 5;
      doc.text(`Data: ${formatDate(entrada.data || entrada.created_date || entrada.created_at)}`, 14, y); y += 5;
      doc.text(`Nota Fiscal: ${entrada.nota_fiscal || "-"}`, 14, y); y += 10;
  
      doc.setFontSize(11);
      doc.setTextColor(23, 43, 77);
      doc.text("Produtos", 14, y); y += 6;
      doc.setFontSize(8);
      doc.setTextColor(94, 108, 132);
      lotes.forEach((l) => {
        doc.text(`${l.produto_nome || "-"} | ${formatMass(getQuantidadeNotaFiscal(l, entrada, { lotesCount }), { empty: "-" })} ${l.unidade_medida || ""} | Lote: ${l.lote || "-"}`, 14, y);
        y += 5;
      });
  
      doc.save(`entrada-${entradaId || entrada.id}.pdf`);
    };
  
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-5xl max-h-[88vh] overflow-hidden flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-4 pb-2 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Package className="w-4 h-4 text-muted-foreground" />
              <span className="text-primary">{entrada.produto_codigo || "-"}</span>
              <span className="text-foreground/80">• {entrada.produto_nome || "-"}</span>
            </DialogTitle>
          </DialogHeader>
  
          {/* Topo: Dados da Entrada */}
          <div className="flex-shrink-0 grid grid-cols-4 gap-3 px-5 py-2 bg-muted/40 border-y border-border">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">ID</p>
              <p className="text-xs font-semibold text-foreground">{entradaId || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Data</p>
              <p className="text-xs font-semibold text-foreground">{formatDate(entrada.data || entrada.created_date || entrada.created_at)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Cliente</p>
              <p className="text-xs font-semibold text-foreground">{entrada.cliente_nome || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Nota Fiscal</p>
              <p className="text-xs font-semibold text-foreground">{entrada.nota_fiscal || "-"}</p>
            </div>
            {entrada.nota_fiscal_troca && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Troca Fiscal</p>
                <p className="text-xs font-semibold text-foreground">{entrada.nota_fiscal_troca}</p>
              </div>
            )}
          </div>
  
          {/* Tabelas */}
          <div className="flex-1 px-5 py-2 space-y-2 overflow-y-auto min-h-0">
            {/* Produtos */}
            <div>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Produtos</h3>
              <table className="w-full border border-border rounded overflow-hidden">
                <thead>
                  <tr>
                    <th className={thClass}>Produto</th>
                    <th className={thClass}>Quantidade</th>
                    <th className={thClass}>Unidade</th>
                    <th className={thClass}>Lote</th>
                  </tr>
                </thead>
                <tbody>
                  {lotes.map((l, i) => (
                    <tr key={i}>
                      <td className={tdClass}>{l.produto_nome || "-"}</td>
                      <td className={tdClass}>{formatMass(getQuantidadeNotaFiscal(l, entrada, { lotesCount }), { empty: "-" })}</td>
                      <td className={tdClass}>{l.unidade_medida || "-"}</td>
                      <td className={tdClass}>{l.lote || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
  
            {/* Qualidade */}
            <div>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Qualidade</h3>
              <table className="w-full border border-border rounded overflow-hidden">
                <thead>
                  <tr>
                    <th className={thClass}>Lote</th>
                    <th className={thClass}>Fabricação</th>
                    <th className={thClass}>Validade</th>
                    <th className={thClass}>Densidade</th>
                  </tr>
                </thead>
                <tbody>
                  {lotes.map((l, i) => (
                    <tr key={i}>
                      <td className={tdClass}>{l.lote || "-"}</td>
                      <td className={tdClass}>{formatDate(l.data_fabricacao)}</td>
                      <td className={tdClass}>{formatDate(l.data_validade)}</td>
                      <td className={tdClass}>{formatDensidade(l.densidade)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
  
            {/* Pesagem - apenas se houver */}
            {hasPesagem && (
              <div>
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Pesagem</h3>
                <table className="w-full border border-border rounded overflow-hidden">
                  <thead>
                    <tr>
                      <th className={thClass}>Peso Bruto (kg)</th>
                      <th className={thClass}>Peso Líquido (kg)</th>
                      <th className={thClass}>Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={tdClass}>{formatMass(entrada.granel_peso_bruto, { empty: "-" })}</td>
                      <td className={`${tdClass} ${foraMargem ? "font-bold text-red-800 bg-red-50" : ""}`}>
                        {formatMass(entrada.granel_peso_liquido, { empty: "-" })}
                      </td>
                      <td className={tdClass}>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${entrada.granel_margem === "dentro" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {entrada.granel_margem === "dentro" ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                          {entrada.granel_margem === "dentro" ? "Dentro" : "Fora"}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
  
            {/* Destinos */}
            <div>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Destinos</h3>
              <table className="w-full border border-border rounded overflow-hidden">
                <thead>
                  <tr>
                    <th className={thClass}>OP</th>
                    <th className={thClass}>Vasilhame</th>
                    <th className={thClass}>Volume (L)</th>
                    <th className={thClass}>Peso Líquido (kg)</th>
                    <th className={thClass}>Lacres</th>
                  </tr>
                </thead>
                <tbody>
                  {destinosList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={`${tdClass} text-center text-muted-foreground`}>Nenhum destino registrado.</td>
                    </tr>
                  ) : (
                    destinosList.map((d, i) => (
                      <tr key={i}>
                        <td className={tdClass}>{d.codigo}</td>
                        <td className={tdClass}>{d.vasilhame}</td>
                        <td className={tdClass}>{formatVolume(d.volume, { empty: "-" })}</td>
                        <td className={tdClass}>{formatMass(d.pesoLiq, { empty: "-" })}</td>
                        <td className={tdClass}>{d.lacres}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
  
          <DialogFooter className="flex-shrink-0 px-5 py-2 border-t border-border">
            <Button type="button" variant="outline" size="sm" onClick={handleGerarPDF} className="gap-2">
              <FileText className="w-3.5 h-3.5" />
              PDF
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }