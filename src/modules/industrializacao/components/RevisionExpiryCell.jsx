import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { todayDateInputValue } from '@/i18n/formatters';
import { revisionExpiryDaysRemaining, revisionExpiryTone } from '@industrializacao/lib/revisionExpiry';

let todayYmd = todayDateInputValue();
const todayListeners = new Set();
let todayTimer = null;

function syncToday() {
  const next = todayDateInputValue();
  if (next === todayYmd) return;
  todayYmd = next;
  todayListeners.forEach((listener) => listener(todayYmd));
}

function subscribeToday(listener) {
  syncToday();
  todayListeners.add(listener);
  listener(todayYmd);
  if (!todayTimer) todayTimer = setInterval(syncToday, 60_000);
  return () => {
    todayListeners.delete(listener);
    if (todayListeners.size === 0 && todayTimer) {
      clearInterval(todayTimer);
      todayTimer = null;
    }
  };
}

function useTodayYmd() {
  const [today, setToday] = useState(todayYmd);
  useEffect(() => subscribeToday(setToday), []);
  return today;
}

const TONE_CLASS = {
  ok: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

export default function RevisionExpiryCell({ revisionDate, onRenew }) {
  const { t } = useTranslation();
  const today = useTodayYmd();
  const days = revisionExpiryDaysRemaining(revisionDate, today);
  const tone = revisionExpiryTone(days);
  const label = days == null
    ? t('common.notAvailable')
    : t('common.revisionExpiry.days', { days });
  const expiredHint = tone === 'expired' ? t('common.revisionExpiry.expired') : undefined;

  return (
    <div className="inline-flex items-center gap-1.5">
      {tone === 'unknown' ? (
        <span className="text-sm text-muted-foreground">{label}</span>
      ) : (
        <span
          className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${TONE_CLASS[tone]}`}
          title={expiredHint ? `${label} · ${expiredHint}` : label}
          aria-label={expiredHint ? `${label}. ${expiredHint}` : label}
        >
          {label}
        </span>
      )}
      {onRenew && (
        <button
          type="button"
          onClick={onRenew}
          title={t('common.revisionExpiry.renew')}
          aria-label={t('common.revisionExpiry.renew')}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-green-700 hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600/40 dark:text-green-300 dark:hover:bg-green-900/40"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
