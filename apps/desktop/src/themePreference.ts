export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'ai-clip-memory-theme';

export function readThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Continue with the local OS preference when storage is unavailable.
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyThemeMode(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
}

export function persistThemeMode(theme: ThemeMode): void {
  applyThemeMode(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme switching still works when local preference storage is unavailable.
  }
}

export function observeThemePreference(): () => void {
  const refresh = () => applyThemeMode(readThemeMode());
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) refresh();
  };

  refresh();
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', refresh);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', refresh);
  };
}
