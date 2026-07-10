import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, ArrowRight, Eye } from 'lucide-react';
import { fmtVolume } from '@/i18n/formatters';
import { translatePackagingType } from '@/i18n/domainMaps';
import { EtapaBadge, ProgressSegments } from './ProductionBadges';

export default function ProductionTrackingTable({ productions, onBypass, bypassing, showClient = true, showBypass = true, onViewAll, onView, maxRows = 10, highlightProdId = null }) {
  const { t, i18n } = useTranslation();
  const highlightRef = useRef(null);

  useEffect(() => {
    if (highlightProdId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightProdId, productions]);

  if (!productions || productions.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        {t('production.tracking.empty')}
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full chemctrl-table">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('production.opNumber')}</th>
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('common.product')}</th>
              {showClient && <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('common.client')}</th>}
              <th className="px-5 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('production.tracking.volume')}</th>
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('production.tracking.packaging')}</th>
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('production.tracking.stage')}</th>
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('production.tracking.progress')}</th>
              {showBypass && <th className="px-5 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('production.tracking.bypass')}</th>}
            </tr>
          </thead>
          <tbody>
            {productions.slice(0, maxRows).map(p => (
              <tr
                key={p.id}
                ref={highlightProdId === p.id ? highlightRef : undefined}
                className={`border-b border-border hover:bg-accent/30 ${highlightProdId === p.id ? 'bg-primary/10 ring-2 ring-inset ring-primary' : ''}`}
                style={{ height: '48px' }}
              >
                <td className="px-5 py-2 font-bold text-sm font-mono text-primary">{p.op_number}</td>
                <td className="px-5 py-2 text-sm text-foreground">{p.product}</td>
                {showClient && <td className="px-5 py-2 text-sm text-muted-foreground">{p.client}</td>}
                <td className="px-5 py-2 text-right font-bold text-sm text-foreground">{fmtVolume(p.volume || 0, 'L', i18n.language)}</td>
                <td className="px-5 py-2 text-sm text-foreground">{translatePackagingType(p.packaging_type)}</td>
                <td className="px-5 py-2"><EtapaBadge status={p.status} /></td>
                <td className="px-5 py-2">
                  <div className="flex items-center gap-2">
                    <ProgressSegments status={p.status} />
                    {onView && (
                      <button
                        onClick={() => onView(p)}
                        className="p-1 rounded hover:bg-accent shrink-0"
                        title={t('clients.screen.view')}
                      >
                        <Eye className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                      </button>
                    )}
                  </div>
                </td>
                {showBypass && (
                  <td className="px-5 py-2 text-center">
                    <button
                      onClick={() => onBypass?.(p)}
                      disabled={bypassing === p.id}
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded border disabled:opacity-50 transition-colors ${
                        p.bypass_qc
                          ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60'
                          : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      }`}
                    >
                      {bypassing === p.id ? <div className="w-3 h-3 border border-border border-t-current rounded-full animate-spin" /> : <Zap className="w-3 h-3" />}
                      {p.bypass_qc ? t('production.tracking.bypassActive') : t('production.tracking.bypass')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onViewAll && (
        <div className="px-5 py-3 border-t border-border">
          <button onClick={onViewAll} className="text-xs font-medium flex items-center gap-1 text-primary">
            {t('production.tracking.viewAll')} <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
