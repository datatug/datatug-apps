// Project addresses (design `demo-as-github-project.md` 3.3, 3.4 and 3.4a): the table of every row, the
// unsupported inputs, and the trust decision applied to the parsed address (3.6).
import { describe, expect, it } from 'vitest';
import {
  formatGithubProjectId,
  isTrustedProjectAddress,
  readGithubProjectId,
} from './github-project-address';
import {
  DEMO_PROJECT_REF,
  getStoreId,
  IProjectUrlParts,
  parseProjectUrl,
  projectUrl,
  ProjectUrlError,
  tryProjectUrl,
} from './project-url';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function parsed(path: string): IProjectUrlParts {
  const result = parseProjectUrl(path);
  if (!result.ok) {
    throw new Error(`${path} was not accepted: ${result.reason}`);
  }
  return result;
}

describe('parseProjectUrl / projectUrl: the table of design 3.3', () => {
  // [name, url path, projectId, rest]; the path is its own canonical address.
  it.each([
    [
      'the demo',
      '/project/github.com/datatug/chinook-demo',
      'chinook-demo@datatug@',
      '',
    ],
    [
      'its chat',
      '/project/github.com/datatug/chinook-demo/chat',
      'chinook-demo@datatug@',
      '/chat',
    ],
    ['Watch root', '/project/github.com/o/r/watch', 'r@o@', '/watch'],
    ['Watch details', '/project/github.com/o/r/watch/w1', 'r@o@', '/watch/w1'],
    ['nested Watch', '/project/github.com/o/r/nested/-/watch/w1', 'r@o@nested', '/watch/w1'],
    ['pinned Watch', '/project/github.com/o/r/watch/w1?ref=release', 'r@o@@release', '/watch/w1'],
    [
      'a deep page',
      '/project/github.com/o/r/queries/folder/q1',
      'r@o@',
      '/queries/folder/q1',
    ],
    [
      'a dot in the last segment',
      '/project/github.com/o/r/queries/a.sql',
      'r@o@',
      '/queries/a.sql',
    ],
    ['a repo named chat', '/project/github.com/o/chat', 'chat@o@', ''],
    [
      'a repo named tree',
      '/project/github.com/o/tree/chat',
      'tree@o@',
      '/chat',
    ],
    [
      "today's demo project in its old repo",
      '/project/github.com/datatug/datatug-demo-projects/demo-project-1',
      'datatug-demo-projects@datatug@demo-project-1',
      '',
    ],
    [
      'the same with a page',
      '/project/github.com/o/r/demo-project-1/-/chat',
      'r@o@demo-project-1',
      '/chat',
    ],
    [
      'a directory named like a page',
      '/project/github.com/o/r/chat/-/queries',
      'r@o@chat',
      '/queries',
    ],
    [
      'a nested directory',
      '/project/github.com/o/r/a/b/c',
      'r@o@a/b/c',
      '',
    ],
    [
      'a tag at the root',
      '/project/github.com/o/r?ref=v1.0.0',
      'r@o@@v1.0.0',
      '',
    ],
    [
      'a tag, with a page',
      '/project/github.com/datatug/chinook-demo/chat?ref=v1.0.0',
      'chinook-demo@datatug@@v1.0.0',
      '/chat',
    ],
    [
      'a commit with a directory',
      `/project/github.com/o/r/dir?ref=${SHA}`,
      `r@o@dir@${SHA}`,
      '',
    ],
    [
      'the default folder "datatug"',
      '/project/github.com/o/r/datatug',
      'r@o',
      '',
    ],
    [
      'the default folder, with a page',
      '/project/github.com/o/r/datatug/-/queries',
      'r@o',
      '/queries',
    ],
    [
      'the folder "datatug" on a tag',
      '/project/github.com/o/r/datatug?ref=v2',
      'r@o@datatug@v2',
      '',
    ],
    [
      'a directory with a space',
      '/project/github.com/o/r/my%20dir',
      'r@o@my dir',
      '',
    ],
    [
      'a branch with a slash, written plainly in the query',
      '/project/github.com/o/r/demo-project-1?ref=feature/x',
      'r@o@demo-project-1@feature/x',
      '',
    ],
    [
      'a branch with a slash, with a page',
      '/project/github.com/o/r/demo-project-1/-/queries?ref=feature/x',
      'r@o@demo-project-1@feature/x',
      '/queries',
    ],
    [
      'a branch at the root, with a page',
      '/project/github.com/o/r/queries/q1?ref=main',
      'r@o@@main',
      '/queries/q1',
    ],
    [
      'a ref with a character that is percent-encoded',
      '/project/github.com/o/r/d?ref=rel%201',
      'r@o@d@rel 1',
      '',
    ],
    [
      'a directory named like a page, with no page',
      '/project/github.com/o/r/chat/-',
      'r@o@chat',
      '',
    ],
    [
      'a directory named tree (the legacy word) keeps the long legacy form',
      '/project/github.com/o/r/tree/HEAD/tree/x',
      'r@o@tree/x',
      '',
    ],
    [
      'a directory named tree on a branch',
      '/project/github.com/o/r/tree/v1/tree',
      'r@o@tree@v1',
      '',
    ],
    [
      'the default branch, a nested folder and a page',
      '/project/github.com/o/r/a/b/-/queries/x',
      'r@o@a/b',
      '/queries/x',
    ],
    [
      'a commit at the root',
      `/project/github.com/o/r?ref=${SHA}`,
      `r@o@@${SHA}`,
      '',
    ],
    [
      'a page of the root project that is not a page name',
      '/project/github.com/o/r/-/notes',
      'r@o@',
      '/notes',
    ],
    [
      'a page of the root project that holds a -',
      '/project/github.com/o/r/-/servers/db/sqlite3/-',
      'r@o@',
      '/servers/db/sqlite3/-',
    ],
  ])('%s: %s', (_name, path, projectId, rest) => {
    expect(parsed(path)).toMatchObject({
      ok: true,
      storeId: 'github.com',
      projectId,
      rest,
      shape: 'short',
      canonicalPath: path,
      isCanonical: true,
    });
    // The id writes back to the same address.
    expect(projectUrl({ storeId: 'github.com', projectId }, rest)).toBe(path);
  });

  it('keeps the page and a dotted repo name apart', () => {
    expect(parsed('/project/github.com/o/r.js/queries/a.b').projectId).toBe(
      'r.js@o@',
    );
  });
});

