import { describe, expect, it } from 'vitest';
import {
  asciiLowerCase,
  formatGithubProjectId,
  formatGithubProjectApiKey,
  GithubProjectIdError,
  isTrustedProjectAddress,
  isValidGithubFolder,
  isValidGithubRef,
  readGithubProjectId,
  readNewProjectFolder,
  splitGithubProjectId,
} from './github-project-address';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('splitGithubProjectId / formatGithubProjectId', () => {
  it.each([
    // [id, split result]
    ['my-repo@my-org', { repo: 'my-repo', org: 'my-org', folder: 'datatug' }],
    ['my-repo@my-org@dir', { repo: 'my-repo', org: 'my-org', folder: 'dir' }],
    ['my-repo@my-org@a/b', { repo: 'my-repo', org: 'my-org', folder: 'a/b' }],
    ['my-repo@my-org@', { repo: 'my-repo', org: 'my-org', folder: '' }],
    ['r@o@@v1.0.0', { repo: 'r', org: 'o', folder: '', ref: 'v1.0.0' }],
    ['r@o@dir@v1.0.0', { repo: 'r', org: 'o', folder: 'dir', ref: 'v1.0.0' }],
    ['r@o@dir@HEAD', { repo: 'r', org: 'o', folder: 'dir' }],
    ['r@o@dir@', { repo: 'r', org: 'o', folder: 'dir' }],
    [
      'Repo@Org@Dir@Ref',
      { repo: 'repo', org: 'org', folder: 'Dir', ref: 'Ref' },
    ],
  ])('splits %s', (id, expected) => {
    expect(splitGithubProjectId(id)).toStrictEqual(expected);
  });

  it('never throws on a malformed id', () => {
    expect(splitGithubProjectId('abc')).toEqual({
      repo: 'abc',
      org: undefined,
      folder: 'datatug',
    });
    expect(splitGithubProjectId('')).toEqual({
      repo: '',
      org: undefined,
      folder: 'datatug',
    });
  });

  it.each([
    ['r@o', 'r@o'],
    ['R@O@datatug', 'r@o'],
    ['r@o@demo-project-1', 'r@o@demo-project-1'],
    ['r@o@', 'r@o@'],
    ['r@o@@v1.0.0', 'r@o@@v1.0.0'],
    ['r@o@datatug@v1.0.0', 'r@o@datatug@v1.0.0'],
    ['r@o@dir@HEAD', 'r@o@dir'],
  ])('formats %s as the one id %s', (id, expected) => {
    expect(formatGithubProjectId(splitGithubProjectId(id))).toBe(expected);
  });
});

describe('asciiLowerCase', () => {
  it('lower-cases A-Z only', () => {
    expect(asciiLowerCase('Datatug-Chinook_Demo.1')).toBe(
      'datatug-chinook_demo.1',
    );
    // The Kelvin sign is NOT folded to "k" (toLowerCase() would).
    expect('K'.toLowerCase()).toBe('k');
    expect(asciiLowerCase('K')).toBe('K');
  });
});

