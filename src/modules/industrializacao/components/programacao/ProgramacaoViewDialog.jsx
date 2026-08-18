import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { fmtDate, fmtVolume } from '@/i18n/formatters';
import ProducedToggle from '@industrializacao/components/programacao/ProducedToggle';
import { getDayProgress, isScheduleProduced } from '@industrializacao/lib/programacaoStatus';

export default function ProgramacaoViewDialog({
  open,
  onOpenChange,
  items = [],
  dismissible = true,
  canEdit,
  canDelete,
  canMarkProduced,
  togglingIds,
  onToggleProduced,
  onEdit,
  onDelete,
}) {
  const { t } = useTranslation();
  const rows = (items || []).filter(Boolean);
  const dateValue = rows[0]?.scheduled_date ? fmtDate(rows[0].scheduled_date) : '—';
  const progress = useMemo(() => getDayProgress(rows), [rows]);
  const showActions = canEdit || canDelete;
  const busyIds = togglingIds instanceof Set ? togglingIds : new Set();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !dismissible) return;
        onOpenChange?.(next);
      }}
    >
      <DialogContent
        className="max-w-2xl"
        onPointerDownOutside={(e) => { if (!dismissible) e.preventDefault(); }}
        onFocusOutside={(e) => { if (!dismissible) e.preventDefault(); }}
        onInteractOutside={(e) => { if (!dismissible) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{t('programming.view.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">{dateValue}</p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="w-10 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="sr-only">{t('programming.view.produced')}</span>
                </th>
                <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('programming.form.product')}
                </th>
                <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('programming.form.client')}
                </th>
                <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-right">
                  {t('programming.form.volume')}
                </th>
                {showActions ? (
                  <th className="px-3 py-2 w-20 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-right">
                    {t('common.actions')}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const produced = isScheduleProduced(row);
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-border last:border-b-0 ${
                      produced ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''
                    }`}
                  >
                    <td className="px-1 py-1.5">
                      <ProducedToggle
                        produced={produced}
                        disabled={!canMarkProduced}
                        busy={busyIds.has(row.id)}
                        label={
                          produced
                            ? t('programming.markPending', { product: row.product })
                            : t('programming.markProduced', { product: row.product })
                        }
                        onToggle={() => onToggleProduced?.(row)}
                      />
                    </td>
                    <td className={`px-3 py-2.5 font-medium ${produced ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {row.product || '—'}
                    </td>
                    <td className={`px-3 py-2.5 ${produced ? 'text-muted-foreground/80' : 'text-muted-foreground'}`}>
                      {row.client || '—'}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${produced ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {fmtVolume(row.volume)}
                    </td>
                    {showActions ? (
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-end">
                          {canEdit ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title={t('buttons.edit')}
                              aria-label={t('buttons.edit')}
                              onClick={() => onEdit?.(row)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          ) : null}
                          {canDelete ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-red-600"
                              title={t('buttons.delete')}
                              aria-label={t('buttons.delete')}
                              onClick={() => onDelete?.(row)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/40">
                <td
                  colSpan={3}
                  className="px-3 py-2.5 text-sm font-semibold text-foreground"
                >
                  {t('programming.view.remaining')}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-sm font-semibold text-foreground">
                  {fmtVolume(progress.remainingVolume)}
                </td>
                {showActions ? <td /> : null}
              </tr>
              <tr className="bg-muted/20">
                <td
                  colSpan={3}
                  className="px-3 py-2 text-xs font-medium text-muted-foreground"
                >
                  {t('programming.view.total')}
                  {progress.producedCount > 0
                    ? ` · ${t('programming.view.producedCount', { count: progress.producedCount, total: progress.totalCount })}`
                    : ''}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs font-medium text-muted-foreground">
                  {fmtVolume(progress.totalVolume)}
                </td>
                {showActions ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
