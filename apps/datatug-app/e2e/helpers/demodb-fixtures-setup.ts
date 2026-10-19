import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { resetState } from './demodb-guard-state';

/**
 * Playwright globalSetup. Starts a fresh guard state for the run (demodb-guard-state.ts) and, in fixture mode, makes sure
 * the pinned SQLite files are on disk by running scripts/fetch-demodb-fixtures.mjs, which requests nothing for a file that
 * is already present and valid (CI restores them from actions/cache first). Live mode needs no fixtures.
 * Lanes that never read a DemoDB file (the real-agent journey) skip the download: DEMODB_FIXTURE_SETUP=skip, or a run
 * limited to --project=journey.
 */
export default function globalSetup(): void {
  process.env['DEMODB_RUN_ID'] ??= String(process.pid);
  resetState();
  if (process.env['DEMODB_E2E_MODE'] === 'live') return;
  const journeyOnly = process.argv.some((arg, i) => arg === '--project=journey' || (arg === '--project' && process.argv[i + 1] === 'journey'));
  if (process.env['DEMODB_FIXTURE_SETUP'] === 'skip' || journeyOnly) return;
  execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(__dirname, '../../../../scripts/fetch-demodb-fixtures.mjs')], {
    stdio: 'inherit',
  });
}
