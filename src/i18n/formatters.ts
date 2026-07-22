import i18n from './index';
import { formatDistanceToNow } from 'date-fns';
import { ptBR, enUS, es, fr } from 'date-fns/locale';

const INTL_LOCALE_MAP: Record<string, string> = {
  'pt-BR': 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
};

const DATE_FNS_LOCALE_MAP: Record<string, Locale> = {
  'pt-BR': ptBR,
  en: enUS,
  es,
  fr,
};

type Locale = typeof ptBR;

export function getIntlLocale(language?: string): string {
  const lang = language || i18n.language || 'pt-BR';
  return INTL_LOCALE_MAP[lang] || 'pt-BR';
}

export function getDateFnsLocale(language?: string): Locale {
  const lang = language || i18n.language || 'pt-BR';
  return DATE_FNS_LOCALE_MAP[lang] || ptBR;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'string') {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const [, y, m, d] = dateOnly;
      const local = new Date(Number(y), Number(m) - 1, Number(d));
      return Number.isNaN(local.getTime()) ? null : local;
    }
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Calendar dates (date inputs / date-only fields) are often persisted as
 * timestamptz at UTC midnight (e.g. `2026-07-22T00:00:00.000Z`). In Brazil
 * that instant is still the previous local day — use the UTC Y-M-D as the
 * intended calendar day for date-only display.
 */
function toCalendarDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null || value === '') return null;

  if (typeof value === 'string') {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const [, y, m, d] = dateOnly;
      const local = new Date(Number(y), Number(m) - 1, Number(d));
      return Number.isNaN(local.getTime()) ? null : local;
    }

    const utcMidnight = value.match(
      /^(\d{4})-(\d{2})-(\d{2})[T ]00:00:00(?:\.\d+)?(?:Z|[+-]00:00)?$/i
    );
    if (utcMidnight) {
      const [, y, m, d] = utcMidnight;
      const local = new Date(Number(y), Number(m) - 1, Number(d));
      return Number.isNaN(local.getTime()) ? null : local;
    }
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    if (
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0
    ) {
      return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
    }
    return value;
  }

  return toDate(value);
}

export function fmtDate(
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  language?: string
): string {
  const d = toCalendarDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(getIntlLocale(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...options,
  });
}

export function fmtDateTime(
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  language?: string
): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString(getIntlLocale(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  });
}

export function fmtNumber(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions,
  language?: string
): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString(getIntlLocale(language), options);
}

export function fmtCurrency(
  value: number | string | null | undefined,
  currency = 'BRL',
  language?: string,
  options?: Intl.NumberFormatOptions
): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString(getIntlLocale(language), {
    style: 'currency',
    currency,
    ...options,
  });
}

export function fmtPercent(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions,
  language?: string
): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return '—';
  const normalized = Math.abs(n) <= 1 && n !== 0 ? n : n / 100;
  return normalized.toLocaleString(getIntlLocale(language), {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...options,
  });
}

export function fmtMass(
  value: number | string | null | undefined,
  unit = 'kg',
  language?: string
): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return '—';
  return `${fmtNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 3 }, language)} ${unit}`;
}

export function fmtVolume(
  value: number | string | null | undefined,
  unit = 'L',
  language?: string
): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return '—';
  return `${fmtNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 3 }, language)} ${unit}`;
}

export function fmtRelativeTime(
  value: Date | string | number | null | undefined,
  language?: string
): string {
  const d = toDate(value);
  if (!d) return '—';
  return formatDistanceToNow(d, { addSuffix: true, locale: getDateFnsLocale(language) });
}

export function parseLocaleNumber(value: string, language?: string): number {
  if (!value || typeof value !== 'string') return NaN;
  const locale = getIntlLocale(language);
  const trimmed = value.trim();
  if (!trimmed) return NaN;

  if (locale.startsWith('pt') || locale.startsWith('es') || locale.startsWith('fr')) {
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    return Number(normalized);
  }

  const normalized = trimmed.replace(/,/g, '');
  return Number(normalized);
}
