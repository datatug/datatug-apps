import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DARK_CLASS,
  THEME_MODE_ATTRIBUTE,
  THEME_STORAGE_KEY,
} from './theme.service';

// The inline script in apps/datatug-app/src/index.html cannot import ThemeService; this keeps the two in step.
const html = readFileSync(
  resolve(__dirname, '../../../../../../../apps/datatug-app/src/index.html'),
  'utf8',
);
const script = /<script id="datatug-theme-init">([\s\S]*?)<\/script>/.exec(
  html,
)?.[1];

describe('index.html theme-init script', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    const root = document.documentElement;
    root.classList.remove(DARK_CLASS);
    root.removeAttribute(THEME_MODE_ATTRIBUTE);
  });

  it('exists and uses the same storage key, dark class and mode attribute as ThemeService', () => {
    expect(script).toBeTruthy();
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(script).toContain(`'${DARK_CLASS}'`);
    expect(script).toContain(`'${THEME_MODE_ATTRIBUTE}'`);
  });

  function run(osDark: boolean): void {
    window.matchMedia = vi.fn(() => ({
      matches: osDark,
      addEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    new Function(script as string)();
  }

  it('applies a stored choice before the app starts', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run(false);
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it('keeps a Dark choice when storage is blocked and the OS changes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    let query: { matches: boolean } | undefined;
    let listener: (() => void) | undefined;
    window.matchMedia = vi.fn(() => {
      query = { matches: false };
      return Object.assign(query, {
        addEventListener: (_: string, l: () => void) => (listener = l),
      });
    }) as unknown as typeof window.matchMedia;
    new Function(script as string)();
    document.documentElement.setAttribute(THEME_MODE_ATTRIBUTE, 'dark'); // what ThemeService.setMode does
    (query as { matches: boolean }).matches = true;
    listener?.();
    (query as { matches: boolean }).matches = false;
    listener?.();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });
});
