import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { formatCurrency } from '@transbordo/lib/format';
import { formatTarifaRate } from '@painel/lib/faturamentoTarifas';
import {
  ORIGEM_ENTRADA,
  ORIGEM_ESTOQUE,
  fromCents,
} from '@painel/lib/faturamentoEmbalados';

function formatDateBR(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
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

export default function FaturamentoDetalheModal({ row, open, onOpenChange }) {
  const { t } = useTranslation();
  if (!row) return null;

  const isEntrada = row.origem === ORIGEM_ENTRADA;
  const isEstoque = row.origem === ORIGEM_ESTOQUE;
  const dash = t('painel.faturamento.table.dash');
  const segments = row.armazenagemSegments || row.detail?.armazenagemSegments || [];
  const detail = row.detail || {};
  const saidas = detail.saidas || [];

  const title = isEstoque
    ? t('painel.faturamento.modal.titleEstoque')
    : isEntrada
      ? t('painel.faturamento.modal.titleEntrada')
      : t('painel.faturamento.modal.titleSaida');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          <InfoItem label={t('painel.faturamento.modal.id')} value={row.id} />
          <InfoItem
            label={
              isEstoque
                ? t('painel.faturamento.modal.dataApuracao')
                : isEntrada
                  ? t('painel.faturamento.modal.dataEntrada')
                  : t('painel.faturamento.modal.dataCarregamento')
            }
            value={formatDateBR(row.data)}
          />
          <InfoItem label={t('painel.faturamento.modal.cliente')} value={row.cliente} />
          <InfoItem label={t('painel.faturamento.modal.codigo')} value={row.codigo} />
          <InfoItem label={t('painel.faturamento.modal.produto')} value={row.produto} />
          <InfoItem label={t('painel.faturamento.modal.lote')} value={row.lote} />
          <InfoItem label={t('painel.faturamento.modal.local')} value={row.local || dash} />

          {isEntrada ? (
            <>
              <InfoItem
                label={t('painel.faturamento.modal.quantidadeRecebida')}
                value={
                  row.quantidadeRecebida != null ? String(row.quantidadeRecebida) : dash
                }
              />
              <InfoItem
                label={t('painel.faturamento.modal.qtdPaletes')}
                value={row.paletes != null ? String(row.paletes) : dash}
              />
            </>
          ) : null}

          {!isEntrada && !isEstoque ? (
            <>
              <InfoItem
                label={t('painel.faturamento.modal.embalagens')}
                value={row.embalagens != null ? String(row.embalagens) : dash}
              />
              <InfoItem
                label={t('painel.faturamento.modal.capacidade')}
                value={row.capacidade != null ? String(row.capacidade) : dash}
              />
              <InfoItem
                label={t('painel.faturamento.modal.paletesCalc')}
                value={
                  row.paletesMovimentacao != null || row.paletes != null
                    ? String(row.paletesMovimentacao ?? row.paletes)
                    : dash
                }
              />
            </>
          ) : null}

          {!isEstoque ? (
            <>
              <InfoItem
                label={t('painel.faturamento.modal.valorUnitarioMov')}
                value={
                  row.valorUnitarioMov != null
                    ? formatTarifaRate(row.valorUnitarioMov)
                    : dash
                }
              />
              <InfoItem
                label={t('painel.faturamento.modal.valorTotalMov')}
                value={row.movimentacao != null ? formatCurrency(row.movimentacao) : dash}
              />
            </>
          ) : null}

          <InfoItem
            label={t('painel.faturamento.modal.diasArmazenagem')}
            value={row.armazenagemDays != null ? String(row.armazenagemDays) : dash}
          />
          <InfoItem
            label={t('painel.faturamento.modal.valorDiario')}
            value={row.valorDiario != null ? formatTarifaRate(row.valorDiario) : dash}
          />
          <InfoItem
            label={t('painel.faturamento.modal.valorArmazenagem')}
            value={row.armazenagem != null ? formatCurrency(row.armazenagem) : dash}
          />
          <InfoItem
            label={t('painel.faturamento.modal.valorTotal')}
            value={row.total != null ? formatCurrency(row.total) : dash}
          />
        </div>

        {isEstoque ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
            <SectionTitle>
              {t('painel.faturamento.modal.composicaoTitle')}
            </SectionTitle>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('painel.faturamento.modal.saldoEntrada')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('painel.faturamento.modal.saldoEntradaDetail', {
                  paletes: detail.qtdPaletesEntrada ?? dash,
                  date: formatDateBR(detail.dataEntrada),
                })}
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('painel.faturamento.modal.saldoSaida')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('painel.faturamento.modal.saldoSaidaTotal', {
                  paletes: detail.paletesSaida ?? 0,
                })}
              </p>
              {saidas.length > 0 ? (
                <ul className="space-y-1 pl-1">
                  {saidas.map((s, idx) => (
                    <li
                      key={`${s.data}-${s.saidaId || idx}`}
                      className="text-xs text-muted-foreground"
                    >
                      {t('painel.faturamento.modal.saldoSaidaItem', {
                        paletes: s.paletes,
                        date: formatDateBR(s.data),
                        id: s.saidaId || dash,
                      })}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('painel.faturamento.modal.saldoSaidaEmpty')}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('painel.faturamento.modal.saldoRemanescente')}
              </p>
              <p className="text-xs text-foreground font-medium">
                {t('painel.faturamento.modal.saldoRemanescenteDetail', {
                  paletes: detail.paletesRemanescentes ?? row.paletes ?? dash,
                })}
              </p>
            </div>

            <div className="space-y-1.5 border-t border-border pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('painel.faturamento.modal.memoriaCalculo')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <InfoItem
                  label={t('painel.faturamento.modal.periodoApuracao')}
                  value={`${formatDateBR(detail.periodFrom)} → ${formatDateBR(detail.periodTo)}`}
                />
                <InfoItem
                  label={t('painel.faturamento.modal.local')}
                  value={row.local || dash}
                />
                <InfoItem
                  label={t('painel.faturamento.modal.valorDiario')}
                  value={
                    row.valorDiario != null ? formatTarifaRate(row.valorDiario) : dash
                  }
                />
                <InfoItem
                  label={t('painel.faturamento.modal.qtdPaletes')}
                  value={
                    detail.paletesRemanescentes != null
                      ? String(detail.paletesRemanescentes)
                      : dash
                  }
                />
                <InfoItem
                  label={t('painel.faturamento.modal.diasArmazenagem')}
                  value={
                    row.armazenagemDays != null ? String(row.armazenagemDays) : dash
                  }
                />
                <InfoItem
                  label={t('painel.faturamento.modal.valorArmazenagem')}
                  value={
                    row.armazenagem != null ? formatCurrency(row.armazenagem) : dash
                  }
                />
              </div>
              {segments.length > 0 ? (
                <ul className="space-y-1 pt-1">
                  {segments.map((seg, idx) => (
                    <li
                      key={`${seg.from}-${idx}`}
                      className="text-xs text-muted-foreground"
                    >
                      {t('painel.faturamento.modal.segment', {
                        paletes: seg.paletes,
                        days: seg.days,
                        rate: formatTarifaRate(seg.dailyRate),
                        total: formatCurrency(fromCents(seg.cents)),
                      })}{' '}
                      <span className="opacity-70">
                        ({formatDateBR(seg.from)} →{' '}
                        {formatDateBR(seg.toInclusive || seg.toExclusive)})
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <SectionTitle>{t('painel.faturamento.modal.breakdown')}</SectionTitle>
            {row.movimentacao != null ? (
              <p className="text-xs text-muted-foreground">
                {isEntrada
                  ? t('painel.faturamento.modal.formulaMovEntrada', {
                      paletes: row.paletes ?? '—',
                      rate: formatTarifaRate(row.valorUnitarioMov),
                      total: formatCurrency(row.movimentacao),
                    })
                  : t('painel.faturamento.modal.formulaMovSaida', {
                      embalagens: row.embalagens ?? '—',
                      capacidade: row.capacidade ?? '—',
                      paletes: row.paletesMovimentacao ?? row.paletes ?? '—',
                      rate: formatTarifaRate(row.valorUnitarioMov),
                      total: formatCurrency(row.movimentacao),
                    })}
              </p>
            ) : null}
            {segments.length > 0 ? (
              <ul className="space-y-1">
                {segments.map((seg, idx) => (
                  <li
                    key={`${seg.from}-${idx}`}
                    className="text-xs text-muted-foreground"
                  >
                    {t('painel.faturamento.modal.segment', {
                      paletes: seg.paletes,
                      days: seg.days,
                      rate: formatTarifaRate(seg.dailyRate),
                      total: formatCurrency(fromCents(seg.cents)),
                    })}{' '}
                    <span className="opacity-70">
                      ({formatDateBR(seg.from)} →{' '}
                      {formatDateBR(seg.toInclusive || seg.toExclusive)})
                    </span>
                  </li>
                ))}
              </ul>
            ) : row.armazenagem == null ? (
              <p className="text-xs text-muted-foreground">{dash}</p>
            ) : null}
          </div>
        )}

        {(row.pendencias || []).length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-950/30 dark:border-amber-900 p-3 space-y-1">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
              {t('painel.faturamento.modal.pendencias')}
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              {row.pendencias.map((p) => (
                <li key={p} className="text-xs text-amber-800 dark:text-amber-200">
                  {t(`painel.faturamento.modal.pendencia.${p}`, { defaultValue: p })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>
            {t('painel.faturamento.modal.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