describe('parseProjectUrl: one canonical address per project (design 3.4a)', () => {
  it.each([
    [
      'mixed case',
      '/project/github.com/Datatug/Chinook-Demo',
      '/project/github.com/datatug/chinook-demo',
      'chinook-demo@datatug@',
    ],
    [
      'mixed case, with a page',
      '/project/github.com/Datatug/Chinook-Demo/chat',
      '/project/github.com/datatug/chinook-demo/chat',
      'chinook-demo@datatug@',
    ],
    [
      'a trailing slash',
      '/project/github.com/o/r/',
      '/project/github.com/o/r',
      'r@o@',
    ],
    [
      'a trailing slash after a page',
      '/project/github.com/o/r/chat/',
      '/project/github.com/o/r/chat',
      'r@o@',
    ],
    ['.git', '/project/github.com/o/r.git', '/project/github.com/o/r', 'r@o@'],
    [
      '.git and a page',
      '/project/github.com/o/r.git/chat',
      '/project/github.com/o/r/chat',
      'r@o@',
    ],
    ['.GIT', '/project/github.com/o/r.GIT', '/project/github.com/o/r', 'r@o@'],
    [
      'tree/HEAD',
      '/project/github.com/o/r/tree/HEAD',
      '/project/github.com/o/r',
      'r@o@',
    ],
    [
      'tree/HEAD with a page',
      '/project/github.com/o/r/tree/HEAD/-/chat',
      '/project/github.com/o/r/chat',
      'r@o@',
    ],
    [
      'an encoded HEAD',
      '/project/github.com/o/r/tree/%48EAD',
      '/project/github.com/o/r',
      'r@o@',
    ],
    [
      'a link to the project file',
      '/project/github.com/o/r/blob/v1/dir/datatug-project.json',
      '/project/github.com/o/r/dir?ref=v1',
      'r@o@dir@v1',
    ],
    [
      'a link to the project file, at the root',
      '/project/github.com/o/r/blob/v1/datatug-project.json',
      '/project/github.com/o/r?ref=v1',
      'r@o@@v1',
    ],
    [
      'a link to the project file on HEAD',
      '/project/github.com/o/r/blob/HEAD/dir/datatug-project.json',
      '/project/github.com/o/r/dir',
      'r@o@dir',
    ],
    [
      'a nested link to the project file',
      '/project/github.com/o/r/blob/v1/a/b/datatug-project.json',
      '/project/github.com/o/r/a/b?ref=v1',
      'r@o@a/b@v1',
    ],
    [
      'legacy tree/HEAD with a folder (the old demo address)',
      '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1',
      '/project/github.com/datatug/datatug-demo-project/demo-project-1',
      'datatug-demo-project@datatug@demo-project-1',
    ],
    [
      'legacy tree/HEAD with a folder and a page',
      '/project/github.com/o/r/tree/HEAD/demo-project-1/-/board/showcase',
      '/project/github.com/o/r/demo-project-1/-/board/showcase',
      'r@o@demo-project-1',
    ],
    [
      'legacy tree/HEAD with a folder named like a page',
      '/project/github.com/o/r/tree/HEAD/chat',
      '/project/github.com/o/r/chat/-',
      'r@o@chat',
    ],
    [
      'legacy tree/<branch>',
      '/project/github.com/o/r/tree/main/demo-project-1',
      '/project/github.com/o/r/demo-project-1?ref=main',
      'r@o@demo-project-1@main',
    ],
    [
      'legacy tree/<sha> with a page',
      `/project/github.com/o/r/tree/${SHA}/d/-/queries`,
      `/project/github.com/o/r/d/-/queries?ref=${SHA}`,
      `r@o@d@${SHA}`,
    ],
    [
      'legacy tree/<tag> at the root with a page',
      '/project/github.com/datatug/chinook-demo/tree/v1.0.0/-/chat',
      '/project/github.com/datatug/chinook-demo/chat?ref=v1.0.0',
      'chinook-demo@datatug@@v1.0.0',
    ],
    [
      'an explicit ?ref=HEAD',
      '/project/github.com/o/r/demo-project-1?ref=HEAD',
      '/project/github.com/o/r/demo-project-1',
      'r@o@demo-project-1',
    ],
    [
      'an explicit ?ref=HEAD at the root, with a page',
      '/project/github.com/o/r/chat?ref=HEAD',
      '/project/github.com/o/r/chat',
      'r@o@',
    ],
    [
      'tree/HEAD with a page and a ref-less query (the page keeps its own parameters)',
      '/project/github.com/o/r/tree/HEAD/d/-/quick-search?q=x',
      '/project/github.com/o/r/d/-/quick-search',
      'r@o@d',
    ],
    [
      'legacy blob/HEAD (default branch)',
      '/project/github.com/o/r/blob/HEAD/datatug-project.json',
      '/project/github.com/o/r',
      'r@o@',
    ],
    [
      'a root page after a needless -',
      '/project/github.com/o/r/-/chat',
      '/project/github.com/o/r/chat',
      'r@o@',
    ],
    [
      'a bare - at the root',
      '/project/github.com/o/r/-',
      '/project/github.com/o/r',
      'r@o@',
    ],
    [
      'a mixed-case legacy word',
      '/project/github.com/o/r/Tree/v1/d',
      '/project/github.com/o/r/d?ref=v1',
      'r@o@d@v1',
    ],
  ])('%s is rewritten', (_name, path, canonicalPath, projectId) => {
    const result = parsed(path);
    expect(result.isCanonical).toBe(false);
    expect(result.canonicalPath).toBe(canonicalPath);
    expect(result.projectId).toBe(projectId);
    // Idempotent: the canonical address is its own canonical address.
    expect(parsed(canonicalPath)).toMatchObject({
      projectId,
      canonicalPath,
      isCanonical: true,
    });
  });

  it('reports a named ref, so the caller can ask GitHub whether it is the default branch', () => {
    expect(
      parsed('/project/github.com/o/r/demo-project-1?ref=main'),
    ).toMatchObject({
      projectId: 'r@o@demo-project-1@main',
      github: { owner: 'o', repo: 'r', folder: 'demo-project-1', ref: 'main' },
      isCanonical: true,
    });
    expect(parsed('/project/github.com/o/r/tree/v1.0.0').github).toStrictEqual({
      owner: 'o',
      repo: 'r',
      folder: '',
      ref: 'v1.0.0',
    });
    expect(parsed('/project/github.com/o/r/tree/HEAD/d').github).toStrictEqual({
      owner: 'o',
      repo: 'r',
      folder: 'd',
    });
    expect(parsed('/project/github.com/O/R').github).toStrictEqual({
      owner: 'o',
      repo: 'r',
      folder: '',
    });
    expect(parsed('/store/github.com/project/r@o').github).toStrictEqual({
      owner: 'o',
      repo: 'r',
      folder: 'datatug',
    });
    // A non-GitHub store has no GitHub parts.
    expect(parsed('/store/localhost:8989/project/p1').github).toBeUndefined();
  });

  it('reads a legacy branch with a slash as ref and directory (the legacy shape cannot hold one; ?ref=feature/x can)', () => {
    expect(parsed('/project/github.com/o/r/tree/feature/x')).toMatchObject({
      projectId: 'r@o@x@feature',
      github: { owner: 'o', repo: 'r', folder: 'x', ref: 'feature' },
    });
    expect(parsed('/project/github.com/o/r?ref=feature/x')).toMatchObject({
      projectId: 'r@o@@feature/x',
      github: { owner: 'o', repo: 'r', folder: '', ref: 'feature/x' },
      isCanonical: true,
    });
    expect(parsed('/project/github.com/o/r?ref=feature%2Fx')).toMatchObject({
      projectId: 'r@o@@feature/x',
      canonicalPath: '/project/github.com/o/r?ref=feature/x',
      isCanonical: true,
    });
  });

  it('reads ref beside the page\'s own query parameters, and only ref', () => {
    expect(
      parsed('/project/github.com/o/r/d/-/quick-search?q=Customer&ref=v1&x=1#f'),
    ).toMatchObject({
      projectId: 'r@o@d@v1',
      rest: '/quick-search',
      canonicalPath: '/project/github.com/o/r/d/-/quick-search?ref=v1',
      isCanonical: true,
    });
    expect(
      parsed('/project/github.com/o/r/d/-/quick-search?q=Customer'),
    ).toMatchObject({ projectId: 'r@o@d', isCanonical: true });
    expect(
      parsed('/project/github.com/o/r/d?ref=HEAD&q=x'),
    ).toMatchObject({ projectId: 'r@o@d', canonicalPath: '/project/github.com/o/r/d', isCanonical: false });
  });

  it('keeps URL parsing apart from the id format: a ref never adds a part to the id', () => {
    // The id `repo@org@folder@ref` is built from parsed parts, never from the address text.
    for (const path of [
      '/project/github.com/o/r?ref=v1',
      '/project/github.com/o/r/d?ref=v1',
      '/project/github.com/o/r/a/b/-/queries?ref=feature/x',
    ]) {
      const result = parsed(path);
      const reading = readGithubProjectId(result.projectId);
      expect(reading.ok).toBe(true);
      expect(result.projectId.split('@')).toHaveLength(4);
      expect(reading.ok && reading.id.repo).toBe('r');
      expect(reading.ok && reading.id.org).toBe('o');
    }
    // An `@` is never read as an id separator: not in the repository, a folder or a ref.
    expect(parseProjectUrl('/project/github.com/o/r@v1')).toEqual({
      ok: false,
      reason: 'invalid-owner-or-repo',
    });
    expect(parseProjectUrl('/project/github.com/o/r/d?ref=v1@x')).toEqual({
      ok: false,
      reason: 'at-sign-not-supported',
    });
    expect(parseProjectUrl('/project/github.com/o/r/a@b')).toEqual({
      ok: false,
      reason: 'at-sign-not-supported',
    });
    expect(parseProjectUrl('/project/github.com/o@x/r')).toEqual({
      ok: false,
      reason: 'invalid-owner-or-repo',
    });
    expect(parseProjectUrl('/project/github.com/o/r?ref=')).toEqual({
      ok: false,
      reason: 'missing-ref',
    });
    expect(parseProjectUrl('/project/github.com/o/r?ref=a&ref=b')).toEqual({
      ok: false,
      reason: 'invalid-path-segment',
    });
    expect(parseProjectUrl('/project/github.com/o/r/tree/v1/d?ref=v2')).toEqual({
      ok: false,
      reason: 'invalid-path-segment',
    });
    // A ref spelled with a doubled encoding is not a ref.
    expect(parseProjectUrl('/project/github.com/o/r?ref=feature%252Fx')).toEqual({
      ok: false,
      reason: 'invalid-path-segment',
    });
  });

  it('puts everything after the first "-" in the page part', () => {
    expect(parsed('/project/github.com/o/r/a/-/b/-/c')).toMatchObject(
      {
        projectId: 'r@o@a',
        rest: '/b/-/c',
      },
    );
  });
});