describe('readGithubProjectId (the strict reading)', () => {
  it.each([
    ['r@o', { repo: 'r', org: 'o', folder: 'datatug' }],
    ['R@O@Dir', { repo: 'r', org: 'o', folder: 'Dir' }],
    ['r@o@', { repo: 'r', org: 'o', folder: '' }],
    ['r@o@a/b', { repo: 'r', org: 'o', folder: 'a/b' }],
    ['r@o@my dir', { repo: 'r', org: 'o', folder: 'my dir' }],
    ['r@o@@v1.0.0', { repo: 'r', org: 'o', folder: '', ref: 'v1.0.0' }],
    ['r@o@d@HEAD', { repo: 'r', org: 'o', folder: 'd' }],
    ['r@o@d@', { repo: 'r', org: 'o', folder: 'd' }],
    ['.github@o@', { repo: '.github', org: 'o', folder: '' }],
  ])('reads %s', (id, expected) => {
    expect(readGithubProjectId(id)).toStrictEqual({ ok: true, id: expected });
  });

  it.each([
    ['', 'parts'],
    ['r', 'parts'],
    ['r@o@d@v1@x', 'parts'],
    ['r@o@@@', 'parts'],
    ['r@@', 'owner-or-repo'],
    ['@o@', 'owner-or-repo'],
    ['r@o_x@', 'owner-or-repo'],
    ['r@-o@', 'owner-or-repo'],
    ['r.git@o@', 'owner-or-repo'],
    ['r.GIT@o@', 'owner-or-repo'],
    ['..@o@', 'owner-or-repo'],
    ['r/x@o@', 'owner-or-repo'],
    ['chinooK-demo@datatug@', 'owner-or-repo'],
    ['r@o@..', 'folder'],
    ['r@o@.', 'folder'],
    ['r@o@-', 'folder'],
    ['r@o@a/-/b', 'folder'],
    ['r@o@a//b', 'folder'],
    ['r@o@/a', 'folder'],
    ['r@o@a/', 'folder'],
    ['r@o@a\\b', 'folder'],
    ['r@o@a?b', 'folder'],
    ['r@o@a#b', 'folder'],
    ['r@o@a%b', 'folder'],
    ['r@o@\ta', 'folder'],
    ['r@o@a ', 'folder'],
    ['r@o@a\u0000', 'folder'],
    ['r@o@a\u007f', 'folder'],
    ['r@o@d@..', 'ref'],
    ['r@o@d@a/b', 'ref'],
    ['r@o@d@a b ', 'ref'],
    ['r@o@d@a%b', 'ref'],
  ])('refuses %j (%s)', (id, reason) => {
    expect(readGithubProjectId(id)).toStrictEqual({ ok: false, reason });
  });

  it('refuses a non-string', () => {
    for (const v of [
      undefined,
      null,
      1,
      ['r@o'],
      { split: () => ['r', 'o'] },
    ]) {
      expect(readGithubProjectId(v)).toStrictEqual({
        ok: false,
        reason: 'parts',
      });
    }
  });

  it('validates folders and refs on their own', () => {
    expect(isValidGithubFolder('')).toBe(true);
    expect(isValidGithubFolder('a/b c')).toBe(true);
    expect(isValidGithubFolder('..')).toBe(false);
    expect(isValidGithubFolder(undefined)).toBe(false);
    expect(isValidGithubRef('v1.0.0')).toBe(true);
    expect(isValidGithubRef('')).toBe(false);
    expect(isValidGithubRef('a@b')).toBe(false);
  });
});

