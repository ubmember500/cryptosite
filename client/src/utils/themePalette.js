const safeGetCssVar = (variable, fallback) => {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const styles = window.getComputedStyle(document.documentElement);
  const value = styles?.getPropertyValue(variable);
  return value ? value.trim() : fallback;
};

export const getThemePalette = () => {
  const getColor = (name, fallback) => safeGetCssVar(name, fallback);
  const activeTheme =
    typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-theme')
      : null;
  const success = getColor('--color-success', '#00c853');
  const danger = getColor('--color-danger', '#ff1744');
  const isMechaTheme = activeTheme === 'mecha';

  return {
    surface: getColor('--color-surface', '#1a1d29'),
    surfaceHover: getColor('--color-surface-hover', '#252836'),
    surfaceDark: getColor('--color-surface-dark', '#141721'),
    border: getColor('--color-border', '#2a2d3a'),
    textPrimary: getColor('--color-text-primary', '#e1e4e8'),
    textSecondary: getColor('--color-text-secondary', '#8b949e'),
    accent: getColor('--color-accent', '#2962ff'),
    success,
    danger,
    warning: getColor('--color-warning', '#ffa726'),
    candleUp: isMechaTheme ? '#19d7c2' : success,
    candleDown: isMechaTheme ? '#f6465d' : danger,
  };
};