describe('parseProjectUrl: inputs that are not supported', () => {
  it.each([
    [
      'any other blob link',
      '/project/github.com/o/r/blob/main/README.md',
      'file-link',
    ],
    [
      'a blob link to a nested file',
      '/project/github.com/o/r/blob/main/dir/datatug-project.yaml',
      'file-link',
    ],
    [
      'a blob link with only a ref',
      '/project/github.com/o/r/blob/main',
      'file-link',
    ],
    ['a bare blob', '/project/github.com/o/r/blob', 'file-link'],
    [
      'a project file that is not the last segment',
      '/project/github.com/o/r/blob/main/datatug-project.json/x',
      'file-link',
    ],
    ['a tree with no ref', '/project/github.com/o/r/tree', 'missing-ref'],
    [
      'an @ in a directory',
      '/project/github.com/o/r/tree/HEAD/a@b',
      'at-sign-not-supported',
    ],
    [
      'an encoded @ in a directory',
      '/project/github.com/o/r/tree/HEAD/a%40b',
      'at-sign-not-supported',
    ],
    [
      'an @ in a ref',
      '/project/github.com/o/r/tree/v1@x',
      'at-sign-not-supported',
    ],
    [
      'a directory segment named - in a link to the project file',
      '/project/github.com/o/r/blob/main/-/datatug-project.json',
      'dash-directory-not-supported',
    ],
    [
      'an encoded slash in the owner',
      '/project/github.com/datatug%2Fchinook-demo/x',
      'invalid-owner-or-repo',
    ],
    [
      'an encoded slash in the repo',
      '/project/github.com/datatug/chinook-demo%2Fevil',
      'invalid-owner-or-repo',
    ],
    [
      'an encoded slash in a ref',
      '/project/github.com/o/r/tree/a%2Fb',
      'invalid-path-segment',
    ],
    [
      'an encoded slash in a directory',
      '/project/github.com/o/r/tree/HEAD/a%2Fb',
      'invalid-path-segment',
    ],
    [
      'a double-encoded slash',
      '/project/github.com/o/r/tree/HEAD/a%252Fb',
      'invalid-path-segment',
    ],
    [
      'an encoded backslash',
      '/project/github.com/o/r/tree/HEAD/a%5Cb',
      'invalid-path-segment',
    ],
    [
      'a dot-dot directory',
      '/project/github.com/o/r/tree/HEAD/..',
      'invalid-path-segment',
    ],
    [
      'an encoded dot-dot directory',
      '/project/github.com/o/r/tree/HEAD/%2e%2e/x',
      'invalid-path-segment',
    ],
    [
      'a dot-dot ref',
      '/project/github.com/o/r/tree/../x',
      'invalid-path-segment',
    ],
    [
      'an encoded NUL',
      '/project/github.com/o/r/tree/HEAD/a%00b',
      'invalid-path-segment',
    ],
    [
      'an encoded question mark',
      '/project/github.com/o/r/tree/HEAD/a%3Fb',
      'invalid-path-segment',
    ],
    [
      'an encoded hash',
      '/project/github.com/o/r/tree/HEAD/a%23b',
      'invalid-path-segment',
    ],
    [
      'an empty directory segment',
      '/project/github.com/o/r/tree/HEAD//a',
      'invalid-path-segment',
    ],
    [
      'a malformed escape',
      '/project/github.com/o/r/tree/HEAD/a%E0%A4%A',
      'invalid-path-segment',
    ],
    ['a dot-dot repo', '/project/github.com/o/..', 'invalid-owner-or-repo'],
    ['an @ in the owner', '/project/github.com/o@x/r', 'invalid-owner-or-repo'],
    ['an @ in the repo', '/project/github.com/o/r@v1', 'invalid-owner-or-repo'],
    ['an empty ref', '/project/github.com/o/r/d?ref=', 'missing-ref'],
    ['a ref with a dot segment', '/project/github.com/o/r?ref=a/../b', 'invalid-path-segment'],
    [
      'an underscore in the owner',
      '/project/github.com/o_x/r',
      'invalid-owner-or-repo',
    ],
    [
      'an owner with a leading hyphen',
      '/project/github.com/-o/r',
      'invalid-owner-or-repo',
    ],
    [
      'a unicode look-alike repo',
      '/project/github.com/datatug/%D1%81hinook-demo',
      'invalid-owner-or-repo',
    ],
    [
      'a Kelvin-sign repo',
      '/project/github.com/datatug/chinoo%E2%84%AA-demo',
      'invalid-owner-or-repo',
    ],
    [
      'a unicode look-alike owner',
      '/project/github.com/d%D0%B0tatug/chinook-demo',
      'invalid-owner-or-repo',
    ],
    [
      'a full-width owner',
      '/project/github.com/%EF%BD%84atatug/chinook-demo',
      'invalid-owner-or-repo',
    ],
    [
      'a repo that is only ".git"',
      '/project/github.com/o/.git',
      'invalid-owner-or-repo',
    ],
  ])('%s', (_name, path, reason) => {
    expect(parseProjectUrl(path)).toEqual({ ok: false, reason });
  });

  it.each([
    '',
    '/',
    '/demo',
    '/home',
    '/project',
    '/project/github.com',
    '/project/github.com/o',
    '/project/gitlab.com/o/r',
    '/project/GitHub.com/o/r',
    '/store/github.com',
    '/store/github.com/project',
    '/store/localhost:8989',
    '/store/localhost:8989/projects',
    'project/github.com/o/r',
  ])('%j is not a project address', (path) => {
    expect(parseProjectUrl(path)).toEqual({
      ok: false,
      reason: 'not-a-project-address',
    });
  });

  it('is not a project address for a non-string', () => {
    expect(parseProjectUrl(undefined as never)).toEqual({
      ok: false,
      reason: 'not-a-project-address',
    });
  });
});

