// Mutation check for the DemoDB guard's request logic: each mutation below breaks one rule of
// apps/datatug-app/e2e/helpers/demodb-guard-logic.ts / demodb-guard-state.ts, and the unit tests next to them must FAIL.
//   node scripts/mutate-demodb-guard.mjs
// A mutation the tests do not notice (or one that no longer applies because the code moved) fails this script.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const helpers = new URL('../apps/datatug-app/e2e/helpers/', import.meta.url).pathname;
const logic = 'demodb-guard-logic.ts';
const state = 'demodb-guard-state.ts';

const mutations = [
  { name: 'flipped run-budget check (>= becomes <)', file: logic, from: 'liveRunCount() >= rules.maxLivePerRun', to: 'liveRunCount() < rules.maxLivePerRun' },
  { name: 'flipped per-test budget check', file: logic, from: "counter.sum('live') >= rules.maxLivePerTest", to: "counter.sum('live') < rules.maxLivePerTest" },
  {
    name: 'counting after sending instead of before',
    file: logic,
    from: "  bumpLiveRun();\n  counter.bump(url.hostname, 'live');\n  const response = await live();",
    to: "  const response = await live();\n  bumpLiveRun();\n  counter.bump(url.hostname, 'live');",
  },
  { name: 'dropped breaker check', file: logic, from: 'if (tripped) return refuse(tripped);', to: '' },
  { name: 'dropped trip of the breaker on a block answer', file: logic, from: 'if (blocked) return { abort: tripBreaker(', to: 'if (false) return { abort: tripBreaker(' },
  { name: 'dropped memo lookup', file: logic, from: 'const cached = hasRange ? undefined : memoGet(key);', to: 'const cached = undefined as Stored | undefined;' },
  { name: '52x treated as non-blocking', file: state, from: '[403, 503, 520, 521, 522, 523, 524, 525, 526, 527, 530]', to: '[403, 503]' },
  { name: '429 treated as non-blocking', file: state, from: 'if (status === 429) return true;', to: 'if (status === 429) return false;' },
  { name: 'GitHub quota 403 treated as non-blocking', file: state, from: "if (status === 403 && headers['x-ratelimit-remaining'] === '0') return true;", to: '' },
];

let bad = 0;
for (const mutation of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'demodb-mutation-'));
  cpSync(helpers, dir, { recursive: true });
  const path = join(dir, mutation.file);
  const source = readFileSync(path, 'utf8');
  if (!source.includes(mutation.from)) {
    console.error(`NOT APPLICABLE  ${mutation.name}: the code to mutate is not there any more; update this script`);
    bad += 1;
    continue;
  }
  writeFileSync(path, source.replace(mutation.from, mutation.to));
  const run = spawnSync(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', join(dir, 'ts-extensionless.mjs'), '--test', join(dir, 'demodb-guard-logic.unit.ts'), join(dir, 'demodb-guard-state.unit.ts')],
    { encoding: 'utf8' },
  );
  if (run.status === 0) {
    console.error(`SURVIVED        ${mutation.name}: the unit tests still pass`);
    bad += 1;
  } else {
    console.log(`killed          ${mutation.name}`);
  }
}
const clean = spawnSync(
  process.execPath,
  ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', join(helpers, 'ts-extensionless.mjs'), '--test', join(helpers, 'demodb-guard-logic.unit.ts'), join(helpers, 'demodb-guard-state.unit.ts')],
  { encoding: 'utf8' },
);
if (clean.status !== 0) {
  console.error('The unmutated unit tests FAIL:\n' + clean.stdout.slice(-2000));
  bad += 1;
}
console.log(`${mutations.length} mutations, ${bad} problem(s)`);
process.exitCode = bad === 0 ? 0 : 1;
