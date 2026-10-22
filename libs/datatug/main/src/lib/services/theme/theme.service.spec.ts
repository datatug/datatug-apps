import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DARK_CLASS, THEME_STORAGE_KEY, ThemeService } from './theme.service';

class FakeMediaQuery {
  private listeners: Array<(e: { matches: boolean }) => void> = [];
  constructor(public matches: boolean) {}
  addEventListener(_: string, l: (e: { matches: boolean }) => void): void {
    this.listeners.push(l);
  }
  emit(matches: boolean): void {
    this.matches = matches;
    this.listeners.forEach((l) => l({ matches }));
  }
}

describe('ThemeService', () => {
  let mq: FakeMediaQuery;
  const root = document.documentElement;

  function create(osDark: boolean, stored?: string): ThemeService {
    mq = new FakeMediaQuery(osDark);
    window.matchMedia = vi.fn(() => mq) as unknown as typeof window.matchMedia;
    if (stored !== undefined) {
      localStorage.setItem(THEME_STORAGE_KEY, stored);
    }
    return TestBed.inject(ThemeService);
  }

  beforeEach(() => {
    localStorage.clear();
    root.classList.remove(DARK_CLASS);
    root.style.colorScheme = '';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    root.classList.remove(DARK_CLASS);
  });

  it('defaults to auto and follows a light OS', () => {
    const s = create(false);
    expect(s.mode()).toBe('auto');
    expect(s.resolved()).toBe('light');
    expect(root.classList.contains(DARK_CLASS)).toBe(false);
    expect(root.style.colorScheme).toBe('light');
  });

  it('defaults to auto and follows a dark OS', () => {
    const s = create(true);
    expect(s.resolved()).toBe('dark');
    expect(root.classList.contains(DARK_CLASS)).toBe(true);
    expect(root.style.colorScheme).toBe('dark');
  });

  it('explicit modes ignore the OS', () => {
    const s = create(true);
    s.setMode('light');
    expect(s.resolved()).toBe('light');
    expect(root.classList.contains(DARK_CLASS)).toBe(false);
    s.setMode('dark');
    expect(s.resolved()).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('restores a stored choice', () => {
    const s = create(false, 'dark');
    expect(s.mode()).toBe('dark');
    expect(root.classList.contains(DARK_CLASS)).toBe(true);
  });

  it('ignores a stored value that is not a mode', () => {
    expect(create(false, 'purple').mode()).toBe('auto');
  });

  it('persists the choice, auto included', () => {
    const s = create(false);
    s.setMode('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    s.setMode('auto');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('auto');
  });

  it('ignores an invalid mode', () => {
    const s = create(false);
    s.setMode('nope' as never);
    expect(s.mode()).toBe('auto');
  });

  it('follows live OS changes in auto, and only in auto', () => {
    const s = create(false);
    mq.emit(true);
    expect(s.resolved()).toBe('dark');
    expect(root.classList.contains(DARK_CLASS)).toBe(true);
    mq.emit(false);
    expect(root.classList.contains(DARK_CLASS)).toBe(false);

    s.setMode('light');
    mq.emit(true);
    expect(s.resolved()).toBe('light');
    expect(root.classList.contains(DARK_CLASS)).toBe(false);
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const s = create(false);
    expect(s.mode()).toBe('auto');
    s.setMode('dark');
    expect(s.resolved()).toBe('dark');
    expect(root.classList.contains(DARK_CLASS)).toBe(true);
  });

  it('works without matchMedia', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const s = TestBed.inject(ThemeService);
    expect(s.resolved()).toBe('light');
  });
});
