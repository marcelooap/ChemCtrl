import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fmtDate, fmtNumber } from '@/i18n/formatters';

const QC_STATUS_KEYS = {
  Aprovado: 'quality.fields.approved',
  Reprovado: 'quality.fields.rejected',
  'Com Restrição': 'quality.resultStatus.withRestriction',
  Pendente: 'quality.fields.pending',
};

export const formatPackagingLabel = (c) => {
  const plate = (c?.container_number || '').trim();
  const barril = (c?.barril_number || '').trim();
  if (!plate) return barril || '';
  return barril ? `${plate} - ${barril}` : plate;
};

export default function COAViewDialog({ open, onOpenChange, result, containers = [] }) {
  const { t, i18n } = useTranslation();
  const na = t('common.notAvailable');

  const translateQcStatus = useCallback((status) => {
    if (!status) return status;
    const key = QC_STATUS_KEYS[status];
    return key ? t(key) : status;
  }, [t]);

  const fmt4 = useCallback((n) => {
    if (n == null) return na;
    return fmtNumber(n, { minimumFractionDigits: 4, maximumFractionDigits: 4 }, i18n.language);
  }, [na, i18n.language]);

  const statusBadge = (s) => {
    const c = { Aprovado: 'bg-green-100 text-green-700', Reprovado: 'bg-red-100 text-red-700', 'Com Restrição': 'bg-amber-100 text-amber-700', Pendente: 'bg-muted text-foreground' };
    return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${c[s] || c.Pendente}`}>{translateQcStatus(s)}</span>;
  };

  const results = Array.isArray(result?.results) ? result.results : [];
  const packagingLabels = containers.map(formatPackagingLabel).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('quality.coaPage.viewTitle', { product: result?.product, lot: result?.lot })}</DialogTitle>
        </DialogHeader>
        {result && (
          <div className="space-y-5">
            <section>
              <h4 className="text-sm font-semibold mb-3" style={{ color: '#2A5A95' }}>{t('quality.coaPage.coaData')}</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">{t('quality.fields.product')}</p><p className="font-bold">{result.product || na}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('production.opNumber')}</p><p className="font-bold" style={{ color: '#2575D1' }}>{result.op_number || na}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('quality.fields.lot')}</p><p className="font-medium">{result.lot || na}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('quality.fields.client')}</p><p className="font-medium">{result.client || na}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('quality.coaPage.analysisDate')}</p><p className="font-medium">{result.date ? fmtDate(result.date, undefined, i18n.language) : na}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('quality.fields.analyst')}</p><p className="font-medium">{result.analyst || na}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('quality.coaPage.qcStatus')}</p><div className="mt-0.5">{statusBadge(result.status)}</div></div>
              </div>
            </section>

            <section>
              <h4 className="text-sm font-semibold mb-2" style={{ color: '#2A5A95' }}>{t('quality.coaPage.analyticalResults')}</h4>
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-muted/50 text-xs font-semibold text-muted-foreground">
                    <th className="px-3 py-2 text-left">{t('quality.ensaios.table.analysis').toUpperCase()}</th>
                    <th className="px-3 py-2 text-left">{t('quality.producoesCq.table.method')}</th>
                    <th className="px-3 py-2 text-left">{t('quality.producoesCq.table.unitShort')}</th>
                    <th className="px-3 py-2 text-right">{t('quality.fields.min').toUpperCase()}</th>
                    <th className="px-3 py-2 text-right">{t('quality.fields.max').toUpperCase()}</th>
                    <th className="px-3 py-2 text-left">{t('quality.producoesCq.table.result')}</th>
                    <th className="px-3 py-2 text-left">{t('common.status').toUpperCase()}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">{t('quality.coaPage.resultsNotRegistered')}</td></tr>
                  ) : results.map((r, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-3 py-2 font-medium">{r.analysis_name || na}</td>
                      <td className="px-3 py-2">{r.methodology || na}</td>
                      <td className="px-3 py-2">{r.unit || na}</td>
                      <td className="px-3 py-2 text-right">{r.min_limit != null ? fmt4(r.min_limit) : na}</td>
                      <td className="px-3 py-2 text-right">{r.max_limit != null ? fmt4(r.max_limit) : na}</td>
                      <td className="px-3 py-2">{r.result || na}</td>
                      <td className="px-3 py-2 text-xs">{translateQcStatus(r.status) || na}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section>
              <h4 className="text-sm font-semibold mb-2" style={{ color: '#2A5A95' }}>{t('quality.coaPage.relatedPackaging')}</h4>
              {packagingLabels.length === 0 ? (
                <p className="text-sm text-muted-foreground">{na}</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {packagingLabels.map((label) => (
                    <li key={label} className="font-medium text-foreground">{label}</li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="text-sm font-semibold mb-2" style={{ color: '#2A5A95' }}>{t('common.observations')}</h4>
              <p className="text-sm text-foreground whitespace-pre-wrap">{result.observations?.trim() || na}</p>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
