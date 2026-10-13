import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInternalAuth as useAuth } from "@/lib/InternalAuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import { SelectDot } from "@shared/components/ui/SelectDot";
import { useToast } from "@shared/components/ui/use-toast";
import { entities } from "@transbordo/services/entities";
import { Check, ClipboardList, FileText, Printer } from "lucide-react";
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
  tipoItemLabel,
  formatSaidaItemLote,
  formatSaidaItemEmbalagem,
  resolveItemOrigem,
  isSaidaValidadaNoModulo,
} from "@transbordo/lib/saidaOrigem";
import { findChecklistItemForSaidaLinha } from "@painel/lib/carregamentoChecklistConfig";
import SaidaChecklistItemViewDialog from "@painel/components/logistica/SaidaChecklistItemViewDialog";

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

function quantidadeItens(items) {
  return items.reduce(
    (sum, item) => sum + (Number(item?.quantidade_solicitada) || 0),
    0
  );
}

export default function SaidaViewDialog({
  open,
  onClose,
  saida,
  vasilhames = [],
  entradas = [],
  variant = "default",
  showRelatorioFiscal = true,
  showRelatorioSaida = true,
  highlightModule = null,
  checklistItems = null,
  showPrintEtiqueta = true,
  onSaidaChange,
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [checklistItemView, setChecklistItemView] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [markedLocal, setMarkedLocal] = useState(() => new Set());
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    setSelected(new Set());
    setMarkedLocal(new Set());
    setPrinting(false);
  }, [open, saida?.id]);

  if (!saida) return null;

  const isAgendamento = variant === "agendamento";
  const hasChecklist = Array.isArray(checklistItems) && checklistItems.length > 0;
  const itens = saida.itens || [];
  const canSelectFiscal = showRelatorioFiscal && !isAgendamento;
  const colCount = (isAgendamento ? 8 : 7) + (canSelectFiscal ? 1 : 0);
  const allSelected = itens.length > 0 && selected.size === itens.length;
  const someSelected = selected.size > 0 && !allSelected;
  const statusLabel = highlightModule
    ? isSaidaValidadaNoModulo(saida, highlightModule)
      ? "Validado"
      : "Pendente"
    : saida.status === "enviado_fiscal" || saida.enviado_ao_fiscal
      ? "Validado"
      : "Pendente";
  const showRelatorio = isAgendamento ? showRelatorioSaida : showRelatorioFiscal;

  const toggleItem = (index) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === itens.length
        ? new Set()
        : new Set(itens.map((_, index) => index))
    );
  };

  const itemJaGerado = (item, index) =>
    Boolean(item?.relatorio_fiscal_gerado) || markedLocal.has(index);

  const handlePrintRelatorio = async () => {
    if (isAgendamento) {
      printSaidaAgendamento(saida, { t, vasilhames });
      return;
    }

    const indexes =
      selected.size > 0
        ? [...selected].sort((a, b) => a - b)
        : itens.map((_, index) => index);
    const picked = indexes.map((index) => itens[index]).filter(Boolean);
    const partial = selected.size > 0 && selected.size < itens.length;
    const reportSaida = partial
      ? {
          ...saida,
          itens: picked,
          quantidade_total: quantidadeItens(picked),
        }
      : saida;

    generateRelatorioFiscalSaidaPDF(reportSaida, {
      vasilhames,
      entradas,
      responsavel: user?.nome || user?.full_name || "",
    });

    if (!saida.id || indexes.length === 0) return;

    const now = new Date().toISOString();
    const mark = new Set(indexes);
    const nextItens = itens.map((item, index) =>
      mark.has(index)
        ? {
            ...item,
            relatorio_fiscal_gerado: true,
            relatorio_fiscal_gerado_em: now,
          }
        : item
    );

    setPrinting(true);
    try {
      const saved = await entities.saidas.update(saida.id, { itens: nextItens });
      const nextSaida = saved?.itens ? saved : { ...saida, itens: nextItens };
      setMarkedLocal((prev) => {
        const next = new Set(prev);
        indexes.forEach((index) => next.add(index));
        return next;
      });
      setSelected(new Set());
      onSaidaChange?.(nextSaida);
    } catch (err) {
      toast({
        title: "Relatório gerado",
        description:
          err?.message ||
          "Não foi possível registrar quais itens já tiveram relatório.",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintEtiqueta = async (item) => {
    try {
      await printEtiquetaConvencional(item, saida, vasilhames);
    } catch (err) {
      window.alert(err?.message || t("painel.comercial.agendamentos.printBlocked"));
    }
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setChecklistItemView(null);
          onClose();
        }
      }}
    >
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
                {canSelectFiscal ? (
                  <th className="pl-3 pr-1 py-2.5 w-10">
                    <SelectDot
                      checked={allSelected}
                      indeterminate={someSelected}
                      onClick={toggleAll}
                      label={
                        allSelected
                          ? "Desmarcar todos os itens"
                          : "Selecionar todos os itens"
                      }
                    />
                  </th>
                ) : null}
                <th className="px-3 py-2.5 font-medium">Código</th>
                <th className="px-3 py-2.5 font-medium">Produto</th>
                <th className="px-3 py-2.5 font-medium">Tipo</th>
                <th className="px-3 py-2.5 font-medium">Lote</th>
                <th className="px-3 py-2.5 font-medium">Embalagem</th>
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
                itens.map((item, i) => {
                  const vasilhame = item.vasilhame_id
                    ? vasilhames.find((v) => v.id === item.vasilhame_id)
                    : null;
                  const isForeignModule =
                    Boolean(highlightModule) &&
                    resolveItemOrigem(item) !== highlightModule;
                  const checklistItem = hasChecklist
                    ? findChecklistItemForSaidaLinha(checklistItems, saida, item, i)
                    : null;
                  return (
                  <tr
                    key={i}
                    className={`border-b border-border last:border-0 ${
                      i % 2 === 1 ? "bg-muted/30" : ""
                    } ${isForeignModule ? "text-muted-foreground/80" : ""}`}
                  >
                    {canSelectFiscal ? (
                      <td className="pl-3 pr-1 py-2.5">
                        <SelectDot
                          checked={selected.has(i)}
                          onClick={() => toggleItem(i)}
                          label={`Incluir ${item.produto_nome || "item"} no relatório fiscal`}
                        />
                      </td>
                    ) : null}
                    <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${
                      isForeignModule ? "text-muted-foreground" : "text-primary"
                    }`}>
                      {saida.codigo || item.produto_codigo || "—"}
                    </td>
                    <td className={`px-3 py-2.5 ${
                      isForeignModule ? "text-muted-foreground" : "text-foreground"
                    }`}>
                      <span className="inline-flex items-center gap-1.5">
                        {canSelectFiscal && itemJaGerado(item, i) ? (
                          <Check
                            className="w-3.5 h-3.5 shrink-0 text-emerald-600"
                            aria-label="Relatório fiscal já gerado"
                            title="Relatório fiscal já gerado"
                          />
                        ) : null}
                        <span>{item.produto_nome || "—"}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tipoBadgeClass(item.tipo)} ${
                          isForeignModule ? "opacity-60" : ""
                        }`}
                      >
                        {tipoItemLabel(item)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {formatSaidaItemLote(item, { vasilhame })}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {formatSaidaItemEmbalagem(item, { vasilhame })}
                    </td>
                    <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${
                      isForeignModule ? "text-muted-foreground" : "text-foreground"
                    }`}>
                      {qtdSolicitada(item)}
                    </td>
                    <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${
                      isForeignModule ? "text-muted-foreground" : "text-foreground"
                    }`}>
                      {isAgendamento ? formatQtdEmbalagens(item) : qtdFinalEstoque(item)}
                    </td>
                    {isAgendamento ? (
                      <td className="px-2 py-2.5 text-right">
                        <div className="inline-flex items-center justify-end gap-0.5">
                          {checklistItem ? (
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-muted"
                              title={t("painel.logistica.carregamentos.viewChecklist")}
                              aria-label={t("painel.logistica.carregamentos.viewChecklist")}
                              onClick={() => setChecklistItemView(checklistItem)}
                            >
                              <ClipboardList className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                          ) : null}
                          {showPrintEtiqueta && item.tipo === TIPO_CONVENCIONAL ? (
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
                        </div>
                      </td>
                    ) : null}
                  </tr>
                  );
                })
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

        {canSelectFiscal ? (
          <p className="text-xs text-muted-foreground -mt-1">
            {selected.size > 0
              ? `${selected.size} ${
                  selected.size === 1 ? "item selecionado" : "itens selecionados"
                }. O relatório sai só com eles.`
              : "Sem seleção, o relatório inclui todos os itens."}
          </p>
        ) : null}

        <DialogFooter>
          {showRelatorio ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={printing || (!isAgendamento && itens.length === 0)}
              onClick={handlePrintRelatorio}
            >
              <FileText className="w-4 h-4" />
              {isAgendamento
                ? t("painel.comercial.agendamentos.relatorioSaida")
                : selected.size > 0
                  ? `Relatório Fiscal (${selected.size})`
                  : "Relatório Fiscal"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <SaidaChecklistItemViewDialog
      open={!!checklistItemView}
      item={checklistItemView}
      saida={saida}
      onClose={() => setChecklistItemView(null)}
    />
    </>
  );
}