describe('parseProjectUrl: the trust decision on the parsed address (design 3.6)', () => {
  const trusted = (path: string): boolean => {
    const result = parseProjectUrl(path);
    return isTrustedProjectAddress(result);
  };

  it.each([
    '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1',
    '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/chat',
    '/project/github.com/Datatug/Datatug-Demo-Project/tree/HEAD/demo-project-1/-/chat',
    '/project/github.com/datatug/datatug-demo-project.git/tree/HEAD/demo-project-1/-/chat',
    '/project/github.com/datatug/datatug-demo-project/blob/HEAD/demo-project-1/datatug-project.json',
    '/store/github.com/project/datatug-demo-project@datatug@demo-project-1',
    '/store/github/project/Datatug-Demo-Project@Datatug@demo-project-1/chat',
    ])('trusts %s', (path) => {
    expect(trusted(path)).toBe(true);
  });

  it.each([
    ['a tag', '/project/github.com/datatug/chinook-demo/tree/v1.0.0/-/chat'],
    [
      'the default branch by name',
      '/project/github.com/datatug/chinook-demo/tree/main/-/chat',
    ],
    ['a commit', `/project/github.com/datatug/chinook-demo/tree/${SHA}/-/chat`],
    [
      'a commit link to the project file',
      `/project/github.com/datatug/chinook-demo/blob/${SHA}/datatug-project.json`,
    ],
    [
      'a ref with HEAD behind it',
      `/project/github.com/datatug/chinook-demo/tree/${SHA}/HEAD`,
    ],
    ['"head"', '/project/github.com/datatug/chinook-demo/tree/head'],
    ['another owner', '/project/github.com/someone/chinook-demo/chat'],
    ['a look-alike repo', '/project/github.com/datatug/chinook-demo-evil/chat'],
    [
      'a repo that begins with it',
      '/project/github.com/datatug/chinook-demo-x',
    ],
    [
      'an owner that begins with it',
      '/project/github.com/datatug-x/chinook-demo',
    ],
    [
      'an encoded slash joining owner and repo',
      '/project/github.com/datatug%2Fchinook-demo/chat',
    ],
    [
      'an encoded slash after the repo',
      '/project/github.com/datatug/chinook-demo%2F..%2Fevil',
    ],
    ['a Kelvin sign', '/project/github.com/datatug/chinoo%E2%84%AA-demo'],
    ['a Cyrillic look-alike', '/project/github.com/datatug/%D1%81hinook-demo'],
    [
      'an old-form tag',
      '/store/github.com/project/chinook-demo@datatug@@v1.0.0',
    ],
    [
      'an old-form SHA',
      `/store/github.com/project/chinook-demo@datatug@@${SHA}`,
    ],
    [
      'an old-form look-alike',
      '/store/github.com/project/chinook-demo-evil@datatug@',
    ],
    [
      'an old-form other owner',
      '/store/github.com/project/chinook-demo@datatug-x@',
    ],
    ['a not-accepted address', '/project/github.com/datatug/chinook-demo/tree'],
  ])('does not trust %s', (_name, path) => {
    expect(trusted(path)).toBe(false);
  });
});

