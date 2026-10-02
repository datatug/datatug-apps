import { describe, expect, it } from 'vitest';
import {
  asciiLowerCase,
  formatGithubProjectId,
  isTrustedGithubProject,
  isTrustedGithubProjectId,
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

describe('isTrustedGithubProject (design 3.6)', () => {
  it.each<[string, { owner: string; repo: string; ref?: string }]>([
    ['the demo repo with no tree', { owner: 'datatug', repo: 'chinook-demo' }],
    ['tree/HEAD', { owner: 'datatug', repo: 'chinook-demo', ref: 'HEAD' }],
    ['mixed case owner and repo', { owner: 'Datatug', repo: 'Chinook-Demo' }],
    [
      'upper case, tree/HEAD',
      { owner: 'DATATUG', repo: 'CHINOOK-DEMO', ref: 'HEAD' },
    ],
  ])('trusts %s', (_name, address) => {
    expect(isTrustedGithubProject(address)).toBe(true);
  });

  it.each<[string, { owner: string; repo: string; ref?: string }]>([
    ['a tag', { owner: 'datatug', repo: 'chinook-demo', ref: 'v1.0.0' }],
    [
      'the default branch by its name',
      { owner: 'datatug', repo: 'chinook-demo', ref: 'main' },
    ],
    [
      'another branch',
      { owner: 'datatug', repo: 'chinook-demo', ref: 'feature-x' },
    ],
    [
      'a 40-character SHA',
      { owner: 'datatug', repo: 'chinook-demo', ref: SHA },
    ],
    [
      'a 40-character SHA, upper case',
      { owner: 'datatug', repo: 'chinook-demo', ref: SHA.toUpperCase() },
    ],
    [
      '"head" (a branch may be called that)',
      { owner: 'datatug', repo: 'chinook-demo', ref: 'head' },
    ],
    ['"Head"', { owner: 'datatug', repo: 'chinook-demo', ref: 'Head' }],
    ['an empty ref', { owner: 'datatug', repo: 'chinook-demo', ref: '' }],
    [
      '"HEAD " with a space',
      { owner: 'datatug', repo: 'chinook-demo', ref: 'HEAD ' },
    ],
    ['another owner, same repo', { owner: 'someone', repo: 'chinook-demo' }],
    [
      'another owner, same repo, tree/HEAD',
      { owner: 'someone', repo: 'chinook-demo', ref: 'HEAD' },
    ],
    [
      'the same owner, another repo',
      { owner: 'datatug', repo: 'datatug-demo-projects' },
    ],
    [
      'a repo that begins with the trusted one',
      { owner: 'datatug', repo: 'chinook-demo-x' },
    ],
    ['a look-alike repo', { owner: 'datatug', repo: 'chinook-demo-evil' }],
    [
      'an owner that begins with the trusted one',
      { owner: 'datatug-x', repo: 'chinook-demo' },
    ],
    [
      'a repo that ends with the trusted one',
      { owner: 'datatug', repo: 'x-chinook-demo' },
    ],
    [
      'an owner that ends with the trusted one',
      { owner: 'x-datatug', repo: 'chinook-demo' },
    ],
    ['the repo with .git', { owner: 'datatug', repo: 'chinook-demo.git' }],
    [
      'the repo with a trailing slash',
      { owner: 'datatug', repo: 'chinook-demo/' },
    ],
    ['the repo with a path', { owner: 'datatug', repo: 'chinook-demo/evil' }],
    [
      'owner and repo joined',
      { owner: 'datatug/chinook-demo', repo: 'chinook-demo' },
    ],
    [
      'owner/repo spelled in the owner',
      { owner: 'datatug/chinook-demo', repo: '' },
    ],
    ['a space around the repo', { owner: 'datatug', repo: ' chinook-demo' }],
    ['a newline after the repo', { owner: 'datatug', repo: 'chinook-demo\n' }],
    ['a NUL after the repo', { owner: 'datatug', repo: 'chinook-demo\u0000' }],
    [
      'an encoded slash left in the repo',
      { owner: 'datatug', repo: 'chinook-demo%2Fevil' },
    ],
    [
      'an encoded name left in the owner',
      { owner: 'datatu%67', repo: 'chinook-demo' },
    ],
    [
      'the Kelvin sign for k in "chinook"',
      { owner: 'datatug', repo: 'chinooK-demo' },
    ],
    ['a Cyrillic "с" for "c"', { owner: 'datatug', repo: 'сhinook-demo' }],
    ['a Cyrillic "а" in "datatug"', { owner: 'dаtatug', repo: 'chinook-demo' }],
    ['a Greek omicron for "o"', { owner: 'datatug', repo: 'chinοok-demo' }],
    ['a full-width repo', { owner: 'datatug', repo: 'ｃhinook-demo' }],
    [
      'a zero-width space inside the repo',
      { owner: 'datatug', repo: 'chinook​-demo' },
    ],
    ['a non-breaking hyphen', { owner: 'datatug', repo: 'chinook‑demo' }],
    [
      'a dotless i in the owner (case folding)',
      { owner: 'datatugı', repo: 'chinook-demo' },
    ],
    ['an empty owner and repo', { owner: '', repo: '' }],
  ])('does not trust %s', (_name, address) => {
    expect(isTrustedGithubProject(address)).toBe(false);
  });

  it('is false for anything that is not a parsed address', () => {
    expect(isTrustedGithubProject(undefined as never)).toBe(false);
    expect(isTrustedGithubProject(null as never)).toBe(false);
    expect(isTrustedGithubProject({} as never)).toBe(false);
    expect(isTrustedGithubProject({ owner: 'datatug' } as never)).toBe(false);
    expect(isTrustedGithubProject({ owner: 1, repo: 2 } as never)).toBe(false);
    expect(isTrustedGithubProject('datatug/chinook-demo' as never)).toBe(false);
  });
});

describe('isTrustedGithubProjectId', () => {
  it.each([
    ['chinook-demo@datatug@', true],
    ['chinook-demo@datatug@@HEAD', true],
    ['Chinook-Demo@Datatug@', true],
    ['chinook-demo@datatug@@v1.0.0', false],
    ['chinook-demo@datatug@@main', false],
    [`chinook-demo@datatug@@${SHA}`, false],
    ['chinook-demo-x@datatug@', false],
    ['chinook-demo@datatug-x@', false],
    ['chinook-demo@someone@', false],
    ['chinook-demo.git@datatug@', false],
    ['chinook-demo@datatug@@HEAD@extra', false],
    ['chinook-demo@datatug@a@b@c', false],
    ['chinook-demo', false],
    ['', false],
  ])('%s is %s', (id, expected) => {
    expect(isTrustedGithubProjectId(id)).toBe(expected);
  });

  it('is false for a non-string', () => {
    expect(isTrustedGithubProjectId(undefined as never)).toBe(false);
  });
});
