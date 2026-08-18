import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog";
import { Button } from "@shared/components/ui/button";
import TransbordoViewDialog from "@transbordo/components/transbordo/TransbordoViewDialog";
import { formatMass, formatNum } from "@transbordo/lib/format";

function fmtDate(d) {
  if (!d) return "-";
  try {
    return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("pt-BR");
  } catch {
    return d;
  }
}

function fmtDateTime(d) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleString("pt-BR");
  } catch {
    return d;
  }
}

const ORIGEM_TIPO_LABELS = {
  entrada: "transbordo.validacao.origemTipo.granel",
  tanka: "transbordo.validacao.origemTipo.tanka",
  vasilhame: "transbordo.validacao.origemTipo.vasilhame",
  embalado: "transbordo.validacao.origemTipo.embalado",
};

function isMassaUnidade(u) {
  const uu = String(u || "").toLowerCase();
  return uu === "kg" || uu === "lb";
}

function describeOrigem(origem, t) {
  const tipoKey = ORIGEM_TIPO_LABELS[origem?.tipo_origem] || null;
  const tipoLabel = tipoKey ? t(tipoKey) : origem?.tipo_origem || "-";
  const codigo = (origem?.entrada_codigo || "").trim();
  const primary = codigo ? `${tipoLabel} — ${codigo}` : tipoLabel;
  const lote = (origem?.lote || "").trim();
  const secondary = lote ? `${t("transbordo.validacao.fields.lote")}: ${lote}` : "";
  return { primary, secondary };
}

function formatOrigemQuantidade(origem) {
  const vol = Number(origem?.volume_retirado) || 0;
  const massa = Number(origem?.massa_retirada) || 0;
  const um = origem?.unidade_medida;
  const embalado = origem?.tipo_origem === "embalado" || Boolean(origem?.embalado);
  if (embalado && isMassaUnidade(um)) {
    const label = String(um || "kg").toLowerCase() === "lb" ? "lb" : "kg";
    return massa > 0 ? `${formatMass(massa)} ${label}` : "-";
  }
  return vol > 0 ? `${formatNum(vol, 2)} L` : "-";
}

function describeDestino(destino) {
  const tipo = destino?.tipo_embalagem || "-";
  const placa = (destino?.placa || "").trim();
  const barril = (destino?.barril || "").trim();
  const qtdEmb = Number(destino?.quantidade_embalagens) || 0;
  const parts = [tipo];
  if (placa) parts.push(placa);
  if (barril) parts.push(`/ ${barril}`);
  const primary = parts.join(" — ").replace(" — /", " /");
  const detailParts = [];
  if (qtdEmb > 0) detailParts.push(`${qtdEmb}x`);
  if (destino?.tanka_codigo) detailParts.push(destino.tanka_codigo);
  const secondary = detailParts.join(" • ");
  return { primary, secondary };
}

