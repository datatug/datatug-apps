import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = 'libs/datatug/main/src/lib/demo/bundle/demo-project.bundle.json';
const data = 'apps/datatug-app/src/assets/demo-data/ovdb';

/** A scratch repository holding only what the checker reads, so a test can break it without touching the real files. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'demo-bundle-'));
  mkdirSync(join(dir, 'tools/demo-bundle'), { recursive: true });
  cpSync(join(repo, 'tools/demo-bundle'), join(dir, 'tools/demo-bundle'), { recursive: true });
  mkdirSync(dirname(join(dir, bundle)), { recursive: true });
  cpSync(join(repo, bundle), join(dir, bundle));
  cpSync(join(repo, data), join(dir, data), { recursive: true });
  return dir;
}
const check = (dir) => spawnSync(process.execPath, [join(dir, 'tools/demo-bundle/generate.mjs'), '--check'], { encoding: 'utf8' });

test('the committed bundle passes the offline drift check', () => {
  const result = check(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /demo-bundle: ok/);
});

test('a changed data file is reported as drift', () => {
  const dir = scratch();
  const file = join(dir, data, 'geo/population_wb.json');
  writeFileSync(file, readFileSync(file, 'utf8').replace('5484367', '5484368'));
  const result = check(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /population_wb\.json does not match the bundle's hash/);
});

test('a moved pin is reported as drift', () => {
  const dir = scratch();
  const pinFile = join(dir, 'tools/demo-bundle/pin.json');
  const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
  pin.demoProjects.commit = '0'.repeat(40);
  writeFileSync(pinFile, JSON.stringify(pin));
  const result = check(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /bundle was built from 0e5b98f.* pin\.json says 0{40}/);
});

test('a data file the bundle does not list is reported', () => {
  const dir = scratch();
  writeFileSync(join(dir, data, 'geo/extra.json'), '[]');
  const result = check(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /extra\.json is not listed in the bundle/);
});

test('a missing bundle says how to regenerate it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-bundle-empty-'));
  mkdirSync(join(dir, 'tools/demo-bundle'), { recursive: true });
  cpSync(join(repo, 'tools/demo-bundle'), join(dir, 'tools/demo-bundle'), { recursive: true });
  const result = check(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pnpm demo:bundle/);
});
