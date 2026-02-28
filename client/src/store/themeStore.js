import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  DEFAULT_THEME_ID,
  DARK_THEME_IDS,
  LIGHT_THEME_IDS,
  THEME_IDS,
  isDarkTheme,
  isValidTheme,
} from '../config/themes';

const THEME_KEY = 'app-theme';

const normalizeTheme = (themeId) => {
  if (themeId === 'dark') return DEFAULT_DARK_THEME_ID;
  if (themeId === 'light') return DEFAULT_LIGHT_THEME_ID;
  if (!isValidTheme(themeId)) return DEFAULT_THEME_ID;
  return themeId;
};

const sanitizeCategoryTheme = (themeId, categoryIds, fallbackId) => {
  const normalized = normalizeTheme(themeId);
  return categoryIds.includes(normalized) ? normalized : fallbackId;
};

const computeNextTheme = (themeId) => {
  const currentIndex = THEME_IDS.indexOf(themeId);
  if (currentIndex === -1) {
    return THEME_IDS[0] || DEFAULT_THEME_ID;
  }
  const nextIndex = (currentIndex + 1) % THEME_IDS.length;
  return THEME_IDS[nextIndex];
};

export const useThemeStore = create(
  persist(
    (set) => ({
      theme: DEFAULT_THEME_ID,
      lastDarkTheme: DEFAULT_DARK_THEME_ID,
      lastLightTheme: DEFAULT_LIGHT_THEME_ID,
      setTheme: (themeId) =>
        set((state) => {
          const normalized = normalizeTheme(themeId);
          if (isDarkTheme(normalized)) {
            return {
              theme: normalized,
              lastDarkTheme: normalized,
            };
          }
          return {
            theme: normalized,
            lastLightTheme: normalized,
          };
        }),
      toggleTheme: () =>
        set((state) => {
          const current = normalizeTheme(state.theme);
          if (isDarkTheme(current)) {
            const nextLight = sanitizeCategoryTheme(
              state.lastLightTheme,
              LIGHT_THEME_IDS,
              DEFAULT_LIGHT_THEME_ID
            );
            return {
              theme: nextLight,
              lastDarkTheme: current,
              lastLightTheme: nextLight,
            };
          }

          const nextDark = sanitizeCategoryTheme(
            state.lastDarkTheme,
            DARK_THEME_IDS,
            DEFAULT_DARK_THEME_ID
          );
          return {
            theme: nextDark,
            lastDarkTheme: nextDark,
            lastLightTheme: current,
          };
        }),
      cycleTheme: () =>
        set((state) => {
          const current = normalizeTheme(state.theme);
          const next = computeNextTheme(current);
          if (isDarkTheme(next)) {
            return {
              theme: next,
              lastDarkTheme: next,
            };
          }
          return {
            theme: next,
            lastLightTheme: next,
          };
        }),
    }),
    {
      name: THEME_KEY,
      version: 2,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return {
            theme: DEFAULT_THEME_ID,
            lastDarkTheme: DEFAULT_DARK_THEME_ID,
            lastLightTheme: DEFAULT_LIGHT_THEME_ID,
          };
        }

        const theme = normalizeTheme(persistedState.theme);
        const dark = sanitizeCategoryTheme(
          persistedState.lastDarkTheme,
          DARK_THEME_IDS,
          isDarkTheme(theme) ? theme : DEFAULT_DARK_THEME_ID
        );
        const light = sanitizeCategoryTheme(
          persistedState.lastLightTheme,
          LIGHT_THEME_IDS,
          !isDarkTheme(theme) ? theme : DEFAULT_LIGHT_THEME_ID
        );

        return {
          ...persistedState,
          theme,
          lastDarkTheme: dark,
          lastLightTheme: light,
        };
      },
    }
  )
);
