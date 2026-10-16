import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Playwright globalSetup for the demo-sqlite lane. In fixture mode it makes sure the pinned DemoDB files are on disk by
 * running scripts/fetch-demodb-fixtures.mjs, which requests nothing for a file that is already present and valid (CI
 * restores them from actions/cache first). Live mode needs no fixtures. HTTP 429 fails the run immediately.
 */
export default function globalSetup(): void {
  if (process.env['DEMODB_E2E_MODE'] === 'live') return;
  execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(__dirname, '../../../../scripts/fetch-demodb-fixtures.mjs')], {
    stdio: 'inherit',
  });
}
