import { resetState } from './demodb-guard-state';

/** globalSetup for lanes that need no DemoDB files: only starts a fresh guard state (breaker, memo, live counter) for the run. */
export default function globalSetup(): void {
  process.env['DEMODB_RUN_ID'] ??= String(process.pid);
  resetState();
}
