import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const THEME_KEY = 'app-theme';

export const useThemeStore = create(
  persist(
    (set) => ({
      theme: 'dark', // 'dark' | 'light'
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((state) => ({
          theme: state.theme === 'dark' ? 'light' : 'dark',
        })),
    }),
    { name: THEME_KEY }
  )
);
