import React from 'react';
import { useTranslation } from 'react-i18next';
import { isComplementPending } from '@/lib/fractionalSupply';

export default function FractionalBadge({ production, variant = 'pending' }) {
  const { t } = useTranslation();
  if (!production?.fractional_supply) return null;

  const pending = isComplementPending(production);
  if (variant === 'container' && !pending) return null;
  if (variant === 'pending' && !pending) return null;

  const label =
    variant === 'container'
      ? t('production.fractional.badgeContainer')
      : pending
        ? t('production.fractional.badgePending')
        : t('production.fractional.badge');

  const cls =
    variant === 'container'
      ? 'text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground ml-1'
      : 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700';

  return <span className={cls}>{label}</span>;
}
