import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const publicI18n = i18n.createInstance();

let initialized = false;

export async function initPublicI18n(): Promise<typeof publicI18n> {
  if (!initialized) {
    await publicI18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      resources: {},
    });
    const mod = await import('./en.json');
    publicI18n.addResourceBundle('en', 'translation', mod.default, true, true);
    initialized = true;
  }
  return publicI18n;
}

export default publicI18n;
