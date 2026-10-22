/* eslint-disable @typescript-eslint/no-explicit-any */
import '@angular/compiler';
import '@analogjs/vitest-angular/setup-snapshots';
import '@analogjs/vitest-angular/setup-serializers';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { getTestBed } from '@angular/core/testing';

export function setupAngularTestingEnvironment() {
  // setupTestBed initialises the test environment once per process, behind a global flag. When spec files share
  // a worker and one of them reloaded the module registry, this file sees a fresh TestBed with no platform while
  // the flag is still set: clear the flag so the environment is set up again.
  if (!getTestBed().platform) {
    delete (globalThis as any)[Symbol.for('testbed-setup')];
  }
  try {
    setupTestBed();
  } catch {
    // ignore
  }
}

const GLOBAL_MOCKS_INSTALLED = Symbol.for('sneat-testing-global-mocks');

export function setupGlobalMocks() {
  // Spec files that share a worker (`isolate: false`) also share this window: install the wrappers once, never
  // around a wrapper installed for an earlier file.
  if ((globalThis as any)[GLOBAL_MOCKS_INSTALLED]) {
    return;
  }
  (globalThis as any)[GLOBAL_MOCKS_INSTALLED] = true;
  if (typeof window !== 'undefined') {
    // Wrap URL constructor to handle invalid bases gracefully (fixes Ionic/Stencil asset loading in tests)
    const OriginalURL = (window as any).URL;
    (window as any).URL = class extends OriginalURL {
      constructor(url: string, base?: string | URL) {
        try {
          super(url, base);
        } catch {
          // If the base is invalid, try with a default base
          try {
            super(url, 'http://localhost/');
          } catch {
            // If URL is completely invalid, fall back to localhost with the path
            // This handles cases where Ionic/Stencil tries to load assets in tests
            const fallbackUrl = url.startsWith('/') ? `http://localhost${url}` : 'http://localhost/';
            super(fallbackUrl);
          }
        }
      }
    };

    // Set document.baseURI to prevent Ionic/Stencil "Invalid URL" errors
    if ((window as any).document) {
      Object.defineProperty((window as any).document, 'baseURI', {
        get: () => 'http://localhost/',
        configurable: true,
      });

      // Ensure document.dir is defined to prevent Ionic's isRTL() from throwing
      // "Cannot read properties of undefined (reading 'toLowerCase')"
      if ((window as any).document.dir === undefined) {
        (window as any).document.dir = '';
      }
    }

    if (!(window as any).location) {
      (window as any).location = {
        href: 'http://localhost',
        pathname: '/',
        search: '',
        hash: '',
        host: 'localhost',
        hostname: 'localhost',
        origin: 'http://localhost',
        port: '',
        protocol: 'http:',
        assign: () => {
          /* ignore */
        },
        replace: () => {
          /* ignore */
        },
        reload: () => {
          /* ignore */
        },
      };
    }

    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(), // deprecated
          removeListener: vi.fn(), // deprecated
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }

    if (!window.performance) {
      (window as any).performance = {
        mark: vi.fn(),
        measure: vi.fn(),
        clearMarks: vi.fn(),
        getEntriesByName: vi.fn(() => []),
        getEntriesByType: vi.fn(() => []),
        now: vi.fn(() => Date.now()),
      };
    }

    if (!(window as any).CSSStyleSheet) {
      (window as any).CSSStyleSheet = class {
        replaceSync() {
          /* ignore */
        }
        replace() {
          return Promise.resolve();
        }
      };
    }

    if ((window as any).CSSStyleSheet) {
      (window as any).CSSStyleSheet.prototype.replaceSync = function () {
        /* ignore */
      };
      (window as any).CSSStyleSheet.prototype.replace = function () {
        return Promise.resolve();
      };
    }

    // Mock Object.getOwnPropertyDescriptor(win.document.adoptedStyleSheets, "length")
    // to avoid TypeError in Stencil: https://github.com/ionic-team/stencil/issues/5323
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    Object.getOwnPropertyDescriptor = function (obj, prop) {
      if (obj === undefined || obj === null) {
        return undefined;
      }
      try {
        if (
          obj === (window.document as any).adoptedStyleSheets &&
          prop === 'length'
        ) {
          return {
            writable: true,
            enumerable: true,
            configurable: true,
            value: (obj as any).length,
          };
        }
      } catch {
        // ignore
      }
      try {
        return originalGetOwnPropertyDescriptor(obj, prop);
      } catch {
        return undefined;
      }
    };

    if (!(window as any).CSS) {
      (window as any).CSS = {
        supports: () => false,
      };
    }

    if (!(window as any).CSSParser) {
      (window as any).CSSParser = class {
        parseFromString() {
          return {
            cssRules: [],
          };
        }
      };
    }

    const mockCollection = vi.fn().mockImplementation((...args) => {
      const path = args
        .map((arg) => (typeof arg === 'string' ? arg : arg?.path || 'ref'))
        .join('/');
      return {
        type: 'collection',
        path,
        toJSON: () => ({ path }),
      };
    });

    const mockDoc = vi.fn().mockImplementation((...args) => {
      const path = args
        .map((arg) => (typeof arg === 'string' ? arg : arg?.path || 'ref'))
        .join('/');
      return {
        type: 'document',
        path,
        toJSON: () => ({ path }),
      };
    });

    (window as any).collection = mockCollection;
    (window as any).doc = mockDoc;
    (global as any).collection = mockCollection;
    (global as any).doc = mockDoc;

    const MockMutationObserver = class {
      observe() {
        /* ignore */
      }
      disconnect() {
        /* ignore */
      }
      takeRecords() {
        return [];
      }
    };
    (window as any).MutationObserver = MockMutationObserver;
    (global as any).MutationObserver = MockMutationObserver;

    const MockIntersectionObserver = class {
      observe() {
        /* ignore */
      }
      unobserve() {
        /* ignore */
      }
      disconnect() {
        /* ignore */
      }
      takeRecords() {
        return [];
      }
    };
    (window as any).IntersectionObserver = MockIntersectionObserver;
    (global as any).IntersectionObserver = MockIntersectionObserver;
  }

  // Global mocks for fetch if not available
  if (!global.fetch) {
    (global as any).fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve({}),
        ok: true,
      }),
    );
    (global as any).Request = vi.fn();
    (global as any).Response = vi.fn();
    (global as any).Headers = vi.fn();
  }
}

const PRISTINE_HISTORY = Symbol.for('sneat-testing-pristine-history');

/**
 * Puts back what an earlier spec file in the same worker may have left behind, so that with `isolate: false`
 * every file starts from the state a fresh worker would give it: real timers, no stubbed globals or envs, no
 * active spies, empty storage, the real `window.history` at `/`, and an empty document body.
 */
export function resetSharedGlobals() {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (typeof window === 'undefined') {
    return;
  }
  const g = globalThis as any;
  if (!(PRISTINE_HISTORY in g)) {
    g[PRISTINE_HISTORY] = Object.getOwnPropertyDescriptor(window, 'history');
  }
  const pristine: PropertyDescriptor | undefined = g[PRISTINE_HISTORY];
  if (pristine) {
    Object.defineProperty(window, 'history', pristine);
  } else {
    // `history` lives on the window prototype; an own property is a spec's replacement.
    delete (window as any).history;
  }
  window.history.replaceState(null, '', '/');
  window.localStorage?.clear();
  window.sessionStorage?.clear();
  document.body.innerHTML = '';
}

export function setupBaseTestEnvironment() {
  setupAngularTestingEnvironment();
  setupGlobalMocks();
}
