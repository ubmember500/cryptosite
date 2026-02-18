import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';

const LANG_STORAGE_KEY = 'crypto-alerts-lang';

function getStoredLanguage() {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    if (!raw) return 'en';
    const data = JSON.parse(raw);
    const lang = data?.state?.language ?? data?.language;
    return lang === 'ru' ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
  },
  lng: getStoredLanguage(),
  fallbackLng: 'en',
  keySeparator: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