describe('isTrustedProjectAddress (design 3.6): the one trust function', () => {
  const GH = 'github.com';
  const trusted = (projectId: string, storeId = GH): boolean =>
    isTrustedProjectAddress({ storeId, projectId });

  it.each([
    [
      'the canonical folder, no ref',
      'datatug-demo-project@datatug@demo-project-1',
    ],
    ['an explicit HEAD', 'datatug-demo-project@datatug@demo-project-1@HEAD'],
    [
      'mixed case owner and repo',
      'Datatug-Demo-Project@Datatug@demo-project-1',
    ],
  ])('trusts %s', (_name, projectId) => {
    expect(trusted(projectId)).toBe(true);
  });

  it.each([
    ['a tag', 'chinook-demo@datatug@@v1.0.0'],
    ['the default branch by its name', 'chinook-demo@datatug@@main'],
    ['another branch', 'chinook-demo@datatug@@feature-x'],
    ['a 40-character SHA', `chinook-demo@datatug@@${SHA}`],
    [
      'a 40-character SHA, upper case',
      `chinook-demo@datatug@@${SHA.toUpperCase()}`,
    ],
    ['"head" (a branch may be called that)', 'chinook-demo@datatug@@head'],
    ['"Head"', 'chinook-demo@datatug@@Head'],
    ['"HEAD " with a space', 'chinook-demo@datatug@@HEAD '],
    ['"HEAD~1"', 'chinook-demo@datatug@@HEAD~1'],
    ['"HEAD^"', 'chinook-demo@datatug@@HEAD^'],
    ['another owner, same repo', 'chinook-demo@someone@'],
    ['the same owner, another repo', 'datatug-demo-projects@datatug@'],
    ['a repo that begins with the trusted one', 'chinook-demo-x@datatug@'],
    ['a look-alike repo', 'chinook-demo-evil@datatug@'],
    ['an owner that begins with the trusted one', 'chinook-demo@datatug-x@'],
    ['a repo that ends with the trusted one', 'x-chinook-demo@datatug@'],
    ['an owner that ends with the trusted one', 'chinook-demo@x-datatug@'],
    ['the repo with .git', 'chinook-demo.git@datatug@'],
    ['the repo with a trailing slash', 'chinook-demo/@datatug@'],
    ['the repo with a path', 'chinook-demo/evil@datatug@'],
    [
      'owner and repo joined in the owner',
      'chinook-demo@datatug/chinook-demo@',
    ],
    ['a space around the repo', ' chinook-demo@datatug@'],
    ['a newline after the repo', 'chinook-demo\n@datatug@'],
    ['a NUL after the repo', 'chinook-demo\u0000@datatug@'],
    ['an encoded slash left in the repo', 'chinook-demo%2Fevil@datatug@'],
    ['an encoded name left in the owner', 'chinook-demo@datatu%67@'],
    ['the Kelvin sign for k in "chinook"', 'chinooK-demo@datatug@'],
    ['a Cyrillic "с" for "c"', 'сhinook-demo@datatug@'],
    ['a Cyrillic "а" in "datatug"', 'chinook-demo@dаtatug@'],
    ['a Greek omicron for "o"', 'chinοok-demo@datatug@'],
    ['a full-width repo', 'ｃhinook-demo@datatug@'],
    ['a zero-width space inside the repo', 'chinook​-demo@datatug@'],
    ['a non-breaking hyphen', 'chinook‑demo@datatug@'],
    ['a dotless i in the owner', 'chinook-demo@datatugı@'],
    [
      'no folder part: the default folder "datatug" is not the root',
      'chinook-demo@datatug',
    ],
    ['a folder of the trusted repo', 'chinook-demo@datatug@sub'],
    ['the default folder named explicitly', 'chinook-demo@datatug@datatug'],
    ['five parts', 'chinook-demo@datatug@@HEAD@x'],
    ['five parts, empty', 'chinook-demo@datatug@@@'],
    ['four parts with a ref after a folder', 'chinook-demo@datatug@sub@HEAD'],
    ['no owner', 'chinook-demo'],
    ['empty', ''],
  ])('does not trust %s', (_name, projectId) => {
    expect(trusted(projectId)).toBe(false);
  });

  it.each([
    ['..', 'datatug/datatug-demo-projects/main/demo-project-1'],
    ['../../../datatug/datatug-demo-projects/main/demo-project-1', ''],
    ['..\\..\\..\\datatug\\datatug-demo-projects\\main\\demo-project-1', ''],
    ['\t../../../datatug/datatug-demo-projects/main/demo-project-1', ''],
    ['.', ''],
    ['-', ''],
    ['a/../b', ''],
    ['a?b', ''],
    ['a#b', ''],
    ['a%2e%2e', ''],
    ['a\n', ''],
    [' a', ''],
  ])('does not trust the trusted repo with the folder %j', (folder) => {
    expect(trusted(`chinook-demo@datatug@${folder}`)).toBe(false);
    expect(trusted(`chinook-demo@datatug@${folder}@HEAD`)).toBe(false);
  });

  it('requires the store to be exactly github.com', () => {
    const id = 'datatug-demo-project@datatug@demo-project-1';
    expect(trusted(id, 'github.com')).toBe(true);
    for (const storeId of [
      'http-localhost:8989',
      'https-example.com',
      'localhost:8989',
      'firestore',
      'github',
      'GitHub.com',
      'GITHUB.COM',
      'github.com ',
      ' github.com',
      'github.com.evil.example',
      'gitlab.com',
      '',
    ]) {
      expect(trusted(id, storeId)).toBe(false);
    }
  });

  it('reads only own properties, and only strings', () => {
    expect(
      isTrustedProjectAddress(
        Object.create({
          storeId: 'github.com',
          projectId: 'chinook-demo@datatug@',
        }),
      ),
    ).toBe(false);
    expect(
      isTrustedProjectAddress(
        Object.assign(Object.create({ projectId: 'chinook-demo@datatug@' }), {
          storeId: 'github.com',
        }),
      ),
    ).toBe(false);
    for (const v of [
      undefined,
      null,
      'github.com',
      1,
      [],
      {},
      { storeId: 'github.com' },
      { projectId: 'chinook-demo@datatug@' },
    ]) {
      expect(isTrustedProjectAddress(v as never)).toBe(false);
    }
    expect(
      isTrustedProjectAddress({
        storeId: 'github.com',
        projectId: ['chinook-demo@datatug@'],
      } as never),
    ).toBe(false);
    expect(
      isTrustedProjectAddress({
        storeId: 'github.com',
        projectId: { split: () => ['chinook-demo', 'datatug', ''] },
      } as never),
    ).toBe(false);
    expect(
      isTrustedProjectAddress({ ok: false, reason: 'file-link' } as never),
    ).toBe(false);
  });
});