describe('parseProjectUrl: the old shape', () => {
  it('reads a non-GitHub store as it is', () => {
    expect(parsed('/store/localhost:8989/project/p1/queries/q')).toEqual({
      ok: true,
      storeId: 'localhost:8989',
      projectId: 'p1',
      rest: '/queries/q',
      shape: 'legacy',
      canonicalPath: '/store/localhost:8989/project/p1/queries/q',
      isCanonical: true,
    });
    expect(parsed('/store/http-localhost:8989/project/p1')).toMatchObject({
      storeId: 'http-localhost:8989',
      projectId: 'p1',
      rest: '',
    });
    expect(parsed('/store/firestore/project/p1/')).toMatchObject({ rest: '' });
  });

  // The old-form rows of design 3.4 (the redirect itself is task G-A1d; here: the same {storeId, projectId}).
  it.each([
    [
      '/store/github.com/project/datatug-demo-projects@datatug@demo-project-1',
      'datatug-demo-projects@datatug@demo-project-1',
      '',
      '/project/github.com/datatug/datatug-demo-projects/demo-project-1',
    ],
    [
      '/store/github.com/project/datatug-demo-projects@datatug@demo-project-1/queries/q',
      'datatug-demo-projects@datatug@demo-project-1',
      '/queries/q',
      '/project/github.com/datatug/datatug-demo-projects/demo-project-1/-/queries/q',
    ],
    [
      '/store/github.com/project/datatug-demo-projects%40datatug%40demo-project-1/chat',
      'datatug-demo-projects@datatug@demo-project-1',
      '/chat',
      '/project/github.com/datatug/datatug-demo-projects/demo-project-1/-/chat',
    ],
    [
      '/store/github.com/project/r@o@/chat',
      'r@o@',
      '/chat',
      '/project/github.com/o/r/chat',
    ],
    [
      '/store/github.com/project/r@o/chat',
      'r@o',
      '/chat',
      '/project/github.com/o/r/datatug/-/chat',
    ],
    [
      '/store/github/project/r@o',
      'r@o',
      '',
      '/project/github.com/o/r/datatug',
    ],
    [
      '/store/github.com/project/R@O@dir/',
      'r@o@dir',
      '',
      '/project/github.com/o/r/dir',
    ],
    [
      '/store/github.com/project/r@o@@v1.0.0',
      'r@o@@v1.0.0',
      '',
      '/project/github.com/o/r?ref=v1.0.0',
    ],
  ])(
    '%s resolves to the same project as its short address',
    (path, projectId, rest, canonicalPath) => {
      const result = parsed(path);
      expect(result).toMatchObject({
        storeId: 'github.com',
        projectId,
        rest,
        shape: 'legacy',
        canonicalPath,
        isCanonical: false,
      });
      // The short address of that project gives the very same pair.
      const short = parsed(canonicalPath);
      expect({
        storeId: short.storeId,
        projectId: short.projectId,
        rest: short.rest,
      }).toEqual({
        storeId: result.storeId,
        projectId: result.projectId,
        rest: result.rest,
      });
    },
  );

  it.each([
    ['too few parts', '/store/github.com/project/abc', 'not-a-project-address'],
    [
      'too many parts',
      '/store/github.com/project/r@o@d@v1@x',
      'at-sign-not-supported',
    ],
    [
      'an invalid owner',
      '/store/github.com/project/r@o_x@d',
      'invalid-owner-or-repo',
    ],
    [
      'a malformed escape',
      '/store/github.com/project/r%E0%A4%A@o',
      'invalid-path-segment',
    ],
  ])('does not accept an old GitHub address with %s', (_name, path, reason) => {
    expect(parseProjectUrl(path)).toEqual({ ok: false, reason });
  });
});

