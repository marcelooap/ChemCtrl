import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { Label } from '@shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { formatCurrency } from '@transbordo/lib/format';
import { formatTarifaRate } from '@painel/lib/faturamentoTarifas';
import {
  CAPACIDADE_ORIGEM,
  STATUS_NO_PATIO,
} from '@painel/lib/faturamentoVasilhames';
import { CAPACIDADES_NOMINAIS_PADRAO } from '@painel/lib/vasilhamesCapacidadeNominal';
import { Can } from '@industrializacao/lib/rbac/Can';

function formatDateBR(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function formatVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} L`;
}

function InfoItem({ label, value }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </p>
      <p className="text-sm text-foreground break-words">{value ?? '—'}</p>
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="text-xs font-semibold text-foreground">{children}</p>;
}

function origemCapacidadeLabel(t, origem) {
  if (origem === CAPACIDADE_ORIGEM.CADASTRADA) {
    return t('painel.faturamentoVasilhames.modal.origemCadastrada');
  }
  if (origem === CAPACIDADE_ORIGEM.HISTORICO) {
    return t('painel.faturamentoVasilhames.modal.origemHistorico');
  }
  if (origem === CAPACIDADE_ORIGEM.MANUAL) {
    return t('painel.faturamentoVasilhames.modal.origemManual');
  }
  return t('painel.faturamentoVasilhames.modal.origemNaoIdentificada');
}

export default function FaturamentoVasilhamesDetalheModal({
  row,
  open,
  onOpenChange,
  savingCapacidade = false,
  onSaveCapacidade,
}) {
  const { t } = useTranslation();
  const [capacidadeManual, setCapacidadeManual] = useState('');

  useEffect(() => {
    if (!row) {
      setCapacidadeManual('');
      return;
    }
    setCapacidadeManual(
      row.capacidadeNominal != null ? String(row.capacidadeNominal) : ''
    );
  }, [row]);

  if (!row) return null;

  const dash = t('painel.faturamentoVasilhames.table.dash');
  const segments = row.armazenagemSegments || [];
  const needsCapacidade =
    row.capacidadeOrigem === CAPACIDADE_ORIGEM.NAO_IDENTIFICADA ||
    row.capacidadeNominal == null;
  const noPatio = row.status === STATUS_NO_PATIO;

  const handleSave = async () => {
    if (!capacidadeManual) return;
    await onSaveCapacidade?.(row, Number(capacidadeManual));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('painel.faturamentoVasilhames.modal.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div>
            <SectionTitle>
              {t('painel.faturamentoVasilhames.modal.sectionGeral')}
            </SectionTitle>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem label={t('painel.faturamentoVasilhames.modal.id')} value={row.id} />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.placa')}
                value={row.placa || dash}
              />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.barril')}
                value={row.barril || dash}
              />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.codigo')}
                value={row.codigo || dash}
              />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.produto')}
                value={row.produto || dash}
              />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.cliente')}
                value={row.cliente || dash}
              />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.volumeAtual')}
                value={formatVolume(row.volumeAtual)}
              />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.origem')}
                value={row.origemRegistro || dash}
              />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.dataEnvase')}
                value={formatDateBR(row.dataEnvase)}
              />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.dataSaida')}
                value={formatDateBR(row.dataSaida)}
              />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.status')}
                value={
                  noPatio
                    ? t('painel.faturamentoVasilhames.table.noPatio')
                    : t('painel.faturamentoVasilhames.table.expedido')
                }
              />
              <InfoItem
                label={t('painel.faturamentoVasilhames.modal.qtdArmazenada')}
                value={formatVolume(row.volumeAtual)}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <SectionTitle>
              {t('painel.faturamentoVasilhames.modal.sectionCapacidade')}
            </SectionTitle>
            <InfoItem
              label={t('painel.faturamentoVasilhames.modal.capacidadeAtual')}
              value={
                row.capacidadeNominal != null
                  ? formatVolume(row.capacidadeNominal)
                  : t('painel.faturamentoVasilhames.modal.origemNaoIdentificada')
              }
            />
            <InfoItem
              label={t('painel.faturamentoVasilhames.modal.origemCapacidade')}
              value={origemCapacidadeLabel(t, row.capacidadeOrigem)}
            />

            {/* Select manual só para tanques com alerta amarelo (capacidade não identificada). */}
            {needsCapacidade ? (
              <Can permission="painel_faturamento.edit">
                <div className="space-y-2 pt-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {t('painel.faturamentoVasilhames.modal.definirCapacidade')}
                  </Label>
                  <div className="flex flex-wrap items-end gap-2">
                    <Select
                      value={capacidadeManual || undefined}
                      onValueChange={setCapacidadeManual}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue
                          placeholder={t(
                            'painel.faturamentoVasilhames.modal.selecioneCapacidade'
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {CAPACIDADES_NOMINAIS_PADRAO.map((cap) => (
                          <SelectItem key={cap} value={String(cap)}>
                            {formatVolume(cap)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      onClick={handleSave}
                      disabled={!capacidadeManual || savingCapacidade}
                    >
                      {savingCapacidade
                        ? t('painel.faturamentoVasilhames.modal.savingCapacidade')
                        : t('painel.faturamentoVasilhames.modal.saveCapacidade')}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {t('painel.faturamentoVasilhames.modal.capacidadeHint')}
                  </p>
                </div>
              </Can>
            ) : null}
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <SectionTitle>
              {t('painel.faturamentoVasilhames.modal.memoriaTitulo')}
            </SectionTitle>

            {needsCapacidade ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {t('painel.faturamentoVasilhames.modal.memoriaSemCapacidade')}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoItem
                    label={t('painel.faturamentoVasilhames.modal.capacidadeNominal')}
                    value={formatVolume(row.capacidadeNominal)}
                  />
                  <InfoItem
                    label={t('painel.faturamentoVasilhames.modal.volumeAtual')}
                    value={formatVolume(row.volumeAtual)}
                  />
                  <InfoItem
                    label={t('painel.faturamentoVasilhames.modal.dataInicial')}
                    value={formatDateBR(
                      segments[0]?.from || row.detail?.periodFrom || row.dataEnvase
                    )}
                  />
                  <InfoItem
                    label={t('painel.faturamentoVasilhames.modal.dataFinal')}
                    value={formatDateBR(
                      segments[segments.length - 1]?.toInclusive ||
                        row.detail?.periodTo ||
                        row.dataSaida
                    )}
                  />
                  <InfoItem
                    label={t('painel.faturamentoVasilhames.modal.diasFaturados')}
                    value={String(row.diasPatio ?? 0)}
                  />
                  <InfoItem
                    label={t('painel.faturamentoVasilhames.modal.valorTotal')}
                    value={formatCurrency(row.total)}
                  />
                </div>

                {segments.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">
                            {t('painel.faturamentoVasilhames.modal.periodo')}
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            {t('painel.faturamentoVasilhames.modal.dias')}
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            {t('painel.faturamentoVasilhames.modal.tarifaDiaria')}
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            {t('painel.faturamentoVasilhames.modal.vigencia')}
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            {t('painel.faturamentoVasilhames.modal.subtotal')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {segments.map((seg) => (
                          <tr
                            key={`${seg.from}-${seg.toExclusive}`}
                            className="border-t border-border"
                          >
                            <td className="px-3 py-2">
                              {formatDateBR(seg.from)} a {formatDateBR(seg.toInclusive)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{seg.days}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatTarifaRate(seg.dailyRate)}
                            </td>
                            <td className="px-3 py-2">
                              {formatDateBR(seg.vigencia_inicio)}
                              {seg.vigencia_fim
                                ? ` – ${formatDateBR(seg.vigencia_fim)}`
                                : ''}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatCurrency((seg.cents || 0) / 100)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t border-border bg-muted/30 font-semibold">
                          <td className="px-3 py-2">
                            {t('painel.faturamentoVasilhames.modal.total')}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.diasPatio}
                          </td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCurrency(row.total)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {segments.length === 1 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('painel.faturamentoVasilhames.modal.formula', {
                      days: segments[0].days,
                      rate: formatTarifaRate(segments[0].dailyRate),
                      total: formatCurrency(row.total),
                    })}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>
            {t('painel.faturamentoVasilhames.modal.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
