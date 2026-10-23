// The api.github.com budget of a GitHub project read: how many calls each user action costs, and that the signed-in
// user's token goes with them (to api.github.com only). Anonymous access is 60 calls an hour per address.
import { firstValueFrom } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { GithubDefaultBranchLookup } from '../../../routes/github-project-address-check';
import { FakeGithub, fakeSha } from './github-fake-backend.test';
import { NO_GITHUB_FILE_STORE } from './github-file-store-api';
import { GITHUB_API_HOST, GITHUB_RAW_HOST, githubGet } from './github-http';
import {
  GITHUB_CLOCK,
  GITHUB_FETCH,
  GITHUB_FILE_STORE,
  GithubProjectReaderService,
} from './github-project-reader.service';
import {
  GITHUB_TOKEN_STORAGE_KEY,
  GITHUB_USER_TOKEN,
  readGithubUserToken,
} from './github-user-token';

const REPO = 'datatug/datatug-demo-project';
const SHA = fakeSha(0xb2);
const PROJECT_ID = 'datatug-demo-project@datatug@demo-project-1';
const FILES = {
  'demo-project-1/datatug-project.json': '{"id":"demo"}',
  'demo-project-1/queries/albums/albums.sql': 'select 1',
  'demo-project-1/boards/board1/board.json': '{}',
};

function authorization(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.['Authorization'];
}

function setup(token?: string) {
  const gh = new FakeGithub();
  gh.addRepo(REPO, SHA, FILES);
  TestBed.configureTestingModule({
    providers: [
      { provide: GITHUB_FETCH, useValue: gh.fetch },
      { provide: GITHUB_CLOCK, useValue: () => 1_000_000 },
      { provide: GITHUB_FILE_STORE, useValue: NO_GITHUB_FILE_STORE },
      { provide: GITHUB_USER_TOKEN, useValue: () => token },
    ],
  });
  return { gh, reader: TestBed.inject(GithubProjectReaderService) };
}

describe('api.github.com budget of a project read', () => {
  it('a project load costs 2 calls: the commit and one listing, every file from the file host', async () => {
    const { gh, reader } = setup();
    await firstValueFrom(reader.listDirectory(PROJECT_ID, ''));
    await firstValueFrom(reader.listDirectory(PROJECT_ID, 'queries'));
    await firstValueFrom(reader.getRawJson(PROJECT_ID, 'datatug-project.json'));
    expect(gh.urls(GITHUB_API_HOST)).toEqual([
      `https://api.github.com/repos/${REPO}/commits/HEAD`,
      `https://api.github.com/repos/${REPO}/git/trees/${SHA}?recursive=1`,
    ]);
    expect(gh.count(GITHUB_RAW_HOST)).toBe(1);
  });

  it('the complete inventory (quick search) after the listing costs no further call', async () => {
    const { gh, reader } = setup();
    await firstValueFrom(reader.listDirectory(PROJECT_ID, ''));
    await firstValueFrom(
      reader.listDirectory(PROJECT_ID, 'queries', { requireComplete: true }),
    );
    expect(gh.count(GITHUB_API_HOST)).toBe(2);
  });

  it('concurrent listings of one commit, from two addresses of it, share one call', async () => {
    const { gh, reader } = setup();
    await firstValueFrom(reader.listDirectory(PROJECT_ID, '')); // resolves HEAD to SHA
    gh.reset();
    const pinned = `datatug-demo-project@datatug@@${SHA}`;
    const other = `datatug-demo-project@datatug@demo-project-1@${SHA}`;
    await Promise.all([
      firstValueFrom(reader.listDirectory(pinned, '')),
      firstValueFrom(reader.listDirectory(other, 'queries')),
      firstValueFrom(reader.listDirectory(other, '', { requireComplete: true })),
    ]);
    // A listing at a commit is kept for the page: the HEAD session already read it.
    expect(gh.count(GITHUB_API_HOST)).toBe(0);
  });

  it('two sessions starting at once at a commit nobody has read yet make one listing call', async () => {
    const { gh, reader } = setup();
    const a = `datatug-demo-project@datatug@@${SHA}`;
    const b = `datatug-demo-project@datatug@demo-project-1@${SHA}`;
    await Promise.all([
      firstValueFrom(reader.listDirectory(a, '')),
      firstValueFrom(reader.listDirectory(b, '')),
    ]);
    expect(gh.urls(GITHUB_API_HOST)).toEqual([
      `https://api.github.com/repos/${REPO}/git/trees/${SHA}?recursive=1`,
    ]);
  });

  it('sends the signed-in token to api.github.com only, never to the file host', async () => {
    const { gh, reader } = setup('gho_user');
    await firstValueFrom(reader.listDirectory(PROJECT_ID, ''));
    await firstValueFrom(reader.getRawJson(PROJECT_ID, 'datatug-project.json'));
    const api = gh.requests.filter((r) => r.host === GITHUB_API_HOST);
    const raw = gh.requests.filter((r) => r.host === GITHUB_RAW_HOST);
    expect(api).toHaveLength(2);
    expect(api.every((r) => authorization(r.init) === 'Bearer gho_user')).toBe(true);
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.every((r) => authorization(r.init) === undefined)).toBe(true);
    expect(gh.requests.every((r) => r.init.credentials === 'omit')).toBe(true);
  });

  it('makes anonymous calls when nobody is signed in', async () => {
    const { gh, reader } = setup(undefined);
    await firstValueFrom(reader.listDirectory(PROJECT_ID, ''));
    expect(gh.requests.every((r) => authorization(r.init) === undefined)).toBe(true);
  });
});

