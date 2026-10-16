import { signal } from '@angular/core';

const enterpriseEnabled = signal(false);

/**
 * True once AG Grid Enterprise modules are registered with a license key (after `ensureAgGrid()` resolves).
 * Grids read it to switch on enterprise-only options (row grouping, aggregation, pivot, tool panel, Excel
 * export, integrated charts). Always false when no license key was configured at build time.
 */
export const agGridEnterpriseEnabled = enterpriseEnabled.asReadonly();

interface Loaders {
  community: () => Promise<{ registerAgGridCommunity: () => void }>;
  enterprise: () => Promise<{
    registerAgGridEnterprise: (licenseKey: string) => void;
  }>;
}

// Dynamic imports keep every AG Grid package out of the startup bundle and out of every route that has no grid.
const defaultLoaders: Loaders = {
  community: () => import('./ag-grid-community-loader'),
  enterprise: () => import('./ag-grid-enterprise-loader'),
};

let licenseKey = '';
let ensured: Promise<void> | undefined;

/** Startup call: remembers the build-time key. Imports and runs no AG Grid code. */
export function configureAgGrid(key: string): void {
  licenseKey = key.trim();
}

/**
 * Registers AG Grid modules once and returns the same promise to every caller (safe to call concurrently).
 * Every grid-hosting component awaits it before its grid can be created. Community modules are always
 * registered; enterprise modules are imported, registered and licensed ONLY when a key is configured (the key
 * is never logged). If enterprise fails to load the grids stay on community.
 */
export function ensureAgGrid(loaders: Loaders = defaultLoaders): Promise<void> {
  ensured ??= register(licenseKey, loaders);
  return ensured;
}

async function register(key: string, loaders: Loaders): Promise<void> {
  (await loaders.community()).registerAgGridCommunity();
  if (!key) {
    return;
  }
  try {
    (await loaders.enterprise()).registerAgGridEnterprise(key);
    enterpriseEnabled.set(true);
  } catch {
    // Deliberately no error object or key in the message: stay on community modules.
    console.warn(
      'AG Grid Enterprise failed to load; using community features.',
    );
  }
}

/** Test seam: forget configuration and the one-time registration so a spec can run it again. */
export function resetAgGridSetupForTests(): void {
  licenseKey = '';
  ensured = undefined;
  enterpriseEnabled.set(false);
}
