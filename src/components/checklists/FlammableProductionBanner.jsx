import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Flame } from 'lucide-react';

/**
 * Banner permanente para OPs de produto inflamável (necessita_n2).
 * Sem botão de fechar — permanece durante toda a produção.
 */
export default function FlammableProductionBanner() {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className="mb-6 w-full rounded-xl border-2 border-amber-500 bg-amber-50 px-4 py-3.5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-200">
          <AlertTriangle className="h-5 w-5 text-amber-800" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-red-600" aria-hidden />
            <p className="text-sm font-bold uppercase tracking-wide text-amber-950">
              {t('production.operationalChecklist.banner.title')}
            </p>
          </div>
          <p className="mt-1.5 text-xs font-medium text-amber-900">
            {t('production.operationalChecklist.banner.intro')}
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs font-semibold text-amber-950">
            <li>{t('production.operationalChecklist.banner.itemN2')}</li>
            <li>{t('production.operationalChecklist.banner.itemO2')}</li>
            <li>{t('production.operationalChecklist.banner.itemGrounding')}</li>
            <li>{t('production.operationalChecklist.banner.itemMaintain')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
