import React from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';
import { generateBoletaPDF } from '@/lib/pdfReports';
import { fmtDate, fmtVolume, fmtMass } from '@/i18n/formatters';
import { translateContainerStatus, translatePackagingType } from '@/i18n/domainMaps';

const fmtRegId = (n) => n != null ? String(n).padStart(2, '0') : '—';

const statusBadgeClass = (s) => {
  const c = { 'No Pátio': 'bg-amber-100 text-amber-700', 'Expedido': 'bg-green-100 text-green-700' };
  return c[s] || 'bg-muted';
};

export default function ContainerViewDialog({
  container,
  open,
  onOpenChange,
  readOnly = false,
  productions = [],
  recipes = [],
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const statusBadge = (s) => (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadgeClass(s)}`}>
      {translateContainerStatus(s)}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('containers.viewDialog.title')}</DialogTitle></DialogHeader>
        {container && (
          <div className="space-y-5">
            <div className="flex items-center gap-4 p-4 rounded-lg bg-blue-50">
              <div className="flex-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('containers.fields.plateNumber')}</p>
                <p className="text-lg font-bold mt-0.5">{container.container_number || '—'}</p>
              </div>
              <div className="w-px h-12 bg-border" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('containers.fields.barrelNumber')}</p>
                <p className="text-lg font-bold mt-0.5">{container.barril_number || '—'}</p>
              </div>
              <div className="w-px h-12 bg-border" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('containers.fields.registrationId')}</p>
                <p className="text-lg font-bold mt-0.5 text-primary">{fmtRegId(container.registration_id)}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{t('containers.viewDialog.opData')}</h4>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-muted/50/50 rounded-lg p-4">
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('production.opNumber')}</span><span className="font-bold" style={{ color: '#2575D1' }}>{container.op_number || '—'}</span></div>
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('common.lot')}</span><span className="font-medium">{container.lot || '—'}</span></div>
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('common.product')}</span><span className="font-bold text-right">{container.product || '—'}</span></div>
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('common.client')}</span><span className="font-medium text-right">{container.client || '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('common.status')}</span>{statusBadge(container.status)}</div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('containers.viewDialog.departureDate')}</span><span className="font-medium">{fmtDate(container.departure_date, undefined, lang)}</span></div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{t('containers.viewDialog.packagingData')}</h4>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('packaging.fields.type')}</p><p className="font-bold">{container.type ? translatePackagingType(container.type) : '—'}</p></div>
                <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('production.packaging.volume')}</p><p className="font-bold text-base" style={{ color: '#2575D1' }}>{fmtVolume(container.volume, 'L', lang)}</p></div>
                <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('containers.vasilhames.tare')}</p><p className="font-medium">{fmtMass(container.tare, 'kg', lang)}</p></div>
                <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('production.packaging.netWeight')}</p><p className="font-bold text-base text-green-700">{fmtMass(container.net_weight, 'kg', lang)}</p></div>
                <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('production.packaging.grossWeight')}</p><p className="font-bold text-base">{fmtMass(container.gross_weight, 'kg', lang)}</p></div>
                {container.min_test_date && <div className="bg-muted/50/50 rounded-lg p-3"><p className="text-xs text-muted-foreground mb-1">{t('containers.viewDialog.minTest')}</p><p className="font-medium">{fmtDate(container.min_test_date, undefined, lang)}</p></div>}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{t('containers.viewDialog.logistics')}</h4>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-muted/50/50 rounded-lg! p-4">
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('packaging.fields.seals')}</span><span className="font-medium text-right">{container.seals || '—'}</span></div>
                <div className="flex items-center justify-between border-b border-border pb-2"><span className="text-muted-foreground">{t('containers.vasilhames.sling')}</span><span className="font-medium">{container.sling || '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('containers.vasilhames.gps')}</span><span className="font-medium">{container.gps || '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('containers.viewDialog.responsible')}</span><span className="font-medium">{container.operator || '—'}</span></div>
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-between mt-4 pt-4 border-t">
          {!readOnly && container && (
            <Button variant="outline" onClick={() => generateBoletaPDF(container, productions, recipes)} className="gap-2">
              <FileText className="w-4 h-4" /> {t('containers.actions.generateBoleta')}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('buttons.close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
