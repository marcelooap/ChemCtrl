import React from 'react';
import { useTranslation } from 'react-i18next';
import { Scale } from 'lucide-react';
import { fmtNumber } from '@/i18n/formatters';
import {
  DEFAULT_SCALE_RESOLUTION_KG,
  ajustarParaBalanca,
  deveExibirAjusteBalanca,
} from '@/lib/scaleAdjustment';

/**
 * Visual-only hint: quantity rounded to scale resolution (e.g. 2 kg steps).
 * Does not alter OP, stock, or mass-balance values.
 */
export default function ScaleAdjustmentBadge({
  quantity,
  resolutionKg = DEFAULT_SCALE_RESOLUTION_KG,
  className = '',
}) {
  const { t, i18n } = useTranslation();

  if (!deveExibirAjusteBalanca(quantity, resolutionKg)) return null;

  const adjusted = ajustarParaBalanca(quantity, resolutionKg);
  if (adjusted == null) return null;

  const formatted = fmtNumber(
    adjusted,
    { minimumFractionDigits: 0, maximumFractionDigits: 0 },
    i18n.language
  );
  const resolutionLabel = fmtNumber(
    resolutionKg,
    { minimumFractionDigits: 0, maximumFractionDigits: 0 },
    i18n.language
  );
  const ariaLabel = t('production.checklistPage.scaleAdjustmentAria', {
    resolution: resolutionLabel,
    value: formatted,
  });

  return (
    <span
      role="note"
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`inline-flex items-center gap-1 shrink-0 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 ${className}`.trim()}
    >
      <Scale className="w-3 h-3 shrink-0" aria-hidden />
      <span>
        {t('production.checklistPage.scaleAdjustmentBadge', {
          resolution: resolutionLabel,
          value: formatted,
        })}
      </span>
    </span>
  );
}
