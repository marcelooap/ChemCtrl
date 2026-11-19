import { useState } from "react";
import {
  FileText,
  Loader2,
  Package,
  Printer,
  RotateCw,
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
import { useToast } from "@shared/components/ui/use-toast";
import PrintContainerLabelDialog from "@industrializacao/components/vasilhames/PrintContainerLabelDialog";
import EntradaEtiquetaDialog, {
  EMBALAGEM_ORIGEM_GRANEL_OPTIONS,
} from "@transbordo/components/entrada/EntradaEtiquetaDialog";
import { buildEstoqueDisplayCodigoMap } from "@transbordo/lib/entradaCodigo";
import { resolveOrigemGranelRecebimento } from "@transbordo/lib/origemGranelRecebimento";
import { buildTransbordoViewModel } from "@transbordo/lib/transbordoViewData";
import { loadConvencionalLabelContext } from "@transbordo/lib/printSaidaAgendamento";
import { TIPO_CONVENCIONAL } from "@transbordo/lib/saidaOrigem";

function destinoPodeImprimirEtiqueta(destino) {
  const tipo = String(destino?.tipo_embalagem || "").trim();
  if (!tipo || tipo === "Tankagem") return false;
  return true;
}

function buildLabelItemFromDestino(destino, transbordo) {
  return {
    tipo: TIPO_CONVENCIONAL,
    vasilhame_id:
      destino?.vasilhame_existente_id || destino?.vasilhame_id || null,
    vasilhame_placa: destino?.placa || "",
    vasilhame_barril: destino?.barril || "",
    produto_id: transbordo?.produto_id,
    produto_codigo: transbordo?.produto_codigo,
    produto_nome: transbordo?.produto_nome,
    tipo_embalagem: destino?.tipo_embalagem || "Vasilhame",
    volume_disponivel: destino?.volume_total || destino?.volume || 0,
    volume_solicitado: destino?.volume_total || destino?.volume || 0,
    volume_por_embalagem: destino?.volume_por_embalagem || 0,
    quantidade_embalagens: destino?.quantidade_embalagens,
    peso_liquido: destino?.peso_liquido,
    lote: destino?.lote || "",
    cliente_nome: transbordo?.cliente_nome,
  };
}

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
  "px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground uppercase bg-muted/40";
const tdClass =
  "px-2 py-1.5 text-center align-middle text-sm border-t border-border whitespace-nowrap";
const thDestinoClass = `${thClass}`;
const tdDestinoBase =
  "px-2 py-1.5 text-center align-middle text-sm border-t border-border";

export default function TransbordoViewDialog({
  open,
  onClose,
  transbordo,
  produtos = [],
  entradas = [],
  isotanques = [],
  vasilhames = [],
}) {
  const { toast } = useToast();
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [labelDialog, setLabelDialog] = useState(null);
  const [labelLoadingIndex, setLabelLoadingIndex] = useState(null);
  const [origemLabelDialog, setOrigemLabelDialog] = useState(null);
  const [origemLabelLoadingKey, setOrigemLabelLoadingKey] = useState(null);

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
  const destinos = Array.isArray(transbordo.destinos) ? transbordo.destinos : [];
  const destinoColSpan =
    5 + (view.showEmbalagem ? 1 : 0) + (view.showQtd ? 1 : 0);
  const showOrigemEtiqueta = view.origemRows.some((row) => row.isGranel);
  const origemColSpan = showOrigemEtiqueta ? 6 : 5;
  const estoqueCodigoMap = buildEstoqueDisplayCodigoMap(entradas);

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

  const handlePrintEtiqueta = async (destinoIndex) => {
    const destino = destinos[destinoIndex];
    if (!destino || !destinoPodeImprimirEtiqueta(destino) || labelLoadingIndex != null) {
      return;
    }
    setLabelLoadingIndex(destinoIndex);
    try {
      const ctx = await loadConvencionalLabelContext(
        buildLabelItemFromDestino(destino, transbordo),
        {
          codigo: transbordo.codigo_transbordo,
          cliente_id: transbordo.cliente_id,
          cliente_nome: transbordo.cliente_nome,
        },
        vasilhames
      );
      if (!ctx?.container) {
        throw new Error("Não foi possível montar a etiqueta deste destino.");
      }
      setLabelDialog(ctx);
    } catch (err) {
      toast({
        title: "Imprimir etiqueta",
        description: err?.message || "Não foi possível abrir a etiqueta.",
        variant: "destructive",
      });
    } finally {
      setLabelLoadingIndex(null);
    }
  };

  const handlePrintOrigemEtiqueta = async (origemRow) => {
    if (!origemRow?.isGranel || origemLabelLoadingKey != null) return;
    const loadingKey = `${origemRow.origemIndex}-${origemRow.groupIndex}`;
    setOrigemLabelLoadingKey(loadingKey);
    try {
      const origem =
        (transbordo?.origens || [])[origemRow.origemIndex] || null;
      const { entrada, entradaCodigo } = await resolveOrigemGranelRecebimento({
        origem,
        transbordo,
        estoqueList: entradas,
        estoqueCodigoMap,
      });
      setOrigemLabelDialog({
        entrada,
        entradaCodigo,
        initialLote: origemRow.loteKey || origem?.lote || "",
      });
    } catch (err) {
      toast({
        title: "Imprimir etiqueta",
        description: err?.message || "Não foi possível abrir a etiqueta.",
        variant: "destructive",
      });
    } finally {
      setOrigemLabelLoadingKey(null);
    }
  };

  const handleClose = () => {
    setLabelDialog(null);
    setLabelLoadingIndex(null);
    setOrigemLabelDialog(null);
    setOrigemLabelLoadingKey(null);
    onClose();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="w-[min(96vw,64rem)] max-w-[min(96vw,64rem)] max-h-[92vh] overflow-hidden flex flex-col gap-0 p-0">
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
            <div className="-mx-1">
              <table className="w-full border border-border rounded-lg overflow-hidden">
                <thead>
                  <tr>
                    <th className={thClass}>Origem</th>
                    <th className={thClass}>Produto</th>
                    <th className={thClass}>Lote</th>
                    <th className={thClass}>Vol. Retirado (L)</th>
                    <th className={thClass}>Massa (kg)</th>
                    {showOrigemEtiqueta ? (
                      <th className={`${thClass} w-14`}>Etiqueta</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {view.origemRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={origemColSpan}
                        className="px-3 py-3 text-center text-sm text-muted-foreground"
                      >
                        Nenhuma origem registrada.
                      </td>
                    </tr>
                  ) : (
                    view.origemRows.map((row, i) => {
                      const showPrint =
                        row.isGranel &&
                        (row.groupSize <= 1 || row.groupIndex === 0);
                      const loadingKey = `${row.origemIndex}-${row.groupIndex}`;
                      const printingThis = origemLabelLoadingKey === loadingKey;
                      return (
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
                          {showOrigemEtiqueta ? (
                            <td className={tdClass}>
                              {showPrint ? (
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50"
                                  title="Imprimir etiqueta"
                                  aria-label="Imprimir etiqueta"
                                  disabled={origemLabelLoadingKey != null}
                                  onClick={() => handlePrintOrigemEtiqueta(row)}
                                >
                                  {printingThis ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Printer className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })
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
              <div className="-mx-1">
                <table className="w-full table-fixed border border-border rounded-lg overflow-hidden">
                  <colgroup>
                    {view.showEmbalagem ? <col style={{ width: "12.5rem" }} /> : null}
                    <col style={{ width: "7.5rem" }} />
                    {view.showQtd ? <col style={{ width: "4rem" }} /> : null}
                    <col style={{ width: "5.5rem" }} />
                    <col style={{ width: "6.5rem" }} />
                    <col />
                    <col style={{ width: "3rem" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      {view.showEmbalagem ? (
                        <th className={thDestinoClass}>Embalagem</th>
                      ) : null}
                      <th className={thDestinoClass}>Lote</th>
                      {view.showQtd ? (
                        <th className={thDestinoClass}>Qtd.</th>
                      ) : null}
                      <th className={thDestinoClass}>Vol. (L)</th>
                      <th className={thDestinoClass}>Massa (kg)</th>
                      <th className={thDestinoClass}>Lacre</th>
                      <th
                        className={`${thDestinoClass} px-1`}
                        title="Etiqueta"
                        aria-label="Etiqueta"
                      >
                        <Printer className="mx-auto h-3.5 w-3.5" aria-hidden />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.destinoRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={destinoColSpan}
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
                        const destino = destinos[row.groupId];
                        const canPrint = destinoPodeImprimirEtiqueta(destino);
                        const printingThis = labelLoadingIndex === row.groupId;
                        return (
                          <tr key={`${row.groupId}-${row.groupIndex}`}>
                            {view.showEmbalagem ? (
                              <td
                                className={`${tdDestinoBase} font-medium text-foreground whitespace-nowrap ${divider}`}
                              >
                                <span className="inline-flex items-center justify-center gap-1">
                                  <span>{row.embalagem}</span>
                                  {row.completado ? (
                                    <span
                                      className="inline-flex items-center justify-center shrink-0"
                                      title="Tanque completado neste transbordo"
                                      aria-label="Tanque completado neste transbordo"
                                    >
                                      <RotateCw className="h-3.5 w-3.5 text-orange-500" />
                                    </span>
                                  ) : null}
                                </span>
                              </td>
                            ) : null}
                            <td
                              className={`${tdDestinoBase} text-muted-foreground whitespace-normal break-all overflow-hidden ${divider}`}
                            >
                              {row.lote}
                            </td>
                            {view.showQtd ? (
                              <td
                                className={`${tdDestinoBase} text-muted-foreground whitespace-nowrap ${divider}`}
                              >
                                {row.qtd}
                              </td>
                            ) : null}
                            <td
                              className={`${tdDestinoBase} text-primary font-medium tabular-nums whitespace-nowrap ${divider}`}
                            >
                              {row.volume}
                            </td>
                            <td
                              className={`${tdDestinoBase} text-muted-foreground tabular-nums whitespace-nowrap ${divider}`}
                            >
                              {row.massa}
                            </td>
                            {!mixed || firstOfGroup ? (
                              <td
                                rowSpan={mixed ? row.groupSize : undefined}
                                className={`${tdDestinoBase} text-muted-foreground whitespace-normal break-words overflow-hidden text-[12px] leading-snug ${
                                  groupIsLast ? "" : "border-b border-border"
                                }`}
                              >
                                <span className="block min-w-0 max-w-full">
                                  {row.lacre}
                                </span>
                              </td>
                            ) : null}
                            {!mixed || firstOfGroup ? (
                              <td
                                rowSpan={mixed ? row.groupSize : undefined}
                                className={`${tdDestinoBase} bg-card px-1 align-middle ${
                                  groupIsLast ? "" : "border-b border-border"
                                }`}
                              >
                                {canPrint ? (
                                  <button
                                    type="button"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50"
                                    title="Imprimir etiqueta"
                                    aria-label="Imprimir etiqueta"
                                    disabled={labelLoadingIndex != null}
                                    onClick={() => handlePrintEtiqueta(row.groupId)}
                                  >
                                    {printingThis ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Printer className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
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
          <Button type="button" variant="outline" onClick={handleClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <PrintContainerLabelDialog
      key={labelDialog?.container?.id || "closed"}
      open={Boolean(labelDialog?.container)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setLabelDialog(null);
      }}
      container={labelDialog?.container || null}
      initialVolume={labelDialog?.initialVolume}
      density={labelDialog?.density}
      contexto={labelDialog?.contexto || "convencional"}
      clienteId={labelDialog?.clienteId}
      clienteNome={labelDialog?.clienteNome}
      manufactureDate={labelDialog?.manufactureDate || undefined}
      expiryDate={labelDialog?.expiryDate || undefined}
      resolvePublicToken={labelDialog?.resolvePublicToken}
    />

    <EntradaEtiquetaDialog
      key={origemLabelDialog?.entrada?.id || "origem-label-closed"}
      open={Boolean(origemLabelDialog?.entrada)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setOrigemLabelDialog(null);
      }}
      entrada={origemLabelDialog?.entrada || null}
      entradaCodigo={origemLabelDialog?.entradaCodigo || ""}
      initialLote={origemLabelDialog?.initialLote || ""}
      embalagemOptions={EMBALAGEM_ORIGEM_GRANEL_OPTIONS}
    />
    </>
  );
}
