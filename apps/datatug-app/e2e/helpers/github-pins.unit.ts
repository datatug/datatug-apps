import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// e2e/github-pins.json is the ONE place a GitHub commit the suites read is named. These checks keep the workflows, the
// docs and the product code from drifting away from it.
const root = join(import.meta.dirname, '../../../..');
const pins = (JSON.parse(readFileSync(join(root, 'apps/datatug-app/e2e/github-pins.json'), 'utf8')) as {
  pins: { id: string; repo: string; sha: string; refs?: string[] }[];
}).pins;
const pinnedRepos = new Set(pins.map((pin) => pin.repo.toLowerCase()));
const pinnedShas = new Set(pins.map((pin) => pin.sha));

test('the manifest is well formed', () => {
  assert.equal(new Set(pins.map((pin) => pin.id)).size, pins.length, 'pin ids are unique');
  for (const pin of pins) {
    assert.match(pin.repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, pin.id);
    assert.match(pin.sha, /^[0-9a-f]{40}$/, `${pin.id}: a full lower-case commit SHA`);
    for (const ref of pin.refs ?? []) assert.doesNotMatch(ref, /^[0-9a-f]{40}$/, `${pin.id}: refs are branch names; a SHA is served by its pin`);
  }
});

test('no workflow checks out a pinned repository at a SHA of its own', () => {
  const dir = join(root, '.github/workflows');
  for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const repo = /^\s*repository:\s*([^\s#]+)/.exec(line)?.[1]?.toLowerCase();
      if (!repo || !pinnedRepos.has(repo)) return;
      const ref = lines.slice(i + 1, i + 8).map((next) => /^\s*ref:\s*([0-9a-f]{40})\s*$/.exec(next)?.[1]).find(Boolean);
      assert.equal(ref, undefined, `${file}:${i + 1} checks out ${repo} at ${ref}: read the SHA from apps/datatug-app/e2e/github-pins.json instead`);
    });
  }
});

test('the product names a pinned repository only at a pinned commit (or by branch)', () => {
  const files = execFileSync('git', ['-C', root, 'ls-files', 'libs', 'apps'], { encoding: 'utf8' })
    .split('\n')
    .filter((path) => /\.(ts|json|html)$/.test(path) && !/(\.spec|\.test|\.unit)\.ts$|\/e2e\/|fixture/.test(path));
  for (const path of files) {
    const text = readFileSync(join(root, path), 'utf8');
    for (const m of text.matchAll(/(?:raw\.githubusercontent\.com|cdn\.jsdelivr\.net\/gh)\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)[/@]([0-9a-f]{40})\//g)) {
      if (!pinnedRepos.has(m[1].toLowerCase())) continue;
      assert.ok(pinnedShas.has(m[2]), `${path} reads ${m[1]}@${m[2]}, which e2e/github-pins.json does not pin`);
    }
  }
});
