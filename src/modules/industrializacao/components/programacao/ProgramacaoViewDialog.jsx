import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { fmtDate, fmtVolume } from '@/i18n/formatters';

export default function ProgramacaoViewDialog({
  open,
  onOpenChange,
  items = [],
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}) {
  const { t } = useTranslation();
  const rows = (items || []).filter(Boolean);
  const dateValue = rows[0]?.scheduled_date ? fmtDate(rows[0].scheduled_date) : '—';
  const totalVolume = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.volume) || 0), 0),
    [rows]
  );
  const showActions = canEdit || canDelete;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('programming.view.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">{dateValue}</p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
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
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2.5 font-medium text-foreground">{row.product || '—'}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.client || '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">
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
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/40">
                <td
                  colSpan={2}
                  className="px-3 py-2.5 text-sm font-semibold text-foreground"
                >
                  {t('programming.view.total')}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-sm font-semibold text-foreground">
                  {fmtVolume(totalVolume)}
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
