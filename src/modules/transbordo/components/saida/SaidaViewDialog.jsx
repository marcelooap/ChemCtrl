import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { FileText, Printer } from "lucide-react";
import { formatMass, formatVolume } from "@transbordo/lib/format";
import { generateRelatorioFiscalSaidaPDF } from "@transbordo/lib/pdfFiscal";
import {
  formatQtdEmbalagens,
  printEtiquetaConvencional,
  printSaidaAgendamento,
} from "@transbordo/lib/printSaidaAgendamento";
import {
  TIPO_EMBALADO,
  TIPO_CONVENCIONAL,
  TIPO_IND_VASILHAME,
  TIPO_IND_RETORNO_MP,
  resolveItemOrigem,
  origemLabel,
  tipoItemLabel,
} from "@transbordo/lib/saidaOrigem";

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
  const modulo = origemLabel(resolveItemOrigem(item));
  if (item.tipo === TIPO_EMBALADO) return `${modulo} · Armazenagem`;
  if (item.tipo === TIPO_IND_RETORNO_MP) {
    return `${modulo} · ${item.lote || "MP"}`;
  }
  const placa = item.vasilhame_placa || "—";
  const barril = item.vasilhame_barril || "—";
  return `${modulo} · ${placa} - ${barril}`;
}

function formatQtdItem(n, unidade) {
  const u = String(unidade || "kg").toLowerCase().trim();
  const isVol = u === "l" || u === "lt" || u === "litro" || u === "litros";
  return `${isVol ? formatVolume(n) : formatMass(n)} ${unidade || "kg"}`;
}

function qtdSolicitada(item) {
  if (item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME) {
    return `${formatVolume(item.volume_solicitado)} L`;
  }
  return formatQtdItem(item.quantidade_solicitada, item.unidade);
}

function qtdFinalEstoque(item) {
  if (item.tipo === TIPO_EMBALADO || item.tipo === TIPO_IND_RETORNO_MP) {
    return formatQtdItem(item.estoque_final, item.unidade);
  }
  if (item.tipo === TIPO_CONVENCIONAL || item.tipo === TIPO_IND_VASILHAME) {
    return `${formatVolume(item.saldo_final)} L`;
  }
  return "—";
}

function tipoBadgeClass(tipo) {
  if (tipo === TIPO_EMBALADO) return "bg-blue-100 text-blue-700";
  if (tipo === TIPO_IND_VASILHAME) return "bg-violet-100 text-violet-700";
  if (tipo === TIPO_IND_RETORNO_MP) return "bg-yellow-100 text-yellow-800";
  return "bg-amber-100 text-amber-700";
}

export default function SaidaViewDialog({
  open,
  onClose,
  saida,
  vasilhames = [],
  entradas = [],
  variant = "default",
}) {
  const { t } = useTranslation();
  if (!saida) return null;

  const isAgendamento = variant === "agendamento";
  const itens = saida.itens || [];
  const colCount = isAgendamento ? 7 : 6;
  const statusLabel =
    saida.status === "enviado_fiscal" || saida.enviado_ao_fiscal
      ? "Validado"
      : "Pendente";

  const handlePrintRelatorio = () => {
    if (isAgendamento) {
      printSaidaAgendamento(saida, { t });
      return;
    }
    generateRelatorioFiscalSaidaPDF(saida, { vasilhames, entradas });
  };

  const handlePrintEtiqueta = async (item) => {
    try {
      await printEtiquetaConvencional(item, saida, vasilhames);
    } catch (err) {
      window.alert(err?.message || t("painel.comercial.agendamentos.printBlocked"));
    }
  };

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
          <InfoItem label="Validação" value={statusLabel} />
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
                <th className="px-3 py-2.5 font-medium">
                  {isAgendamento
                    ? t("painel.comercial.agendamentos.qtdEmbalagens")
                    : "Qtd. Final Estoque"}
                </th>
                {isAgendamento ? <th className="px-3 py-2.5 w-10" /> : null}
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 ? (
                <tr>
                  <td
                    colSpan={colCount}
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
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tipoBadgeClass(item.tipo)}`}
                      >
                        {tipoItemLabel(item)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {origemItem(item)}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">
                      {qtdSolicitada(item)}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">
                      {isAgendamento ? formatQtdEmbalagens(item) : qtdFinalEstoque(item)}
                    </td>
                    {isAgendamento ? (
                      <td className="px-2 py-2.5 text-right">
                        {item.tipo === TIPO_CONVENCIONAL ? (
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-muted"
                            title={t("painel.comercial.agendamentos.printLabel")}
                            aria-label={t("painel.comercial.agendamentos.printLabel")}
                            onClick={() => handlePrintEtiqueta(item)}
                          >
                            <Printer className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        ) : null}
                      </td>
                    ) : null}
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
            onClick={handlePrintRelatorio}
          >
            <FileText className="w-4 h-4" />
            {isAgendamento
              ? t("painel.comercial.agendamentos.relatorioSaida")
              : "Relatório Fiscal"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
