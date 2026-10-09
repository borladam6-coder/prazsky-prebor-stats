export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'pps.theme';

class Theme {
  mode = $state<ThemeMode>('system');

  init() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* ignore */
    }
    this.apply(saved === 'light' || saved === 'dark' ? saved : 'system', false);
  }

  /** Cycles system → light → dark → system. */
  toggle() {
    this.apply(this.mode === 'system' ? 'light' : this.mode === 'light' ? 'dark' : 'system');
  }

  apply(mode: ThemeMode, persist = true) {
    this.mode = mode;
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    if (persist) {
      try {
        if (mode === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, mode);
      } catch {
        /* ignore */
      }
    }
  }
}

export const theme = new Theme();
