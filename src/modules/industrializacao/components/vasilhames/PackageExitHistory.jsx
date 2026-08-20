import React from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate, fmtNumber } from '@/i18n/formatters';

const STATUS_CLASS = {
  fiscal: 'bg-green-100 text-green-700',
  patio: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function PackageExitHistory({ rows = [], loading = false }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const fmt = (n, digits = 0) =>
    fmtNumber(n || 0, { minimumFractionDigits: digits, maximumFractionDigits: digits }, lang);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-4 rounded" style={{ background: '#2575D1' }} />
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
          {t('containers.vasilhames.exitHistory.title')}
        </h4>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        {t('containers.vasilhames.exitHistory.subtitle')}
      </p>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase">
              <th className="px-3 py-2 text-left">{t('containers.vasilhames.exitHistory.document')}</th>
              <th className="px-3 py-2 text-left">{t('common.date')}</th>
              <th className="px-3 py-2 text-right">{t('containers.vasilhames.exitHistory.qty')}</th>
              <th className="px-3 py-2 text-right">{t('containers.fields.volume')} (L)</th>
              <th className="px-3 py-2 text-left">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-xs">
                  {t('common.loading')}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-xs">
                  {t('containers.vasilhames.exitHistory.empty')}
                </td>
              </tr>
            ) : (
              <>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      {row.codigo || t('containers.vasilhames.exitHistory.yardExit')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.date ? fmtDate(row.date, undefined, lang) : t('common.notAvailable')}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmt(row.qty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(row.volume, 0)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS[row.status] || 'bg-muted'}`}>
                        {t(`containers.vasilhames.exitHistory.status.${row.status}`, {
                          defaultValue: row.status,
                        })}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/40">
                  <td colSpan={2} className="px-3 py-2 font-bold">
                    {t('containers.vasilhames.exitHistory.total')}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ color: '#2575D1' }}>
                    {fmt(rows.reduce((s, r) => s + (Number(r.qty) || 0), 0))}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {fmt(rows.reduce((s, r) => s + (Number(r.volume) || 0), 0), 0)}
                  </td>
                  <td />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