describe('githubGet with a token', () => {
  const ok = () => new Response('abc', { status: 200 });

  it('adds the token for api.github.com and not for the other hosts', async () => {
    const fetchFn = vi.fn(async () => ok());
    await githubGet(fetchFn, 'https://api.github.com/repos/o/r', { maxBytes: 10, token: 't1' });
    await githubGet(fetchFn, 'https://raw.githubusercontent.com/o/r/HEAD/a', { maxBytes: 10, token: 't1' });
    await githubGet(fetchFn, 'https://cdn.jsdelivr.net/gh/o/r/a', { maxBytes: 10, token: 't1' });
    const inits = fetchFn.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1]);
    expect(inits.map(authorization)).toEqual(['Bearer t1', undefined, undefined]);
  });

  it('retries once anonymously when GitHub refuses the token (401)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad credentials', { status: 401 }))
      .mockResolvedValueOnce(ok());
    const out = await githubGet(fetchFn, 'https://api.github.com/repos/o/r', { maxBytes: 10, token: 'stale' });
    expect(out).toEqual({ kind: 'ok', text: 'abc', bytes: 3 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(authorization(fetchFn.mock.calls[1][1])).toBeUndefined();
  });

  it('keeps a 401 without a token as an outage, in one call', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 401 }));
    expect(await githubGet(fetchFn, 'https://api.github.com/repos/o/r', { maxBytes: 10 })).toEqual({ kind: 'down', status: 401 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('readGithubUserToken', () => {
  it('reads the token this tab keeps, and nothing when there is none', () => {
    expect(readGithubUserToken()).toBeUndefined();
    sessionStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, 'gho_tab');
    expect(readGithubUserToken()).toBe('gho_tab');
    sessionStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
  });
});

describe('the default-branch lookup of an address check', () => {
  it('asks once per repository and sends the signed-in token', async () => {
    const gh = new FakeGithub();
    gh.addRepo(REPO, SHA, FILES);
    TestBed.configureTestingModule({
      providers: [
        { provide: GITHUB_FETCH, useValue: gh.fetch },
        { provide: GITHUB_USER_TOKEN, useValue: () => 'gho_user' },
      ],
    });
    const lookup = TestBed.inject(GithubDefaultBranchLookup);
    await Promise.all([lookup.lookup('datatug', 'datatug-demo-project'), lookup.lookup('datatug', 'datatug-demo-project')]);
    await lookup.lookup('datatug', 'datatug-demo-project');
    expect(gh.count(GITHUB_API_HOST)).toBe(1);
    expect(authorization(gh.requests[0].init)).toBe('Bearer gho_user');
  });
});
