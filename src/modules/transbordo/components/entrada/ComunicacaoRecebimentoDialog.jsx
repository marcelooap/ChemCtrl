import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import {
  Package,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  FileText,
  Loader2,
} from "lucide-react";
import { formatNum } from "@transbordo/lib/format";
import { buildEntradaRecebimentoViewModel } from "@transbordo/lib/entradaRecebimentoViewData";
import OrgaoRegulamentadorBadge, {
  OrgaoControladoBanner,
} from "@transbordo/components/cadastro/OrgaoRegulamentadorBadge";

export default function ComunicacaoRecebimentoDialog({
  open,
  onClose,
  entrada,
  entradaId,
  produtos = [],
  transbordos = [],
  estoque = [],
  destinosInformados = [],
  controleLotes = [],
}) {
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const view = useMemo(
    () =>
      entrada
        ? buildEntradaRecebimentoViewModel({
            entrada,
            entradaId,
            produtos,
            transbordos,
            estoque,
            destinosInformados,
            controleLotes,
          })
        : null,
    [
      entrada,
      entradaId,
      produtos,
      transbordos,
      estoque,
      destinosInformados,
      controleLotes,
    ]
  );

  const thClass =
    "px-2.5 py-1 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border bg-muted/50 whitespace-nowrap";
  const tdClass =
    "px-2.5 py-1 text-xs text-foreground/90 border-b border-border whitespace-nowrap";

  const handleOpenChange = (v) => {
    if (!v) {
      onClose();
    }
  };

  const handlePdf = async () => {
    setGeneratingPdf(true);
    try {
      const { downloadEntradaRecebimentoPdf } = await import(
        "@transbordo/lib/pdfEntradaRecebimento"
      );
      await downloadEntradaRecebimentoPdf({
        entrada,
        entradaId,
        produtos,
        transbordos,
        estoque,
        destinosInformados,
        controleLotes,
      });
    } catch (err) {
      window.alert(err?.message || "Não foi possível gerar o PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (!open || !entrada || !view) return null;

  const pesagem = view.pesagem;
  const dadosDiferencaPesagem = pesagem?.dadosDiferencaPesagem;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[95vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-4 pb-2 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="w-4 h-4 text-muted-foreground" />
            <span className="text-primary">Recebimento {view.entradaId}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 px-5 pb-3 space-y-2.5 bg-card overflow-hidden">
          <div className="grid grid-cols-2 gap-4 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                ID de Entrada
              </p>
              <p className="text-sm font-semibold text-foreground">{view.entradaId}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Data de Entrada
              </p>
              <p className="text-sm font-semibold text-foreground">
                {view.dataEntrada}
              </p>
            </div>
          </div>

          {view.controle.banner ? (
            <OrgaoControladoBanner
              orgao={view.controle.banner.orgao}
              label={view.controle.banner.label}
            />
          ) : null}

          <CompactSection title="Produtos Recebidos">
            <table className="w-full border border-border rounded overflow-hidden">
              <thead>
                <tr>
                  <th className={thClass}>Cód</th>
                  <th className={thClass}>Produto</th>
                  <th className={thClass}>Nota Fiscal</th>
                  <th className={`${thClass} text-right`}>Quantidade</th>
                  <th className={thClass}>Unidade</th>
                  <th className={thClass}>Lote</th>
                  {view.controle.mostrarPorProduto ? (
                    <th className={thClass}>Órgão</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {view.produtosRows.map((r, i) => (
                  <tr
                    key={i}
                    className={
                      r.controle.controlado && view.controle.mostrarPorProduto
                        ? "bg-amber-50/60"
                        : undefined
                    }
                  >
                    <td className={tdClass}>{r.codigo}</td>
                    <td className={`${tdClass} max-w-[220px] truncate`} title={r.produto}>
                      {r.produto}
                    </td>
                    <td className={tdClass}>{r.notaFiscal}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {r.quantidade}
                    </td>
                    <td className={tdClass}>{r.unidade}</td>
                    <td className={tdClass}>{r.lote}</td>
                    {view.controle.mostrarPorProduto ? (
                      <td className={tdClass}>
                        <OrgaoRegulamentadorBadge
                          controlado={r.controle.controlado}
                          orgao={r.controle.orgao}
                          compact
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </CompactSection>

          <CompactSection title="Controle de Qualidade">
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
                {view.qualidadeRows.map((r, i) => (
                  <tr key={i}>
                    <td className={tdClass}>{r.lote}</td>
                    <td className={tdClass}>{r.fabricacao}</td>
                    <td className={tdClass}>{r.validade}</td>
                    <td className={`${tdClass} tabular-nums`}>{r.densidade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CompactSection>

          {pesagem && (
            <CompactSection title="Pesagem">
              <table className="w-full border border-border rounded overflow-hidden">
                <thead>
                  <tr>
                    <th className={thClass}>Peso Bruto (kg)</th>
                    <th className={thClass}>Peso Líquido (kg)</th>
                    <th className={thClass}>Tara (kg)</th>
                    {pesagem.showDiferencaCol && (
                      <th className={`${thClass} text-right`}>Diferença</th>
                    )}
                    <th className={thClass}>Margem</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={`${tdClass} tabular-nums`}>{pesagem.pesoBruto}</td>
                    <td
                      className={`${tdClass} tabular-nums ${
                        pesagem.foraMargem
                          ? "font-bold text-red-800 bg-red-50"
                          : ""
                      }`}
                    >
                      {pesagem.pesoLiquido}
                    </td>
                    <td className={`${tdClass} tabular-nums`}>{pesagem.tara}</td>
                    {pesagem.showDiferencaCol && dadosDiferencaPesagem && (
                      <td
                        className={`${tdClass} text-right tabular-nums font-semibold ${
                          dadosDiferencaPesagem.difKg < 0
                            ? "text-red-700"
                            : "text-blue-700"
                        }`}
                      >
                        {pesagem.diferenca}
                      </td>
                    )}
                    <td className={tdClass}>
                      {entrada.granel_margem ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            pesagem.dentroMargem
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {pesagem.dentroMargem ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : (
                            <AlertCircle className="w-3 h-3" />
                          )}
                          {pesagem.margem}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>

              {pesagem.alertaNotaFiscal && dadosDiferencaPesagem && (
                <div className="mt-2 p-2.5 rounded-md border border-amber-300 bg-amber-50/80 text-amber-900 flex items-center gap-2 text-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="font-semibold text-amber-950">
                    Quantidade a ser considerada na Nota Fiscal:{" "}
                    <span className="font-bold text-amber-950 underline decoration-amber-500 underline-offset-2">
                      {formatNum(dadosDiferencaPesagem.qtdRealUnidade, 0)}{" "}
                      {dadosDiferencaPesagem.unidadeMedida}
                    </span>
                  </p>
                </div>
              )}
            </CompactSection>
          )}

          {view.transbordo && (
            <CompactSection title="Transbordo">
              <table className="w-full border border-border rounded overflow-hidden">
                <thead>
                  <tr>
                    <th className={thClass}>OP</th>
                    <th className={thClass}>Destino</th>
                    <th className={`${thClass} text-right`}>Volume (L)</th>
                    <th className={`${thClass} text-right`}>Massa (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {view.transbordo.rows.map((d, i) => (
                    <tr key={i}>
                      <td className={tdClass}>{d.op}</td>
                      <td className={tdClass}>{d.destino}</td>
                      <td className={`${tdClass} text-right tabular-nums`}>
                        {d.volume}
                      </td>
                      <td className={`${tdClass} text-right tabular-nums`}>
                        {d.massa}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/40">
                    <td
                      colSpan={2}
                      className={`${tdClass} font-semibold border-b-0`}
                    >
                      Total
                    </td>
                    <td className={`${tdClass} text-right tabular-nums font-semibold border-b-0`}>
                      {view.transbordo.totalVolume}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums font-semibold border-b-0`}>
                      {view.transbordo.totalMassa}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CompactSection>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 px-5 py-3 border-t border-border justify-end gap-2">
          <Button
            type="button"
            size="sm"
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
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompactSection({ title, children }) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {title}
      </h3>
      {children}
    </div>
  );
}
