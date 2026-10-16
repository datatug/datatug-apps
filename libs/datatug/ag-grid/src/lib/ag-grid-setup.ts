import { signal } from '@angular/core';

const enterpriseEnabled = signal(false);

/**
 * True once AG Grid Enterprise modules are registered with a license key. Grids read it to switch on
 * enterprise-only options (row grouping, aggregation, pivot, tool panel, Excel export, integrated charts).
 * Always false when no license key was configured at build time.
 */
export const agGridEnterpriseEnabled = enterpriseEnabled.asReadonly();

type EnterpriseLoader = () => Promise<{
  registerAgGridEnterprise: (licenseKey: string) => void;
}>;

// The dynamic import keeps ag-grid-enterprise out of every eagerly loaded chunk.
const loadEnterprise: EnterpriseLoader = () =>
  import('./ag-grid-enterprise-loader');

let setupPromise: Promise<void> | undefined;

/**
 * Runs once, before the first grid can render. Without a license key it does nothing at all: it imports no
 * AG Grid code (so ag-grid-community stays in the lazy chunks of the pages that use it, and each grid page
 * keeps registering AllCommunityModule itself as before) and loads nothing of enterprise.
 * With a non-empty `licenseKey` it imports and registers the enterprise modules (which include the community
 * ones) and sets the key; the key is never logged. If enterprise fails to load the app stays on community.
 */
export function setupAgGrid(
  licenseKey: string,
  loader: EnterpriseLoader = loadEnterprise,
): Promise<void> {
  setupPromise ??= doSetup(licenseKey.trim(), loader);
  return setupPromise;
}

async function doSetup(
  licenseKey: string,
  loader: EnterpriseLoader,
): Promise<void> {
  if (!licenseKey) {
    return;
  }
  try {
    const { registerAgGridEnterprise } = await loader();
    registerAgGridEnterprise(licenseKey);
    enterpriseEnabled.set(true);
  } catch {
    // Deliberately no error object or key in the message: stay on community modules.
    console.warn(
      'AG Grid Enterprise failed to load; using community features.',
    );
  }
}

/** Test seam: forget the one-time setup so a spec can run it again. */
export function resetAgGridSetupForTests(): void {
  setupPromise = undefined;
  enterpriseEnabled.set(false);
}
