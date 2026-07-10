import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const STORAGE_KEY = 'chemctrl-locale';
export const DEFAULT_LOCALE = 'pt-BR';

export const SUPPORTED_LANGUAGES = ['pt-BR', 'en', 'es', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLocale, string> = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
  es: 'Español',
  fr: 'Français',
};

export const LANGUAGE_FLAGS: Record<SupportedLocale, string> = {
  'pt-BR': '🇧🇷',
  en: '🇺🇸',
  es: '🇪🇸',
  fr: '🇫🇷',
};

const localeLoaders: Record<SupportedLocale, () => Promise<{ default: object }>> = {
  'pt-BR': () => import('./pt-BR.json'),
  en: () => import('./en.json'),
  es: () => import('./es.json'),
  fr: () => import('./fr.json'),
};

const loadedLocales = new Set<string>();

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return SUPPORTED_LANGUAGES.includes(value as SupportedLocale);
}

export async function loadLocale(locale: SupportedLocale): Promise<void> {
  if (loadedLocales.has(locale)) return;
  const mod = await localeLoaders[locale]();
  i18n.addResourceBundle(locale, 'translation', mod.default, true, true);
  loadedLocales.add(locale);
}

export async function applyLanguage(locale: SupportedLocale): Promise<void> {
  await loadLocale(locale);
  await i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  localStorage.setItem(STORAGE_KEY, locale);
}

export function resolveInitialLocale(storedPreference?: string | null): SupportedLocale {
  if (isSupportedLocale(storedPreference)) return storedPreference;
  const fromStorage = localStorage.getItem(STORAGE_KEY);
  if (isSupportedLocale(fromStorage)) return fromStorage;
  return DEFAULT_LOCALE;
}

export async function initI18n(preferredLocale?: string | null): Promise<typeof i18n> {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: DEFAULT_LOCALE,
      fallbackLng: DEFAULT_LOCALE,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      resources: {},
    });
  }

  const locale = resolveInitialLocale(preferredLocale);
  await applyLanguage(locale);
  return i18n;
}

export default i18n;
