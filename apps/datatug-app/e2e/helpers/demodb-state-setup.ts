import { prepareGithubPins } from './github-pins-setup';
import { resetState } from './demodb-guard-state';

/** globalSetup for lanes that need no DemoDB files: starts a fresh guard state (breaker, memo, live counter) for the run and checks out the GitHub pins (github-pins-setup.ts). */
export default function globalSetup(): void {
  process.env['DEMODB_RUN_ID'] ??= String(process.pid);
  resetState();
  prepareGithubPins();
}
