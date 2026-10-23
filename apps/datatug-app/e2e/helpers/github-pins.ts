import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The GitHub pins of the e2e suites (../github-pins.json): which repository is read at which commit, and which branch
 * names each pin answers. scripts/fetch-github-pins.mjs puts the checkouts on disk (globalSetup); helpers/fake-github.ts
 * serves them.
 */
export interface GithubPin {
  readonly id: string;
  /** `owner/repo`. */
  readonly repo: string;
  /** The full commit SHA. */
  readonly sha: string;
  /** Branch names (and `HEAD`) answered with this commit. Empty unless the pin is the one its lane selected. */
  readonly refs: readonly string[];
  /** The shallow checkout of the commit. */
  readonly dir: string;
}

const manifestPath = (): string => join(__dirname, '../github-pins.json');

export const githubPinsDir = (): string =>
  resolve(process.env['GITHUB_PINS_DIR'] || join(__dirname, '../../../../tmp/github-checkouts'));

export function readGithubPins(): GithubPin[] {
  const manifest = JSON.parse(readFileSync(manifestPath(), 'utf8')) as {
    pins: { id: string; repo: string; sha: string; refs?: string[] }[];
  };
  return manifest.pins.map((pin) => ({
    id: pin.id,
    repo: pin.repo,
    sha: pin.sha,
    refs: pin.refs ?? [],
    dir: join(githubPinsDir(), ...pin.repo.split('/'), pin.sha),
  }));
}

/** The pin ids the lane selected (DATATUG_E2E_GITHUB_PINS=<id>[,<id>]); per repository the first pin is the default. */
const selectedIds = (): string[] =>
  (process.env['DATATUG_E2E_GITHUB_PINS'] ?? '').split(',').map((id) => id.trim()).filter(Boolean);

/**
 * Every pin, with branch names kept only on the pin that answers them for its repository in this lane: the one named in
 * DATATUG_E2E_GITHUB_PINS, else the repository's first pin. A commit SHA is answered by any pin of the repository.
 */
export function servingGithubPins(): GithubPin[] {
  const all = readGithubPins();
  const selected = selectedIds();
  for (const id of selected) {
    if (!all.some((pin) => pin.id === id)) throw new Error(`DATATUG_E2E_GITHUB_PINS names an unknown pin: ${id} (see e2e/github-pins.json)`);
  }
  const owner = new Map<string, string>();
  for (const pin of all) if (selected.includes(pin.id)) owner.set(pin.repo.toLowerCase(), pin.id);
  for (const pin of all) if (!owner.has(pin.repo.toLowerCase())) owner.set(pin.repo.toLowerCase(), pin.id);
  return all.map((pin) => (owner.get(pin.repo.toLowerCase()) === pin.id ? pin : { ...pin, refs: [] }));
}

/** The checkout of the demo project the lane serves at `HEAD` (what DATATUG_E2E_GITHUB_FAKE pointed at before). */
export function demoProjectPin(): GithubPin {
  const pin = servingGithubPins().find((p) => p.repo === 'datatug/datatug-demo-project' && p.refs.length > 0);
  if (!pin) throw new Error('e2e/github-pins.json has no datatug/datatug-demo-project pin');
  return pin;
}
