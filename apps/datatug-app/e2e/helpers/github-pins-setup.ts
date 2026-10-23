import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { demoProjectPin } from './github-pins';

/**
 * The GitHub half of every lane's globalSetup: make sure each commit of e2e/github-pins.json is checked out
 * (scripts/fetch-github-pins.mjs: nothing to fetch when warm, one shallow fetch per missing commit), then point
 * DATATUG_E2E_GITHUB_FAKE at the lane's demo project checkout, for the specs that read its files directly. Workers inherit
 * the variable. In GitHub live mode (the live smoke) the specs read the real GitHub, so the variable stays unset.
 */
export function prepareGithubPins(): void {
  if (process.env['GITHUB_E2E_MODE'] === 'live') return;
  execFileSync(process.execPath, [join(__dirname, '../../../../scripts/fetch-github-pins.mjs')], { stdio: 'inherit' });
  process.env['DATATUG_E2E_GITHUB_FAKE'] ??= demoProjectPin().dir;
}
