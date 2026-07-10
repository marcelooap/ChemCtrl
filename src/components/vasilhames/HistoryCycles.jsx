import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown } from 'lucide-react';
import CycleCard from './CycleCard';

export default function HistoryCycles({ cycles }) {
  const { t } = useTranslation();

  if (!cycles || cycles.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        {t('containers.historyCycles.empty')}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="text-sm text-muted-foreground mb-3">
        {t('containers.historyCycles.count', { count: cycles.length })}
      </div>
      {cycles.map((cycle, i) => (
        <React.Fragment key={cycle.containerId + '-' + i}>
          <CycleCard cycle={cycle} index={i} />
          {i < cycles.length - 1 && (
            <div className="flex justify-center py-1.5">
              <ArrowDown className="w-5 h-5 text-muted-foreground" />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
