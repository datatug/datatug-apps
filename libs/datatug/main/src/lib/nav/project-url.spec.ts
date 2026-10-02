// Project addresses (design `demo-as-github-project.md` 3.3, 3.4 and 3.4a): the table of every row, the
// unsupported inputs, and the trust decision applied to the parsed address (3.6).
import { describe, expect, it } from 'vitest';
import { isTrustedGithubProjectId } from './github-project-address';
import { IProjectUrlParts, parseProjectUrl, projectUrl } from './nav-models';

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
      '/project/github.com/datatug/datatug-demo-projects/tree/HEAD/demo-project-1',
      'datatug-demo-projects@datatug@demo-project-1',
      '',
    ],
    [
      'the same with a page',
      '/project/github.com/o/r/tree/HEAD/demo-project-1/-/chat',
      'r@o@demo-project-1',
      '/chat',
    ],
    [
      'a directory named like a page',
      '/project/github.com/o/r/tree/HEAD/chat/-/queries',
      'r@o@chat',
      '/queries',
    ],
    [
      'a nested directory',
      '/project/github.com/o/r/tree/HEAD/a/b/c',
      'r@o@a/b/c',
      '',
    ],
    [
      'a tag at the root',
      '/project/github.com/o/r/tree/v1.0.0',
      'r@o@@v1.0.0',
      '',
    ],
    [
      'a tag, with a page',
      '/project/github.com/datatug/chinook-demo/tree/v1.0.0/-/chat',
      'chinook-demo@datatug@@v1.0.0',
      '/chat',
    ],
    [
      'a commit with a directory',
      `/project/github.com/o/r/tree/${SHA}/dir`,
      `r@o@dir@${SHA}`,
      '',
    ],
    [
      'the default folder "datatug"',
      '/project/github.com/o/r/tree/HEAD/datatug',
      'r@o',
      '',
    ],
    [
      'the default folder, with a page',
      '/project/github.com/o/r/tree/HEAD/datatug/-/queries',
      'r@o',
      '/queries',
    ],
    [
      'the folder "datatug" on a tag',
      '/project/github.com/o/r/tree/v2/datatug',
      'r@o@datatug@v2',
      '',
    ],
    [
      'a directory with a space',
      '/project/github.com/o/r/tree/HEAD/my%20dir',
      'r@o@my dir',
      '',
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
      '/project/github.com/o/r/tree/v1/dir',
      'r@o@dir@v1',
    ],
    [
      'a link to the project file, at the root',
      '/project/github.com/o/r/blob/v1/datatug-project.json',
      '/project/github.com/o/r/tree/v1',
      'r@o@@v1',
    ],
    [
      'a link to the project file on HEAD',
      '/project/github.com/o/r/blob/HEAD/dir/datatug-project.json',
      '/project/github.com/o/r/tree/HEAD/dir',
      'r@o@dir',
    ],
    [
      'a nested link to the project file',
      '/project/github.com/o/r/blob/v1/a/b/datatug-project.json',
      '/project/github.com/o/r/tree/v1/a/b',
      'r@o@a/b@v1',
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
      parsed('/project/github.com/o/r/tree/main/demo-project-1'),
    ).toMatchObject({
      projectId: 'r@o@demo-project-1@main',
      namedRef: 'main',
      isCanonical: true,
    });
    expect(parsed('/project/github.com/o/r/tree/v1.0.0')).toMatchObject({
      namedRef: 'v1.0.0',
    });
    expect(
      parsed('/project/github.com/o/r/tree/HEAD/d').namedRef,
    ).toBeUndefined();
    expect(parsed('/project/github.com/o/r').namedRef).toBeUndefined();
  });

  it('reads a branch with a slash as ref and directory (not supported: no project is found there)', () => {
    expect(parsed('/project/github.com/o/r/tree/feature/x')).toMatchObject({
      projectId: 'r@o@x@feature',
      namedRef: 'feature',
    });
  });

  it('puts everything after the first "-" in the page part', () => {
    expect(parsed('/project/github.com/o/r/tree/HEAD/a/-/b/-/c')).toMatchObject(
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
      'a page named - in the short form',
      '/project/github.com/o/r/-/chat',
      'invalid-path-segment',
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
    ['an @ in the repo', '/project/github.com/o/r@x', 'invalid-owner-or-repo'],
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
    return result.ok && isTrustedGithubProjectId(result.projectId);
  };

  it.each([
    '/project/github.com/datatug/chinook-demo',
    '/project/github.com/datatug/chinook-demo/chat',
    '/project/github.com/datatug/chinook-demo/tree/HEAD',
    '/project/github.com/datatug/chinook-demo/tree/HEAD/-/chat',
    '/project/github.com/Datatug/Chinook-Demo/chat',
    '/project/github.com/datatug/chinook-demo.git/chat',
    '/project/github.com/datatug/chinook-demo/',
    '/project/github.com/datatug/chinook-demo/blob/HEAD/datatug-project.json',
    '/store/github.com/project/chinook-demo@datatug@',
    '/store/github/project/Chinook-Demo@Datatug@/chat',
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
      '/project/github.com/datatug/datatug-demo-projects/tree/HEAD/demo-project-1',
    ],
    [
      '/store/github.com/project/datatug-demo-projects@datatug@demo-project-1/queries/q',
      'datatug-demo-projects@datatug@demo-project-1',
      '/queries/q',
      '/project/github.com/datatug/datatug-demo-projects/tree/HEAD/demo-project-1/-/queries/q',
    ],
    [
      '/store/github.com/project/datatug-demo-projects%40datatug%40demo-project-1/chat',
      'datatug-demo-projects@datatug@demo-project-1',
      '/chat',
      '/project/github.com/datatug/datatug-demo-projects/tree/HEAD/demo-project-1/-/chat',
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
      '/project/github.com/o/r/tree/HEAD/datatug/-/chat',
    ],
    [
      '/store/github/project/r@o',
      'r@o',
      '',
      '/project/github.com/o/r/tree/HEAD/datatug',
    ],
    [
      '/store/github.com/project/R@O@dir/',
      'r@o@dir',
      '',
      '/project/github.com/o/r/tree/HEAD/dir',
    ],
    [
      '/store/github.com/project/r@o@@v1.0.0',
      'r@o@@v1.0.0',
      '',
      '/project/github.com/o/r/tree/v1.0.0',
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
      { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
      undefined,
      '/project/github.com/datatug/chinook-demo',
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
      '/project/github.com/o/r/tree/HEAD/d/-/queries/q',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o' },
      undefined,
      '/project/github.com/o/r/tree/HEAD/datatug',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@datatug' },
      'chat',
      '/project/github.com/o/r/tree/HEAD/datatug/-/chat',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@@v1.0.0' },
      'chat',
      '/project/github.com/o/r/tree/v1.0.0/-/chat',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@d@HEAD' },
      undefined,
      '/project/github.com/o/r/tree/HEAD/d',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@my dir' },
      undefined,
      '/project/github.com/o/r/tree/HEAD/my%20dir',
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
    // A GitHub id the short shape cannot express keeps the old address, which still opens it.
    [
      { storeId: 'github.com', projectId: 'abc' },
      'chat',
      '/store/github.com/project/abc/chat',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o@a/-/b' },
      'chat',
      '/store/github.com/project/r@o@a/-/b/chat',
    ],
    [
      { storeId: 'github.com', projectId: 'r@o_x@d' },
      undefined,
      '/store/github.com/project/r@o_x@d',
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
    ]) {
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
