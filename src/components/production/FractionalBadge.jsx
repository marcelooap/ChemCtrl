import React from 'react';
import { useTranslation } from 'react-i18next';
import { isComplementPending, isContainerFractional } from '@/lib/fractionalSupply';

export default function FractionalBadge({
  production,
  container,
  transfers,
  variant = 'pending',
  className = '',
}) {
  const { t } = useTranslation();
  const pending = isComplementPending(production);

  if (variant === 'container') {
    if (!isContainerFractional(container, production, transfers)) return null;
    return (
      <span
        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground ${className}`.trim()}
      >
        {t('production.fractional.badgeContainer')}
      </span>
    );
  }

  if (!pending) return null;

  const label = pending
    ? t('production.fractional.badgePending')
    : t('production.fractional.badge');

  return (
    <span
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 ${className}`.trim()}
    >
      {label}
    </span>
  );
}
