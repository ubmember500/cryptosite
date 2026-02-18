import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const LANG_KEY = 'crypto-alerts-lang';

export const useLanguageStore = create(
  persist(
    (set) => ({
      language: 'en', // 'en' | 'ru'
      setLanguage: (lang) => set({ language: lang }),
    }),
    { name: LANG_KEY }
  )
);
