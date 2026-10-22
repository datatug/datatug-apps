import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';

/** The visitor's choice. `auto` (the default) follows the operating system. */
export type ThemeMode = 'light' | 'dark' | 'auto';
/** What is actually painted. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'auto'];
export const DEFAULT_THEME_MODE: ThemeMode = 'auto';
/**
 * localStorage key. The inline script in `apps/datatug-app/src/index.html`
 * reads the same key before first paint — keep the two in step.
 */
export const THEME_STORAGE_KEY = 'datatug.theme.v1';
export const DARK_CLASS = 'ion-palette-dark';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.includes(value as ThemeMode);
}

/**
 * Light / dark / auto theme. Toggles `.ion-palette-dark` and `color-scheme` on
 * `<html>`; `auto` follows `prefers-color-scheme` and reacts to live changes.
 *
 * The choice is stored in localStorage (this device only). DataTug has no
 * client-writable user-settings store: `users/{uid}/ext/datatug` is written by
 * the backend, so a signed-in user's choice is not synced between devices.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly win = this.doc.defaultView;
  private readonly query =
    this.win && typeof this.win.matchMedia === 'function'
      ? this.win.matchMedia(DARK_QUERY)
      : undefined;

  private readonly _mode = signal<ThemeMode>(this.readStored());
  private readonly systemDark = signal(this.query?.matches === true);

  readonly mode = this._mode.asReadonly();
  readonly resolved = computed<ResolvedTheme>(() =>
    this._mode() === 'auto'
      ? this.systemDark()
        ? 'dark'
        : 'light'
      : (this._mode() as ResolvedTheme),
  );

  constructor() {
    this.query?.addEventListener('change', (event) => {
      this.systemDark.set(event.matches);
      this.apply();
    });
    this.apply();
  }

  setMode(mode: ThemeMode): void {
    if (!isThemeMode(mode)) {
      return;
    }
    this._mode.set(mode);
    try {
      this.win?.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Storage can be blocked (private window); the choice still applies for this visit.
    }
    this.apply();
  }

  private readStored(): ThemeMode {
    try {
      const stored = this.win?.localStorage.getItem(THEME_STORAGE_KEY);
      return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
    } catch {
      return DEFAULT_THEME_MODE;
    }
  }

  private apply(): void {
    const dark = this.resolved() === 'dark';
    const root = this.doc.documentElement;
    root.classList.toggle(DARK_CLASS, dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  }
}
