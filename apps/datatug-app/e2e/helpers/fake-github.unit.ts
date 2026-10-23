import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { GithubCheckouts } from './fake-github.ts';

// A tiny repository with two commits, so the fake is tested on real git objects with no network.
const dir = mkdtempSync(join(tmpdir(), 'fake-github-unit-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const git = (...args: string[]) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=E2E', '-c', 'user.email=e2e@example.test', ...args], { encoding: 'utf8' }).trim();
git('init', '--quiet');
mkdirSync(join(dir, 'project/queries'), { recursive: true });
writeFileSync(join(dir, 'README.md'), 'first\n');
writeFileSync(join(dir, 'project/queries/a.sql'), 'SELECT 1\n');
writeFileSync(join(dir, 'project/data.sqlite'), Buffer.from([0x53, 0x51, 0x4c, 0x00, 0x01, 0x02]));
git('add', '-A');
git('commit', '--quiet', '-m', 'one');
const first = git('rev-parse', 'HEAD');
writeFileSync(join(dir, 'README.md'), 'second\n');
git('commit', '--quiet', '-am', 'two');
const second = git('rev-parse', 'HEAD');

const fake = new GithubCheckouts([
  { fullName: 'Owner/Repo', dir, sha: first },
  { fullName: 'owner/repo', dir, sha: second, refs: [] },
]);
const get = (href: string, headers: Record<string, string> = {}) => fake.answer('GET', new URL(href), headers);
const text = (href: string, headers?: Record<string, string>) => get(href, headers).body.toString('utf8');

test('commits/{ref}: a mapped branch and a pinned SHA resolve; the sha media type answers the bare SHA', () => {
  assert.equal(text('https://api.github.com/repos/owner/repo/commits/HEAD', { accept: 'application/vnd.github.sha' }), first);
  assert.equal(text(`https://api.github.com/repos/owner/repo/commits/${second}`, { accept: 'application/vnd.github.sha' }), second);
  const json = JSON.parse(text('https://api.github.com/repos/owner/repo/commits/main', { accept: 'application/vnd.github+json' }));
  assert.equal(json.sha, first);
  assert.equal(json.commit.tree.sha, git('rev-parse', `${first}^{tree}`));
});

test('an unmapped branch, an unpinned repository or an unknown endpoint is unpinned, never guessed', () => {
  for (const href of [
    'https://api.github.com/repos/owner/repo/commits/develop',
    'https://raw.githubusercontent.com/owner/repo/develop/README.md',
    'https://raw.githubusercontent.com/other/repo/main/README.md',
    'https://api.github.com/repos/owner/repo/pulls',
    'https://api.github.com/search/code',
  ]) {
    const answer = get(href, { accept: 'application/vnd.github.sha' });
    assert.equal(answer.status, 404, href);
    assert.ok(answer.unpinned, href);
    assert.equal(answer.headers['x-datatug-github-fake'], 'unpinned');
  }
});

test('raw files come from the git objects of the exact commit, with caching headers, and binaries stay binary', () => {
  assert.equal(text(`https://raw.githubusercontent.com/owner/repo/${first}/README.md`), 'first\n');
  assert.equal(text(`https://raw.githubusercontent.com/owner/repo/${second}/README.md`), 'second\n');
  const answer = get('https://raw.githubusercontent.com/owner/repo/HEAD/project/data.sqlite');
  assert.deepEqual([...answer.body], [0x53, 0x51, 0x4c, 0x00, 0x01, 0x02]);
  assert.equal(answer.headers['content-type'], 'application/octet-stream');
  assert.equal(answer.headers['cache-control'], 'max-age=300');
  assert.equal(answer.headers['access-control-allow-origin'], '*');
  assert.match(answer.headers['etag'], /^"[0-9a-f]{40}"$/);
  const missing = get('https://raw.githubusercontent.com/owner/repo/HEAD/nope.txt');
  assert.equal(missing.status, 404);
  assert.equal(missing.unpinned, undefined, 'a missing file at a pinned commit is an ordinary 404');
  assert.equal(get('https://raw.githubusercontent.com/owner/repo/HEAD/README.md', { 'if-none-match': answer.headers['etag'] }).status, 200);
  const etag = get('https://raw.githubusercontent.com/owner/repo/HEAD/README.md').headers['etag'];
  assert.equal(get('https://raw.githubusercontent.com/owner/repo/HEAD/README.md', { 'if-none-match': etag }).status, 304);
  assert.equal(text('https://cdn.jsdelivr.net/gh/owner/repo@main/project/queries/a.sql'), 'SELECT 1\n');
});

test('git/trees: recursive listing in GitHub shape, and a sub-tree by its own SHA', () => {
  const tree = JSON.parse(text(`https://api.github.com/repos/owner/repo/git/trees/${first}?recursive=1`));
  assert.equal(tree.truncated, false);
  assert.equal(tree.sha, git('rev-parse', `${first}^{tree}`));
  const paths = tree.tree.map((e: { path: string; type: string }) => `${e.type}:${e.path}`).sort();
  assert.deepEqual(paths, ['blob:README.md', 'blob:project/data.sqlite', 'blob:project/queries/a.sql', 'tree:project', 'tree:project/queries']);
  const readme = tree.tree.find((e: { path: string }) => e.path === 'README.md');
  assert.equal(readme.mode, '100644');
  assert.equal(readme.size, 6);
  const project = tree.tree.find((e: { path: string }) => e.path === 'project');
  const sub = JSON.parse(text(`https://api.github.com/repos/owner/repo/git/trees/${project.sha}`));
  assert.deepEqual(sub.tree.map((e: { path: string }) => e.path).sort(), ['data.sqlite', 'queries']);
});

test('repos/{o}/{r} and contents', () => {
  const repo = JSON.parse(text('https://api.github.com/repos/owner/repo'));
  assert.equal(repo.default_branch, 'main');
  assert.equal(repo.full_name, 'Owner/Repo');
  assert.ok(Number.isSafeInteger(repo.id) && repo.id > 0);
  const file = JSON.parse(text('https://api.github.com/repos/owner/repo/contents/README.md'));
  assert.equal(Buffer.from(file.content, 'base64').toString('utf8'), 'first\n');
  const listing = JSON.parse(text(`https://api.github.com/repos/owner/repo/contents/project?ref=${second}`));
  assert.deepEqual(listing.map((e: { name: string; type: string }) => `${e.type}:${e.name}`).sort(), ['dir:queries', 'file:data.sqlite']);
});

test('only reads: a write is unpinned', () => {
  assert.ok(fake.answer('PUT', new URL('https://api.github.com/repos/owner/repo/contents/README.md')).unpinned);
});
