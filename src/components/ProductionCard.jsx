import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, MapPin, Calendar, Package, Clock } from 'lucide-react';
import { brasiliaDate, waitInterval } from '@/lib/brasilTime';
import { fmtMass, fmtVolume } from '@/i18n/formatters';
import { translateProductionStatus, translatePriority, translatePackagingType } from '@/i18n/domainMaps';

const statusConfig = {
  'Aguardando Início': { pill: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', step: 0 },
  'Em Produção': { pill: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300', step: 1 },
  'Qualidade': { pill: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300', step: 2 },
  'Envase': { pill: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300', step: 3 },
  'Finalizado': { pill: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300', step: 4 },
  'Cancelado': { pill: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300', step: 0 },
};

const priorityColors = {
  Baixa: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  Média: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  Alta: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

export default function ProductionCard({ prod, onView, children }) {
  const { t, i18n } = useTranslation();
  const cfg = statusConfig[prod.status] || statusConfig['Aguardando Início'];
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden relative">
      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary" />
      <div className="px-4 py-3 flex items-center justify-between border-b border-border ml-1.5">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-primary">{prod.op_number}</span>
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${priorityColors[prod.priority] || priorityColors['Média']}`}>{translatePriority(prod.priority)}</span>
        </div>
        <div className="flex items-center gap-2">
          {onView && (
            <button onClick={() => onView(prod)} className="text-muted-foreground hover:text-primary transition-colors" title={t('production.card.view')}>
              <Eye className="w-4 h-4" />
            </button>
          )}
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.pill}`}>{translateProductionStatus(prod.status)}</span>
        </div>
      </div>
      <div className="px-4 py-3 ml-1.5">
        <h4 className="font-semibold text-sm mb-0.5 text-foreground">{prod.product}</h4>
        <p className="text-xs mb-3 text-muted-foreground">{prod.client}</p>
        <div className="flex items-center gap-4 text-xs mb-2 text-muted-foreground">
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {t('production.card.lot')}: {prod.lot}</span>
          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {brasiliaDate(prod.date)}</span>
        </div>
        <div className="flex items-center gap-1 text-xs mb-2 text-muted-foreground">
          <Clock className="w-3 h-3" /> {t('production.card.waitingStart')} <strong className="text-foreground">{waitInterval(prod.created_date, prod.start_time)}</strong>
        </div>
        <div className="flex items-center gap-4 text-xs mb-2 text-muted-foreground">
          <span>{t('production.card.volume')}: <strong className="text-foreground">{fmtVolume(prod.volume, 'L', i18n.language)}</strong></span>
          <span>{t('production.card.mass')}: <strong className="text-foreground">{fmtMass(prod.mass, 'kg', i18n.language)}</strong></span>
        </div>
        {prod.packaging_type && (
          <div className="flex items-center gap-1 text-xs mb-3 text-muted-foreground">
            <Package className="w-3 h-3" /> {t('production.card.packaging')}: {translatePackagingType(prod.packaging_type)}
          </div>
        )}
        <div className="flex gap-1 mb-3 mt-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`h-1.5 flex-1 rounded-full ${i < cfg.step ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