describe("readNewProjectFolder: the new-project form's folder field (issue #180)", () => {
  it.each([
    // [typed, folder]
    ['', 'datatug'],
    ['   ', 'datatug'],
    ['datatug', 'datatug'],
    [' demo-project-1 ', 'demo-project-1'],
    ['a/b', 'a/b'],
    ['a/b/', 'a/b'],
    ['a/b//', 'a/b'],
    ['my project', 'my project'],
    ['.hidden', '.hidden'],
    ['a..b', 'a..b'],
  ])('%j is the folder %j', (typed, folder) => {
    expect(readNewProjectFolder(typed)).toEqual({ ok: true, folder });
  });

  it.each([
    // [typed, why]
    ['/', 'leading-slash'],
    ['/datatug', 'leading-slash'],
    ['  /a', 'leading-slash'],
    ['//a', 'leading-slash'],
    ['..', 'invalid'],
    ['.', 'invalid'],
    ['../x', 'invalid'],
    ['a/../b', 'invalid'],
    ['a/./b', 'invalid'],
    ['a/..', 'invalid'],
    ['a//b', 'invalid'],
    ['a\\b', 'invalid'],
    ['..\\x', 'invalid'],
    ['-', 'invalid'],
    ['a/-/b', 'invalid'],
    ['a@b', 'invalid'],
    ['a%2e%2e', 'invalid'],
    ['a?b', 'invalid'],
    ['a#b', 'invalid'],
    ['a\u0000b', 'invalid'],
    ['a\tb', 'invalid'],
  ])('%j is refused (%s)', (typed, reason) => {
    expect(readNewProjectFolder(typed)).toEqual({ ok: false, reason });
  });

  it('treats anything that is not text as blank', () => {
    expect(readNewProjectFolder(undefined)).toEqual({
      ok: true,
      folder: 'datatug',
    });
    expect(readNewProjectFolder(42)).toEqual({ ok: true, folder: 'datatug' });
  });

  it('only ever returns a folder the reader accepts', () => {
    for (const typed of ['a', 'a/b', 'a b', '.x', 'x.', 'é']) {
      const reading = readNewProjectFolder(typed);
      expect(reading.ok).toBe(true);
      if (reading.ok) {
        expect(readGithubProjectId('r@o@' + reading.folder).ok).toBe(true);
      }
    }
  });
});

describe('formatGithubProjectApiKey (cloud wire contract)', () => {
  it.each([
    ['Repo@Owner', 'repo@owner@datatug'],
    ['Repo@Owner@datatug@working', 'repo@owner@datatug'],
    ['Repo@Owner@datatug@HEAD', 'repo@owner@datatug'],
    ['Repo@Owner@@working', 'repo@owner@'],
    ['Repo@Owner@Folder/Nested@working', 'repo@owner@Folder/Nested'],
  ])('formats %s as explicit three-part scope %s', (id, expected) => {
    const project = splitGithubProjectId(id);
    const wire = formatGithubProjectApiKey(project);
    expect(wire).toBe(expected);
    // API wire always has three parts. An empty folder preserves the prior wire; the cloud backend rejects it.
    expect(wire.split('@')).toHaveLength(3);
    expect(readGithubProjectId(wire)).toEqual({
      ok: true,
      id: { repo: 'repo', org: 'owner', folder: project.folder },
    });
  });
  it('validates project scope through the shared strict reader', () => {
    expect(() =>
      formatGithubProjectApiKey({
        repo: 'repo',
        org: 'bad_owner',
        folder: 'datatug',
      }),
    ).toThrow(GithubProjectIdError);
    expect(() =>
      formatGithubProjectApiKey({
        repo: 'repo',
        org: 'owner',
        folder: '../other',
      }),
    ).toThrow(GithubProjectIdError);
  });
  it('excludes operation refs without changing the canonical UI id formatter', () => {
    const project = {
      repo: 'Repo',
      org: 'Owner',
      folder: 'datatug',
      ref: 'working',
    };
    expect(formatGithubProjectApiKey(project)).toBe('repo@owner@datatug');
    expect(formatGithubProjectId(project)).toBe('repo@owner@datatug@working');
    expect(formatGithubProjectId({ ...project, ref: 'HEAD' })).toBe(
      'repo@owner',
    );
  });
});