describe('projectUrl', () => {
  it.each([
    [
      { storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1' },
      undefined,
      '/project/github.com/datatug/datatug-demo-project/demo-project-1',
    ],
    [
      { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
      'chat',
      '/project/github.com/datatug/chinook-demo/chat',
    ],
    [
      { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
      '/chat',
      '/project/github.com/datatug/chinook-demo/chat',
    ],
    [
      { storeId: 'github.com', projectId: 'Chinook-Demo@Datatug@' },
      'chat',
      '/project/github.com/datatug/chinook-demo/chat',
    ],
    [
      { storeId: 'github', projectId: 'r@o@d' },
      'queries/q',
      '/project/github.com/o/r/d/-/queries/q',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o' },
      undefined,
      '/project/github.com/o/r/datatug',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@datatug' },
      'chat',
      '/project/github.com/o/r/datatug/-/chat',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@@v1.0.0' },
      'chat',
      '/project/github.com/o/r/chat?ref=v1.0.0',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@d@feature/x' },
      'queries',
      '/project/github.com/o/r/d/-/queries?ref=feature/x',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@@rel 1' },
      undefined,
      '/project/github.com/o/r?ref=rel%201',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@d@HEAD' },
      undefined,
      '/project/github.com/o/r/d',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@my dir' },
      undefined,
      '/project/github.com/o/r/my%20dir',
    ],
    // Not GitHub: unchanged from what the app builds today (`/store/<id>/project/<id>/<page>`).
    [
      { storeId: 'localhost:8989', projectId: 'p1' },
      undefined,
      '/store/localhost:8989/project/p1',
    ],
    [
      { storeId: 'localhost:8989', projectId: 'p1' },
      'queries',
      '/store/localhost:8989/project/p1/queries',
    ],
    [
      { storeId: 'http://localhost:8989', projectId: 'p1' },
      'env/x',
      '/store/http-localhost:8989/project/p1/env/x',
    ],
    [
      { storeId: 'firestore', projectId: 'p1' },
      'chat',
      '/store/firestore/project/p1/chat',
    ],
  ])('%j + %j = %s', (ref, page, expected) => {
    expect(projectUrl(ref, page)).toBe(expected);
  });

  it('writes what parseProjectUrl reads, for every project of the table', () => {
    for (const projectId of [
      'chinook-demo@datatug@',
      'r@o',
      'r@o@a/b',
      'r@o@@v1',
      `r@o@d@${SHA}`,
      'r@o@d@feature/x',
      'r@o@chat',
      'r@o@tree/x',
      'r@o@@HEAD',
    ].map((id) => (id === 'r@o@@HEAD' ? 'r@o@' : id))) {
      for (const page of [undefined, 'chat', 'queries/x/y']) {
        const url = projectUrl({ storeId: 'github.com', projectId }, page);
        expect(parsed(url)).toMatchObject({
          storeId: 'github.com',
          projectId,
          rest: page ? `/${page}` : '',
          isCanonical: true,
        });
      }
    }
  });
});

describe('projectUrl writes the page as plain text, percent-encoded (issue #180)', () => {
  it.each([
    // [page, the written segments]
    ['a b', '/a%20b'],
    ['queries/a b', '/queries/a%20b'],
    ['50%', '/50%25'],
    ['a%20b', '/a%2520b'], // the text `a%20b`, not a space
    ['x?y=1', '/x%3Fy%3D1'],
    ['x#y', '/x%23y'],
    ['é/ü', '/%C3%A9/%C3%BC'],
    ['a\\b', '/a%5Cb'],
    ['%2e%2e/x', '/%252e%252e/x'], // the text `%2e%2e`, which is not `..`
    ["it's", "/it's"],
  ])('page %j is written as %s, in both address shapes', (page, written) => {
    // A folder project: its page always follows `/-` (a root page that is not a page name does too).
    const short = projectUrl({ storeId: 'github.com', projectId: 'r@o@d' }, page);
    expect(short).toBe('/project/github.com/o/r/d/-' + written);
    const legacy = projectUrl({ storeId: 'localhost:8989', projectId: 'p' }, page);
    expect(legacy).toBe('/store/localhost:8989/project/p' + written);
    for (const url of [short, legacy]) {
      expect(parsed(url)).toMatchObject({ rest: written, isCanonical: true });
    }
  });

  it.each(['.', '..', 'a/../b', 'a/./b', '', '/', 'a//b', 'chat/', '\u0000', 'a\\..'])(
    'still refuses the page %j',
    (page) => {
      if (page === '' || page === '/') {
        // No page at all is the project itself.
        expect(typeof tryProjectUrl({ storeId: 'github.com', projectId: 'r@o@' }, page)).toBe('string');
        return;
      }
      expect(tryProjectUrl({ storeId: 'github.com', projectId: 'r@o@' }, page)).toMatchObject({ ok: false });
    },
  );
});

describe('DEMO_PROJECT_REF (G-A1c)', () => {
  it('is the demo project at its short address, and the trusted project', () => {
    expect(DEMO_PROJECT_REF).toEqual({ storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1' });
    expect(projectUrl(DEMO_PROJECT_REF)).toBe('/project/github.com/datatug/datatug-demo-project/demo-project-1');
    expect(projectUrl(DEMO_PROJECT_REF, 'chat')).toBe('/project/github.com/datatug/datatug-demo-project/demo-project-1/-/chat');
    expect(isTrustedProjectAddress(DEMO_PROJECT_REF)).toBe(true);
  });
});

describe('projectUrl writes a page given as segments (G-A1c)', () => {
  const github = { storeId: 'github.com', projectId: 'r@o@' };
  const agent = { storeId: 'localhost:8989', projectId: 'p' };
  it.each([
    // [segments, the written page]
    [[], ''],
    [['chat'], '/chat'],
    [['env', 'local', 'db', 'main', 'table', 'dbo.Customer'], '/env/local/db/main/table/dbo.Customer'],
    // An element is ONE segment, whatever it holds: a folder-qualified query id keeps its slash as `%2F`.
    [['query', 'customers/customer-invoices'], '/query/customers%2Fcustomer-invoices'],
    [['query', 'a b'], '/query/a%20b'],
    [['query', '50%'], '/query/50%25'],
    [['servers', 'db', 'sqlite3', '-'], '/servers/db/sqlite3/-'],
  ])('segments %j are written as %j, in both address shapes', (segments, written) => {
    const short = projectUrl({ storeId: 'github.com', projectId: 'r@o@d' }, segments);
    expect(short).toBe('/project/github.com/o/r/d' + (written ? '/-' + written : ''));
    const legacy = projectUrl(agent, segments);
    expect(legacy).toBe('/store/localhost:8989/project/p' + written);
    for (const url of [short, legacy]) {
      expect(parsed(url)).toMatchObject({ rest: written, isCanonical: true });
    }
  });

  it('writes the same address for the segments and for the plain-text page that splits into them', () => {
    expect(projectUrl(github, ['queries', 'folder', 'q1'])).toBe(projectUrl(github, 'queries/folder/q1'));
    expect(projectUrl(agent, ['queries', 'folder', 'q1'])).toBe(projectUrl(agent, 'queries/folder/q1'));
  });

  it.each([[['.']], [['..']], [['a', '']], [['']], [['a', '..']], [['\u0000']], [['a', 3 as unknown as string]]])(
    'refuses the segments %j',
    (segments) => {
      expect(tryProjectUrl(github, segments)).toMatchObject({ ok: false });
      expect(tryProjectUrl(agent, segments)).toMatchObject({ ok: false });
    },
  );

  it('reads no page from null, and refuses a page that is neither text nor segments', () => {
    expect(projectUrl(github, null as unknown as string)).toBe('/project/github.com/o/r');
    expect(tryProjectUrl(github, 3 as unknown as string)).toMatchObject({ ok: false });
  });
});

describe('projectUrl refuses what it cannot write exactly (design review S2)', () => {
  it.each([
    // [store, id, page]
    ['github.com', 'abc', 'chat'],
    ['github.com', 'r@o@d@v1@x', undefined],
    ['github.com', 'chinook-demo@datatug@@HEAD@x', undefined],
    ['github.com', 'chinook-demo@datatug@@@', undefined],
    ['github.com', 'r@o@a/-/b', 'chat'],
    ['github.com', 'r@o@-', undefined],
    ['github.com', 'r@o@..', undefined],
    ['github.com', 'r@o@.', undefined],
    ['github.com', 'r@o@d@a//b', undefined],
    ['github.com', 'r@o@d@a/../b', undefined],
    ['github.com', 'r@o@d@..', undefined],
    ['github.com', 'r@o@a?b', undefined],
    ['github.com', 'r@o_x@d', undefined],
    ['github.com', 'r.git.git@o@', undefined],
    ['github.com', 'r@o@', '//chat'],
    ['github.com', 'r@o@', 'chat/'],
    ['github.com', 'r@o@', 'a//b'],
    ['github.com', 'r@o@', '..'],
    ['github.com', 'r@o@', 'a/../b'],
    ['github.com', 'r@o@', '../../evil/repo'],
    ['github.com', 'r@o@d', 'a/./b'],
    ['GitHub.com', 'r@o@', undefined],
    ['GITHUB.COM', 'r@o@', 'chat'],
    ['localhost:8989', 'p/q', undefined],
    ['localhost:8989', '', undefined],
    ['localhost:8989', 'p', 'a//b'],
    ['a/b', 'p', undefined],
    ['localhost:8989', '..', undefined],
    ['localhost:8989', 'a b ', undefined],
  ])('%s %j %j has no address', (storeId, projectId, page) => {
    expect(tryProjectUrl({ storeId, projectId }, page)).toMatchObject({
      ok: false,
    });
    expect(() => projectUrl({ storeId, projectId }, page)).toThrow(
      ProjectUrlError,
    );
  });

  it('refuses a ref that is not a ref, whatever the page', () => {
    for (const page of [undefined, 'chat']) {
      expect(
        tryProjectUrl({ storeId: undefined as never, projectId: 'r@o' }, page),
      ).toMatchObject({ ok: false });
      expect(
        tryProjectUrl(
          { storeId: 'github.com', projectId: undefined as never },
          page,
        ),
      ).toMatchObject({ ok: false });
      expect(tryProjectUrl(undefined as never, page)).toMatchObject({
        ok: false,
      });
    }
  });

  it('writes a page that would read as part of the locator after /-', () => {
    // Page "tree/x" on a root project must not become `…/o/r/tree/x` (the legacy shape: ref "x").
    expect(
      projectUrl({ storeId: 'github.com', projectId: 'r@o@' }, 'tree/x'),
    ).toBe('/project/github.com/o/r/-/tree/x');
    expect(
      projectUrl({ storeId: 'github.com', projectId: 'r@o@' }, 'blob/x'),
    ).toBe('/project/github.com/o/r/-/blob/x');
    expect(projectUrl({ storeId: 'github.com', projectId: 'r@o@' }, '-')).toBe(
      '/project/github.com/o/r/-/-',
    );
    expect(parsed('/project/github.com/o/r/-/tree/x')).toMatchObject({
      projectId: 'r@o@',
      rest: '/tree/x',
      isCanonical: true,
    });
    // …and a root address whose page is "tree/x" is NOT the root project: it is the legacy ref x.
    expect(parsed('/project/github.com/o/r/tree/x')).toMatchObject({
      projectId: 'r@o@@x',
      rest: '',
      isCanonical: false,
      canonicalPath: '/project/github.com/o/r?ref=x',
    });
    // A folder that starts with the legacy word keeps the long legacy form, which is then canonical.
    expect(parsed('/project/github.com/o/r/tree/v1/tree/x')).toMatchObject({
      projectId: 'r@o@tree/x@v1',
      isCanonical: true,
    });
    expect(projectUrl({ storeId: 'github.com', projectId: 'r@o@tree/x' })).toBe(
      '/project/github.com/o/r/tree/HEAD/tree/x',
    );
    // …and cannot hold a ref with a slash: no address.
    expect(
      tryProjectUrl({ storeId: 'github.com', projectId: 'r@o@tree/x@feature/x' }),
    ).toMatchObject({ ok: false });
  });

  // The property: for every accepted {store, id, page}, parseProjectUrl(projectUrl(x)) is x (the id in its
  // canonical spelling); every other combination is refused, never the address of a different project.
  const pages = [
    undefined,
    '',
    'chat',
    '/chat',
    'queries/x/y',
    '-',
    'tree/x',
    'blob',
    'a b',
    'a%20b',
    'chat/',
    '//chat',
    '..',
    '.',
    'a/../b',
    '%2e%2e',
    'é',
    'a//b',
    'x/-/y',
    'a\\b',
  ];

  const check = (
    storeId: string,
    projectId: string,
    page: string | undefined,
    counts: { accepted: number; refused: number },
  ) => {
    const result = tryProjectUrl({ storeId, projectId }, page);
    if (typeof result !== 'string') {
      counts.refused++;
      return;
    }
    counts.accepted++;
    const back = parseProjectUrl(result);
    if (!back.ok) {
      throw new Error(
        `${result} was built for ${JSON.stringify([storeId, projectId, page])} and does not parse: ${back.reason}`,
      );
    }
    const wantRest = page
      ? '/' +
        page
          .replace(/^\//, '')
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/')
      : '';
    const github = storeId === 'github.com' || storeId === 'github';
    const same =
      back.rest === wantRest &&
      back.canonicalPath === result &&
      back.isCanonical &&
      (github
        ? back.storeId === 'github.com' &&
          back.projectId === formatCanonical(projectId)
        : back.storeId === getStoreId(storeId) && back.projectId === projectId);
    if (!same) {
      throw new Error(
        `${JSON.stringify([storeId, projectId, page])} -> ${result} -> ${JSON.stringify(back)}`,
      );
    }
  };

  it('is the inverse of parseProjectUrl for every GitHub combination, or refuses', () => {
    const owners = ['o', 'datatug', '-o', 'ö'];
    const repos = ['r', 'R.x', 'r.GIT', 'r.git.git', 'tree', '..', 'a/b', '-'];
    const dirs = [
      '',
      'datatug',
      'd',
      'a/b',
      'my dir',
      '-',
      'a/-/b',
      'tree',
      '..',
      '.',
      'ü',
      'a%b',
      'a?b',
      'a#b',
      'a\\b',
      'HEAD',
      ' ',
      ' a',
      'a\tb',
      'é/ü',
      'a//b',
      '/a',
      'a/',
    ];
    const refs = [
      undefined,
      '',
      'HEAD',
      'v1',
      'a b',
      'feature/x',
      '..',
      '-',
      'a@b',
      SHA,
      '%2F',
      'head',
      ' v1',
    ];
    const counts = { accepted: 0, refused: 0 };
    for (const storeId of ['github.com', 'github', 'GitHub.com']) {
      for (const owner of owners) {
        for (const repo of repos) {
          for (const dir of dirs) {
            for (const ref of refs) {
              const projectId =
                ref === undefined
                  ? `${repo}@${owner}@${dir}`
                  : `${repo}@${owner}@${dir}@${ref}`;
              for (const page of pages) {
                check(storeId, projectId, page, counts);
              }
            }
          }
        }
      }
    }
    expect(counts.accepted).toBeGreaterThan(1000);
    expect(counts.refused).toBeGreaterThan(1000);
    // About 1 s on a laptop and 3.5 to 5.6 s on a CI runner that is running the rest of the package's specs at
    // the same time (it failed on the default 5 s timeout), so give the exhaustive walk room.
  }, 60_000);

  it('is the inverse of parseProjectUrl for every other store, or refuses', () => {
    const counts = { accepted: 0, refused: 0 };
    for (const storeId of [
      'localhost:8989',
      'http-localhost:8989',
      'http://localhost:8989',
      'firestore',
      'a/b',
      '',
      'x y',
      '..',
    ]) {
      for (const projectId of [
        'p',
        'p/q',
        '',
        '..',
        'a b ',
        'p@q',
        'é',
        'a%b',
        'github.com',
      ]) {
        for (const page of pages) {
          check(storeId, projectId, page, counts);
        }
      }
    }
    expect(counts.accepted).toBeGreaterThan(50);
    expect(counts.refused).toBeGreaterThan(50);
  });
});

/** The canonical spelling of an accepted GitHub id, through the strict reading. */
function formatCanonical(projectId: string): string {
  const reading = readGithubProjectId(projectId);
  if (!reading.ok) {
    throw new Error(`not a valid id: ${projectId}`);
  }
  return formatGithubProjectId(reading.id);
}

describe('parseProjectUrl: the review cases (page validation, store, .git.git)', () => {
  it.each([
    [
      'a repo named .git.git',
      '/project/github.com/o/r.git.git',
      'invalid-owner-or-repo',
    ],
    [
      'a repo of .git.git.git',
      '/project/github.com/o/r.git.git.git',
      'invalid-owner-or-repo',
    ],
    [
      'a dot-dot page after the project',
      '/project/github.com/datatug/chinook-demo/../../evil/repo',
      'invalid-path-segment',
    ],
    [
      'an encoded dot-dot page',
      '/project/github.com/datatug/chinook-demo/%2e%2e/%2E%2e/evil',
      'invalid-path-segment',
    ],
    [
      'an encoded slash dot-dot page',
      '/project/github.com/datatug/chinook-demo/..%2f..%2fevil',
      'invalid-path-segment',
    ],
    [
      'an encoded backslash dot-dot page',
      '/project/github.com/datatug/chinook-demo/..%5c..%5cevil',
      'invalid-path-segment',
    ],
    ['a dot page', '/project/github.com/o/r/./chat', 'invalid-path-segment'],
    [
      'an empty page segment',
      '/project/github.com/o/r/chat//x',
      'invalid-path-segment',
    ],
    [
      'a double trailing slash',
      '/project/github.com/o/r/chat//',
      'invalid-path-segment',
    ],
    [
      'a double slash after the repo',
      '/project/github.com/o/r//',
      'invalid-path-segment',
    ],
    [
      'an encoded NUL in a page',
      '/project/github.com/o/r/a%00b',
      'invalid-path-segment',
    ],
    [
      'a malformed escape in a page',
      '/project/github.com/o/r/a%E0%A4%A',
      'invalid-path-segment',
    ],
    [
      'a dot-dot page after a tree locator',
      '/project/github.com/o/r/tree/HEAD/d/-/../x',
      'invalid-path-segment',
    ],
    [
      'a dot-dot page of an old address',
      '/store/github.com/project/r@o@/../x',
      'invalid-path-segment',
    ],
    [
      'a dot-dot page of a non-GitHub store',
      '/store/localhost:8989/project/p/../x',
      'invalid-path-segment',
    ],
    [
      'the legacy folder ..',
      '/store/github.com/project/chinook-demo@datatug@..',
      'invalid-path-segment',
    ],
    [
      'the legacy folder .',
      '/store/github.com/project/chinook-demo@datatug@.',
      'invalid-path-segment',
    ],
    [
      'the legacy folder -',
      '/store/github.com/project/chinook-demo@datatug@-',
      'invalid-path-segment',
    ],
    [
      'a legacy traversal folder',
      '/store/github.com/project/chinook-demo@datatug@..%2F..%2F..%2Fevil%2Frepo%2Fmain',
      'invalid-path-segment',
    ],
    [
      'a legacy backslash folder',
      '/store/github.com/project/chinook-demo@datatug@..%5C..%5C..%5Cevil',
      'invalid-path-segment',
    ],
    [
      'a legacy question mark folder',
      '/store/github.com/project/chinook-demo@datatug@a%3Fb',
      'invalid-path-segment',
    ],
    [
      'a legacy folder with leading space',
      '/store/github.com/project/chinook-demo@datatug@%20a',
      'invalid-path-segment',
    ],
    [
      'a legacy folder with a leading tab',
      '/store/github.com/project/chinook-demo@datatug@%09a',
      'invalid-path-segment',
    ],
    [
      'a legacy ref of ..',
      '/store/github.com/project/chinook-demo@datatug@x@..',
      'invalid-path-segment',
    ],
    [
      'a case variant of the GitHub store',
      '/store/GitHub.com/project/chinook-demo@datatug@',
      'unsupported-store-id',
    ],
    [
      'an upper-case GitHub store',
      '/store/GITHUB.COM/project/r@o@',
      'unsupported-store-id',
    ],
    [
      'a case variant of the bare GitHub store',
      '/store/Github/project/r@o@',
      'unsupported-store-id',
    ],
  ])('refuses %s', (_name, path, reason) => {
    expect(parseProjectUrl(path)).toEqual({ ok: false, reason });
  });

  it('keeps an encoded slash inside one page segment, judged as the path it becomes', () => {
    expect(parsed('/project/github.com/o/r/queries/a%2Fb')).toMatchObject({
      rest: '/queries/a%2Fb',
    });
    expect(parsed('/project/github.com/o/r/queries/a%20b')).toMatchObject({
      rest: '/queries/a%20b',
    });
  });

  it('handles a trailing slash once', () => {
    expect(parsed('/project/github.com/o/r/chat/')).toMatchObject({
      rest: '/chat',
      isCanonical: false,
      canonicalPath: '/project/github.com/o/r/chat',
    });
    expect(parsed('/store/github.com/project/r@o@/chat/')).toMatchObject({
      rest: '/chat',
    });
  });

  it('never reports ok without a canonical path', () => {
    for (const path of [
      '/project/github.com/o/r.git',
      '/project/github.com/o/r',
      '/store/github/project/r@o',
      '/store/x/project/y',
    ]) {
      const result = parsed(path);
      expect(typeof result.canonicalPath).toBe('string');
    }
  });

  it('is not trusted through any other store', () => {
    const id = 'chinook-demo@datatug@';
    for (const store of [
      'http-localhost:8989',
      'https-evil.example',
      'firestore',
      'localhost:8989',
    ]) {
      const result = parseProjectUrl(`/store/${store}/project/${id}`);
      expect(result.ok).toBe(true);
      expect(isTrustedProjectAddress(result)).toBe(false);
    }
    expect(
      isTrustedProjectAddress(
        parseProjectUrl('/store/GitHub.com/project/' + id),
      ),
    ).toBe(false);
    expect(
      isTrustedProjectAddress(
        parseProjectUrl(
          '/project/github.com/datatug/chinook-demo/tree/HEAD/sub',
        ),
      ),
    ).toBe(false);
    expect(
      isTrustedProjectAddress(
        parseProjectUrl('/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1'),
      ),
    ).toBe(true);
  });
});
