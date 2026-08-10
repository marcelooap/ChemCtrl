import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { FileText } from "lucide-react";
import { formatMass, formatVolume } from "@transbordo/lib/format";
import { generateRelatorioFiscalSaidaPDF } from "@transbordo/lib/pdfFiscal";

const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("pt-BR");
};

function InfoItem({ label, value }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || "—"}</p>
    </div>
  );
}

function origemItem(item) {
  if (item.tipo === "embalado") return "Armazenagem";
  const placa = item.vasilhame_placa || "—";
  const barril = item.vasilhame_barril || "—";
  return `${placa} - ${barril}`;
}

function qtdSolicitada(item) {
  if (item.tipo === "convencional") {
    return `${formatVolume(item.volume_solicitado)} L`;
  }
  return `${formatMass(item.quantidade_solicitada)} kg`;
}

function qtdFinalEstoque(item) {
  if (item.tipo !== "embalado") return "—";
  return `${formatMass(item.estoque_final)} kg`;
}

export default function SaidaViewDialog({
  open,
  onClose,
  saida,
  vasilhames = [],
  entradas = [],
}) {
  if (!saida) return null;

  const itens = saida.itens || [];
  const statusLabel =
    saida.status === "enviado_fiscal" ? "Enviado ao Fiscal" : "Aguardando";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl overflow-hidden gap-4">
        <DialogHeader>
          <DialogTitle>
            Saída {saida.codigo || ""}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <InfoItem label="Cliente" value={saida.cliente_nome} />
          <InfoItem label="Data da Solicitação" value={formatDate(saida.data_solicitacao)} />
          <InfoItem label="Data Programada" value={formatDate(saida.data_programada)} />
          <InfoItem label="Status" value={statusLabel} />
        </div>

        {saida.observacoes ? (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Observações</p>
            <p className="text-sm text-foreground">{saida.observacoes}</p>
          </div>
        ) : null}

        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/40 uppercase">
                <th className="px-3 py-2.5 font-medium">Código</th>
                <th className="px-3 py-2.5 font-medium">Produto</th>
                <th className="px-3 py-2.5 font-medium">Tipo</th>
                <th className="px-3 py-2.5 font-medium">Origem</th>
                <th className="px-3 py-2.5 font-medium">Qtd. Solicitada</th>
                <th className="px-3 py-2.5 font-medium">Qtd. Final Estoque</th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    Nenhum produto nesta saída.
                  </td>
                </tr>
              ) : (
                itens.map((item, i) => (
                  <tr
                    key={i}
                    className={`border-b border-border last:border-0 ${
                      i % 2 === 1 ? "bg-muted/30" : ""
                    }`}
                  >
                    <td className="px-3 py-2.5 font-medium text-primary whitespace-nowrap">
                      {saida.codigo || item.produto_codigo || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-foreground">
                      {item.produto_nome || "—"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          item.tipo === "embalado"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {item.tipo === "embalado" ? "Embalado" : "Convencional"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {origemItem(item)}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">
                      {qtdSolicitada(item)}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">
                      {qtdFinalEstoque(item)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {String(itens.length).padStart(2, "0")}{" "}
            {itens.length === 1 ? "produto" : "produtos"}
          </span>
          <span>
            Qtd. total:{" "}
            <span className="font-medium text-foreground">
              {formatMass(saida.quantidade_total)} kg
            </span>
          </span>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={() =>
              generateRelatorioFiscalSaidaPDF(saida, { vasilhames, entradas })
            }
          >
            <FileText className="w-4 h-4" />
            Relatório Fiscal
          </Button>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
