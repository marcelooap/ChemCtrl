import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { fmtNumber } from '@/i18n/formatters';

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0 gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right break-words">{value}</span>
    </div>
  );
}

export default function TankViewDialog({
  tank,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  fmt,
}) {
  const { t, i18n } = useTranslation();
  const na = t('common.notAvailable');
  const format = fmt || ((n) => fmtNumber(n || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, i18n.language));

  const capacity = tank?.capacity || 26000;
  const volume = tank?.current_volume || 0;
  const fillPercent = Math.min(100, (volume / capacity) * 100);
  const products = (tank?.computed_products || []).filter(Boolean);
  const productLabel = products.length > 0
    ? products.join(', ')
    : (tank?.latest_product || na);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('containers.tankagePage.viewDialog.title')}</DialogTitle>
        </DialogHeader>

        {tank && (
          <div className="space-y-5">
            <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t('containers.tankagePage.table.tank')}
              </p>
              <p className="text-xl font-bold mt-0.5" style={{ color: '#2575D1' }}>{tank.name || na}</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                  {t('containers.tankagePage.viewDialog.details')}
                </h4>
              </div>
              <div className="grid gap-y-3 text-sm bg-muted/50 rounded-lg p-4">
                <InfoRow label={t('containers.fields.client')} value={tank.client || na} />
                <InfoRow label={t('containers.tankagePage.table.products')} value={productLabel} />
                <InfoRow label={t('quality.fields.lot')} value={tank.computed_lot || na} />
                <InfoRow
                  label={t('containers.tankagePage.table.currentVolume')}
                  value={`${format(volume)} L`}
                />
                <InfoRow
                  label={t('containers.tankagePage.table.capacity')}
                  value={`${format(capacity)} L`}
                />
                <InfoRow
                  label={t('containers.tankagePage.table.occupancy')}
                  value={`${fillPercent.toFixed(1)}%`}
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t">
          <div className="flex items-center gap-1">
            {tank && onEdit && (
              <Button variant="outline" size="sm" onClick={() => onEdit(tank)} className="gap-1.5">
                <Pencil className="w-3.5 h-3.5" /> {t('buttons.edit')}
              </Button>
            )}
            {tank && onDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(tank)}
                className="gap-1.5 text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-3.5 h-3.5" /> {t('buttons.delete')}
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('buttons.close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