function StatusBadge({ status, t }) {
  const isValidado = status === "validado";
  const isProcessando = status === "processando";
  const cls = isValidado
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : isProcessando
    ? "bg-blue-100 text-blue-700 border-blue-200"
    : "bg-amber-100 text-amber-800 border-amber-200";
  const label = isValidado
    ? t("transbordo.validacao.status.validado")
    : isProcessando
    ? t("transbordo.validacao.status.processando")
    : t("transbordo.validacao.status.pendente");
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${cls}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export default function ValidacaoViewDialog({
  open,
  onClose,
  validacao,
  produtos = [],
  entradas = [],
}) {
  const { t } = useTranslation();
  if (!validacao) return null;

  const granel = validacao.granel_payload;
  const transbordo = validacao.transbordo_payload;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            <span>
              {t("transbordo.validacao.viewTitle", {
                numero: String(validacao.numero || "").padStart(2, "0"),
              })}
            </span>
            <StatusBadge status={validacao.status} t={t} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Header info */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <InfoField label={t("transbordo.validacao.fields.data")} value={fmtDate(validacao.data)} />
            <InfoField label={t("transbordo.validacao.fields.cliente")} value={validacao.cliente_nome} />
            <InfoField
              label={t("transbordo.validacao.fields.produto")}
              value={
                validacao.produto_codigo
                  ? `${validacao.produto_codigo} - ${validacao.produto_nome || ""}`
                  : validacao.produto_nome
              }
            />
            <InfoField
              label={t("transbordo.validacao.fields.tipoOperacao")}
              value={
                validacao.tipo === "granel_transbordo"
                  ? t("transbordo.validacao.tipo.granelTransbordo")
                  : t("transbordo.validacao.tipo.transbordo")
              }
            />
            <InfoField
              label={t("transbordo.validacao.fields.origemTipo")}
              value={validacao.origem_tipo || "-"}
            />
            <InfoField label={t("transbordo.validacao.fields.lote")} value={validacao.lote || "-"} />
            <InfoField
              label={t("transbordo.validacao.fields.quantidade")}
              value={
                validacao.quantidade
                  ? `${formatNum(Number(validacao.quantidade), 2)} ${validacao.unidade_medida || ""}`
                  : "-"
              }
            />
          </section>

          {/* Granel details */}
          {granel && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">
                {t("transbordo.validacao.sections.granel")}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 rounded-lg border border-border p-4 bg-muted/30">
                <InfoField label={t("transbordo.validacao.fields.notaFiscal")} value={granel.nota_fiscal} />
                <InfoField
                  label={t("transbordo.validacao.fields.quantidadeGranel")}
                  value={
                    granel.lotes?.[0]?.quantidade
                      ? `${formatNum(Number(granel.lotes[0].quantidade), 2)} ${granel.lotes[0].unidade_medida || ""}`
                      : "-"
                  }
                />
                <InfoField label={t("transbordo.validacao.fields.densidade")} value={granel.densidade || "-"} />
                <InfoField
                  label={t("transbordo.validacao.fields.precoUnitario")}
                  value={
                    granel.preco_unitario
                      ? `R$ ${formatNum(Number(granel.preco_unitario), 4)}`
                      : "-"
                  }
                />
                <InfoField label={t("transbordo.validacao.fields.ticket")} value={granel.granel_ticket || "-"} />
                <InfoField
                  label={t("transbordo.validacao.fields.pesoBruto")}
                  value={granel.granel_peso_bruto ? `${formatMass(granel.granel_peso_bruto)} kg` : "-"}
                />
                <InfoField
                  label={t("transbordo.validacao.fields.pesoLiquido")}
                  value={granel.granel_peso_liquido ? `${formatMass(granel.granel_peso_liquido)} kg` : "-"}
                />
                <InfoField
                  label={t("transbordo.validacao.fields.margem")}
                  value={
                    granel.granel_margem === "dentro"
                      ? t("transbordo.validacao.margem.dentro")
                      : granel.granel_margem === "fora"
                      ? t("transbordo.validacao.margem.fora")
                      : "-"
                  }
                />
              </div>
            </section>
          )}

          {/* Transbordo details inline (reutilizando dialog existente) */}
          {transbordo && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">
                {t("transbordo.validacao.sections.transbordo")}
              </h3>
              <div className="rounded-lg border border-border p-4 bg-muted/30 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <InfoField
                    label={t("transbordo.validacao.fields.operadores")}
                    value={(transbordo.operadores || []).join(", ") || "-"}
                  />
                  <InfoField
                    label={t("transbordo.validacao.fields.densidade")}
                    value={transbordo.densidade || "-"}
                  />
                </div>

                {(transbordo.origens || []).length > 0 && (
                  <div className="border-t border-border pt-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2 uppercase">
                      {t("transbordo.validacao.fields.origensList")}
                    </div>
                    <ul className="space-y-1 text-sm">
                      {(transbordo.origens || []).map((o, i) => {
                        const { primary, secondary } = describeOrigem(o, t);
                        const quantity = formatOrigemQuantidade(o);
                        return (
                          <li
                            key={i}
                            className="flex items-center justify-between gap-3 px-3 py-1.5 rounded bg-background border border-border"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-foreground truncate" title={primary}>
                                {primary}
                              </div>
                              {secondary && (
                                <div className="text-xs text-muted-foreground truncate" title={secondary}>
                                  {secondary}
                                </div>
                              )}
                            </div>
                            <span className="text-muted-foreground text-xs whitespace-nowrap">
                              {quantity}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {(transbordo.destinos || []).length > 0 && (
                  <div className="border-t border-border pt-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2 uppercase">
                      {t("transbordo.validacao.fields.destinosList")}
                    </div>
                    <ul className="space-y-1 text-sm">
                      {(transbordo.destinos || []).map((d, i) => {
                        const { primary, secondary } = describeDestino(d);
                        return (
                          <li
                            key={i}
                            className="flex items-center justify-between gap-3 px-3 py-1.5 rounded bg-background border border-border"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-foreground truncate" title={primary}>
                                {primary}
                              </div>
                              {secondary && (
                                <div className="text-xs text-muted-foreground truncate" title={secondary}>
                                  {secondary}
                                </div>
                              )}
                            </div>
                            <span className="text-muted-foreground text-xs whitespace-nowrap">
                              {d.volume_total
                                ? `${formatNum(d.volume_total, 2)} L`
                                : d.peso_liquido
                                ? `${formatMass(d.peso_liquido)} kg`
                                : "-"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {transbordo.observacoes && (
                  <div className="border-t border-border pt-3 text-sm">
                    <div className="text-xs font-medium text-muted-foreground mb-1 uppercase">
                      {t("transbordo.validacao.fields.observacoes")}
                    </div>
                    <div className="text-foreground whitespace-pre-wrap">
                      {transbordo.observacoes}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Auditoria */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoField
              label={t("transbordo.validacao.fields.criadoPor")}
              value={
                validacao.criado_por_nome
                  ? `${validacao.criado_por_nome} — ${fmtDateTime(validacao.created_at)}`
                  : fmtDateTime(validacao.created_at)
              }
            />
            <InfoField
              label={t("transbordo.validacao.fields.validadoPor")}
              value={
                validacao.validado_em
                  ? validacao.validado_por_nome
                    ? `${validacao.validado_por_nome} — ${fmtDateTime(validacao.validado_em)}`
                    : fmtDateTime(validacao.validado_em)
                  : "-"
              }
            />
          </section>
        </div>

        <div className="flex justify-end pt-4">
          <Button variant="outline" onClick={onClose}>
            {t("common.close", "Fechar")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoField({ label, value }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground">{value || "-"}</div>
    </div>
  );
}

// Re-export para casos onde só o TransbordoViewDialog basta.
export { TransbordoViewDialog };
