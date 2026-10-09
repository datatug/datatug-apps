import { firstValueFrom } from 'rxjs';
import { TestBed } from '@angular/core/testing';

import { GithubProjectIdError } from '../../../nav/github-project-address';
import { FakeGithub, fakeSha } from './github-fake-backend.test';
import { NO_GITHUB_FILE_STORE } from './github-file-store-api';
import {
  assertReadableGithubProjectId,
  buildGithubRawUrl,
  GITHUB_CLOCK,
  GITHUB_FETCH,
  GITHUB_FILE_STORE,
  GITHUB_RATE_LIMIT_MESSAGE,
  GithubProjectReaderService,
  parseGithubProjectId,
} from './github-project-reader.service';

const PROJECT_ID = 'datatug-demo-projects@datatug@demo-project-1';
const REPO = 'datatug/datatug-demo-projects';
const SHA = fakeSha(0xa1);

// A trimmed, representative subset of demo-project-1's real tree — enough
// to exercise directory listing, catalog-tables schema/table resolution,
// and queries folder tree building.
const DEMO_TREE = {
  truncated: false,
  tree: [
    { path: 'demo-project-1/datatug-project.json', type: 'blob' },
    { path: 'demo-project-1/environments', type: 'tree' },
    { path: 'demo-project-1/environments/local', type: 'tree' },
    {
      path: 'demo-project-1/environments/local/local.env.json',
      type: 'blob',
    },
    { path: 'demo-project-1/environments/local/catalogs', type: 'tree' },
    {
      path: 'demo-project-1/environments/local/catalogs/chinook-local',
      type: 'tree',
    },
    {
      path: 'demo-project-1/environments/local/catalogs/chinook-local/chinook-local.db.json',
      type: 'blob',
    },
    { path: 'demo-project-1/environments/QA', type: 'tree' },
    { path: 'demo-project-1/environments/QA/QA.env.json', type: 'blob' },
    { path: 'demo-project-1/dbmodels', type: 'tree' },
    { path: 'demo-project-1/dbmodels/chinook', type: 'tree' },
    {
      path: 'demo-project-1/dbmodels/chinook/chinook.dbmodel.json',
      type: 'blob',
    },
    { path: 'demo-project-1/dbmodels/chinook/main', type: 'tree' },
    { path: 'demo-project-1/dbmodels/chinook/main/tables', type: 'tree' },
    {
      path: 'demo-project-1/dbmodels/chinook/main/tables/Album',
      type: 'tree',
    },
    {
      path: 'demo-project-1/dbmodels/chinook/main/tables/Album/main.Album.columns.json',
      type: 'blob',
    },
    {
      path: 'demo-project-1/dbmodels/chinook/main/tables/Artist',
      type: 'tree',
    },
    {
      path: 'demo-project-1/dbmodels/chinook/main/tables/Artist/main.Artist.columns.json',
      type: 'blob',
    },
    { path: 'demo-project-1/entities', type: 'tree' },
    { path: 'demo-project-1/entities/Album', type: 'tree' },
    { path: 'demo-project-1/entities/Album/Album.entity.json', type: 'blob' },
    { path: 'demo-project-1/entities/Track', type: 'tree' },
    { path: 'demo-project-1/entities/Track/Track.entity.json', type: 'blob' },
    { path: 'demo-project-1/entities/entities-summary.json', type: 'blob' },
    { path: 'demo-project-1/queries', type: 'tree' },
    { path: 'demo-project-1/queries/albums', type: 'tree' },
    {
      path: 'demo-project-1/queries/albums/albums_by_title.sql',
      type: 'blob',
    },
    {
      path: 'demo-project-1/queries/albums/albums_by_title.sql.json',
      type: 'blob',
    },
    { path: 'demo-project-1/queries/customers', type: 'tree' },
    {
      path: 'demo-project-1/queries/customers/customer-invoices.query.dtql',
      type: 'blob',
    },
    {
      path: 'demo-project-1/queries/customers/customer-invoices.query.json',
      type: 'blob',
    },
    { path: 'demo-project-1/boards', type: 'tree' },
    { path: 'demo-project-1/boards/board1', type: 'tree' },
    { path: 'demo-project-1/boards/board1/board.json', type: 'blob' },
  ],
};


/** The files of `DEMO_TREE`, each with `{}` unless a test gives it a body. */
function demoFiles(bodies: Record<string, string> = {}): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of DEMO_TREE.tree) {
    if (entry.type === 'blob') {
      files[entry.path] = '{}';
    }
  }
  return { ...files, ...bodies };
}

function setup(bodies: Record<string, string> = {}) {
  const gh = new FakeGithub();
  gh.addRepo(REPO, SHA, demoFiles(bodies));
  TestBed.configureTestingModule({
    providers: [
      { provide: GITHUB_FETCH, useValue: gh.fetch },
      { provide: GITHUB_CLOCK, useValue: () => 1_000_000 },
      { provide: GITHUB_FILE_STORE, useValue: NO_GITHUB_FILE_STORE },
    ],
  });
  return { gh, service: TestBed.inject(GithubProjectReaderService) };
}

const first = <T>(o: Parameters<typeof firstValueFrom<T>>[0]) => firstValueFrom(o);

describe('GithubProjectReaderService', () => {
  describe('parseGithubProjectId / buildGithubRawUrl', () => {
    it('splits repo@org@folder and defaults folder to "datatug"', () => {
      expect(parseGithubProjectId('my-repo@my-org')).toEqual({
        repo: 'my-repo',
        org: 'my-org',
        folder: 'datatug',
      });
      expect(parseGithubProjectId('my-repo@my-org@some-folder')).toEqual({
        repo: 'my-repo',
        org: 'my-org',
        folder: 'some-folder',
      });
    });

    it('builds a project-folder-relative raw URL (HEAD: the default branch, whatever it is called)', () => {
      expect(buildGithubRawUrl(PROJECT_ID, 'entities/Album/Album.entity.json')).toBe(
        'https://raw.githubusercontent.com/datatug/datatug-demo-projects/HEAD/demo-project-1/entities/Album/Album.entity.json',
      );
    });

    it.each([
      // [project id, relative path, raw URL]
      ['r@o', 'datatug-project.json', 'https://raw.githubusercontent.com/o/r/HEAD/datatug/datatug-project.json'],
      ['r@o@d', 'datatug-project.json', 'https://raw.githubusercontent.com/o/r/HEAD/d/datatug-project.json'],
      ['r@o@a/b', 'x/y.json', 'https://raw.githubusercontent.com/o/r/HEAD/a/b/x/y.json'],
      // An empty folder is the repo root: no doubled slash.
      ['r@o@', 'datatug-project.json', 'https://raw.githubusercontent.com/o/r/HEAD/datatug-project.json'],
      ['chinook-demo@datatug@', 'queries/q.json', 'https://raw.githubusercontent.com/datatug/chinook-demo/HEAD/queries/q.json'],
      // The explicit ref of a four-part id: a tag or a commit SHA.
      ['r@o@@v1.0.0', 'datatug-project.json', 'https://raw.githubusercontent.com/o/r/v1.0.0/datatug-project.json'],
      ['r@o@d@v1.0.0', 'datatug-project.json', 'https://raw.githubusercontent.com/o/r/v1.0.0/d/datatug-project.json'],
      ['r@o@d@0123456789abcdef0123456789abcdef01234567', 'p.json', 'https://raw.githubusercontent.com/o/r/0123456789abcdef0123456789abcdef01234567/d/p.json'],
      // HEAD is the default branch: no ref.
      ['r@o@d@HEAD', 'p.json', 'https://raw.githubusercontent.com/o/r/HEAD/d/p.json'],
      ['r@o@d@', 'p.json', 'https://raw.githubusercontent.com/o/r/HEAD/d/p.json'],
      // Lower-cased owner and repo; folder and ref keep their case.
      ['Repo@Org@Dir@Feature', 'p.json', 'https://raw.githubusercontent.com/org/repo/Feature/Dir/p.json'],
      // Every folder and file segment is encoded (the same bytes on the wire for a space or a non-ASCII letter).
      ['r@o@my dir', 'a b/é.json', 'https://raw.githubusercontent.com/o/r/HEAD/my%20dir/a%20b/%C3%A9.json'],
      // Empty file segments are dropped, never a doubled slash.
      ['r@o@d', '/x//y.json', 'https://raw.githubusercontent.com/o/r/HEAD/d/x/y.json'],
      ['r@o@', '', 'https://raw.githubusercontent.com/o/r/HEAD/'],
    ])('builds the raw URL of %s / %s', (projectId, relativePath, expected) => {
      expect(buildGithubRawUrl(projectId, relativePath)).toBe(expected);
    });

    it.each([
      // A folder can never reach another repo or another part of the URL.
      ['chinook-demo@datatug@../../../datatug/datatug-demo-projects/main/demo-project-1', 'folder'],
      ['chinook-demo@datatug@..\\..\\..\\datatug\\datatug-demo-projects\\main\\demo-project-1', 'folder'],
      ['chinook-demo@datatug@\t../../../evil/repo/main', 'folder'],
      ['chinook-demo@datatug@..', 'folder'],
      ['chinook-demo@datatug@.', 'folder'],
      ['chinook-demo@datatug@-', 'folder'],
      ['chinook-demo@datatug@a/./b', 'folder'],
      ['chinook-demo@datatug@a//b', 'folder'],
      ['chinook-demo@datatug@/a', 'folder'],
      ['chinook-demo@datatug@a/', 'folder'],
      ['chinook-demo@datatug@a?b', 'folder'],
      ['chinook-demo@datatug@a#b', 'folder'],
      ['chinook-demo@datatug@a%2Fb', 'folder'],
      ['chinook-demo@datatug@ a', 'folder'],
      ['chinook-demo@datatug@a\n', 'folder'],
      ['chinook-demo@datatug@\u0000', 'folder'],
      ['chinook-demo@datatug@d@a/../b', 'ref'],
      ['chinook-demo@datatug@d@..', 'ref'],
      ['chinook-demo@datatug@d@a b ', 'ref'],
      ['chinook-demo@datatug@d@a?b', 'ref'],
      ['chinook-demo@datatug@d@v1@x', 'parts'],
      ['chinook-demo', 'parts'],
      ['', 'parts'],
      ['chinook-demo@datatug@..@..@..', 'parts'],
      ['chinook-demo.git@datatug@', 'owner-or-repo'],
      ['chinook-demo@datatug/x@', 'owner-or-repo'],
      ['../x@datatug@', 'owner-or-repo'],
      ['chinook-demo@@', 'owner-or-repo'],
    ])('refuses to build a URL for the id %j (%s)', (projectId, reason) => {
      expect(() => buildGithubRawUrl(projectId, 'datatug-project.json')).toThrow(GithubProjectIdError);
      try {
        buildGithubRawUrl(projectId, 'datatug-project.json');
      } catch (e) {
        expect((e as GithubProjectIdError).reason).toBe(reason);
      }
    });

    it.each(['..', '../x', 'a/../b', 'a/..', './x', 'a/./b', '../../../evil/repo/main/x'])(
      'refuses the file path %j',
      (path) => {
        expect(() => buildGithubRawUrl('r@o@d', path)).toThrow(GithubProjectIdError);
      },
    );

    it('reads the given revision instead of HEAD or the ref', () => {
      const sha = '0123456789abcdef0123456789abcdef01234567';
      expect(buildGithubRawUrl('r@o@d', 'p.json', sha)).toBe(
        `https://raw.githubusercontent.com/o/r/${sha}/d/p.json`,
      );
      expect(buildGithubRawUrl('r@o@d@v1', 'p.json', sha)).toBe(
        `https://raw.githubusercontent.com/o/r/${sha}/d/p.json`,
      );
    });

    it('splits the optional fourth part and lower-cases owner and repo', () => {
      expect(parseGithubProjectId('r@o@')).toStrictEqual({ repo: 'r', org: 'o', folder: '' });
      expect(parseGithubProjectId('r@o@@v1')).toStrictEqual({ repo: 'r', org: 'o', folder: '', ref: 'v1' });
      expect(parseGithubProjectId('Repo@Org@Dir@v1')).toStrictEqual({
        repo: 'repo',
        org: 'org',
        folder: 'Dir',
        ref: 'v1',
      });
      expect(parseGithubProjectId('r@o@d@HEAD')).toStrictEqual({ repo: 'r', org: 'o', folder: 'd' });
    });
  });

  describe('a project id the reader reads at a ref', () => {
    // Design 4.5: files and listing both come from ONE commit, so a ref is no longer refused (G-A2 closes the
    // "mixed project" the four-part id used to be refused for).
    it('reads a four-part id at the commit it names, with no resolve call', async () => {
      const { gh, service } = setup({
        'demo-project-1/datatug-project.json': '{"id":"x"}',
      });
      const id = `${PROJECT_ID}@${SHA}`;
      expect(assertReadableGithubProjectId(id).ref).toBe(SHA);
      await first(service.getRawJson(id, 'datatug-project.json'));
      await first(service.listDirectory(id, 'entities'));
      expect(gh.urls()).toEqual([
        `https://raw.githubusercontent.com/${REPO}/${SHA}/demo-project-1/datatug-project.json`,
        `https://api.github.com/repos/${REPO}/git/trees/${SHA}?recursive=1`,
      ]);
    });

    it('resolves a branch or tag to a commit, then reads everything at it', async () => {
      const { gh, service } = setup();
      gh.push(REPO, fakeSha(0xb2), demoFiles());
      const id = `${PROJECT_ID}@main`;
      await first(service.getRawJson(id, 'datatug-project.json'));
      expect(gh.urls('api.github.com')[0]).toBe(
        `https://api.github.com/repos/${REPO}/commits/main`,
      );
      expect(gh.urls('raw.githubusercontent.com')).toEqual([
        `https://raw.githubusercontent.com/${REPO}/${fakeSha(0xb2)}/demo-project-1/datatug-project.json`,
      ]);
    });

    it('refuses an invalid id with an error, not a request', () => {
      const { gh, service } = setup();
      for (const id of ['abc', 'r@o@..', 'r@o@a/../b']) {
        let error: unknown;
        service.getRawJson(id, 'x.json').subscribe({ error: (e: unknown) => (error = e) });
        expect(error).toBeInstanceOf(GithubProjectIdError);
        let listed: unknown;
        service.listDirectory(id, 'x').subscribe({ error: (e: unknown) => (listed = e) });
        expect(listed).toBeInstanceOf(GithubProjectIdError);
      }
      expect(gh.count()).toBe(0);
    });

    it('still reads a three-part id, as before', () => {
      assertReadableGithubProjectId(PROJECT_ID);
      assertReadableGithubProjectId('r@o');
      assertReadableGithubProjectId('chinook-demo@datatug@');
    });
  });

  describe('listDirectory', () => {
    it('lists immediate children of a folder, files and dirs, from ONE tree fetch', async () => {
      const { gh, service } = setup();
      const result = await first(service.listDirectory(PROJECT_ID, 'environments'));

      // Sorted with `localeCompare` (case-insensitive, alphabetical) — 'local'
      // sorts before 'QA' there, unlike a naive ASCII/uppercase-first sort.
      expect(result).toEqual([
        { name: 'local', path: 'demo-project-1/environments/local', type: 'dir' },
        { name: 'QA', path: 'demo-project-1/environments/QA', type: 'dir' },
      ]);
      // The commit, then the listing at that commit.
      expect(gh.urls()).toEqual([
        `https://api.github.com/repos/${REPO}/commits/HEAD`,
        `https://api.github.com/repos/${REPO}/git/trees/${SHA}?recursive=1`,
      ]);
    });

    it('reuses the cached tree for a second directory (no second HTTP call)', async () => {
      const { gh, service } = setup();
      await first(service.listDirectory(PROJECT_ID, 'environments'));
      gh.reset();

      const entities = await first(service.listDirectory(PROJECT_ID, 'entities'));
      expect(gh.count()).toBe(0);
      expect(entities.map((e) => e.name)).toEqual(['Album', 'entities-summary.json', 'Track']);
    });

    it('lists a project at the repo root (an empty folder): the prefix is not "/"', async () => {
      const gh = new FakeGithub();
      gh.addRepo('datatug/chinook-demo', SHA, {
        'datatug-project.json': '{}',
        'queries/q.query.json': '{}',
        'entities/Country/Country.entity.json': '{}',
        'README.md': '',
      });
      TestBed.configureTestingModule({
        providers: [
          { provide: GITHUB_FETCH, useValue: gh.fetch },
          { provide: GITHUB_FILE_STORE, useValue: NO_GITHUB_FILE_STORE },
        ],
      });
      const service = TestBed.inject(GithubProjectReaderService);
      const id = 'chinook-demo@datatug@';

      expect(await first(service.listDirectory(id, ''))).toEqual([
        { name: 'datatug-project.json', path: 'datatug-project.json', type: 'file' },
        { name: 'entities', path: 'entities', type: 'dir' },
        { name: 'queries', path: 'queries', type: 'dir' },
        { name: 'README.md', path: 'README.md', type: 'file' },
      ]);
      expect(await first(service.listDirectory(id, 'entities'))).toEqual([
        { name: 'Country', path: 'entities/Country', type: 'dir' },
      ]);
      expect(await first(service.listEntityIds(id))).toEqual(['Country']);
      const queries = await first(service.getQueriesFolder(id));
      expect(queries.items?.map((i) => i.id)).toEqual(['q']);
    });

    it('resolves to an empty list for a folder this project does not have', async () => {
      const { service } = setup();
      expect(await first(service.listDirectory(PROJECT_ID, 'widgets'))).toEqual([]);
    });

    it('resolves to an empty list when the repository does not exist (404)', async () => {
      const { service } = setup();
      expect(await first(service.listDirectory('r@o@d', 'entities'))).toEqual([]);
    });

    it('surfaces a friendly message on a 403 of the listing (rate limited)', async () => {
      const { gh, service } = setup();
      // The commit is resolved, the listing is refused.
      gh.fail.api = (url) => (url.pathname.includes('/git/trees/') ? 403 : undefined);
      await expect(first(service.listDirectory(PROJECT_ID, 'entities'))).rejects.toThrow(
        GITHUB_RATE_LIMIT_MESSAGE,
      );
    });
  });

  describe('getRawJson / getRawText', () => {
    it('decodes JSON on success, from the pinned commit', async () => {
      const { gh, service } = setup({
        'demo-project-1/datatug-project.json': '{"id":"datatug-demo-project"}',
      });
      const result = await first(
        service.getRawJson<{ id: string }>(PROJECT_ID, 'datatug-project.json'),
      );

      expect(result).toEqual({ id: 'datatug-demo-project' });
      expect(gh.urls('raw.githubusercontent.com')).toEqual([
        `https://raw.githubusercontent.com/${REPO}/${SHA}/demo-project-1/datatug-project.json`,
      ]);
    });

    it('resolves to undefined on 404 (never an error)', async () => {
      const { service } = setup();
      expect(
        await first(service.getRawJson(PROJECT_ID, 'entities/Missing/Missing.entity.json')),
      ).toBeUndefined();
    });

    it('says so when a file is not JSON', async () => {
      const { service } = setup({ 'demo-project-1/datatug-project.json': '<html>' });
      await expect(first(service.getRawJson(PROJECT_ID, 'datatug-project.json'))).rejects.toThrow(
        /not valid JSON/,
      );
    });

    it('names the hosts when none of them answers (a 403 of the file host, the mirror down)', async () => {
      const { gh, service } = setup();
      gh.fail.raw = 403;
      gh.fail.mirror = 503;
      await expect(
        first(service.getRawText(PROJECT_ID, 'queries/albums/albums_by_title.sql')),
      ).rejects.toThrow(/raw\.githubusercontent\.com and cdn\.jsdelivr\.net did not answer/);
    });

    it('caches a file so a second read does not re-fetch it', async () => {
      const { gh, service } = setup();
      await first(service.getRawJson(PROJECT_ID, 'datatug-project.json'));
      const requests = gh.count();
      await first(service.getRawJson(PROJECT_ID, 'datatug-project.json'));
      await first(service.getRawText(PROJECT_ID, 'datatug-project.json'));
      expect(gh.count()).toBe(requests);
    });

    it('does not remember a failed read: a second try asks again', async () => {
      const { gh, service } = setup();
      gh.fail.raw = 500;
      gh.fail.mirror = 500;
      await expect(first(service.getRawText(PROJECT_ID, 'datatug-project.json'))).rejects.toThrow();
      gh.fail.raw = undefined;
      expect(await first(service.getRawText(PROJECT_ID, 'datatug-project.json'))).toBe('{}');
    });
  });

  describe('getCatalogTables', () => {
    it('resolves the dbModel, then schema, then table folders into ICatalogTables', async () => {
      const { service } = setup({
        'demo-project-1/environments/local/catalogs/chinook-local/chinook-local.db.json':
          '{"driver":"sqlite3","dbModel":"chinook"}',
      });
      const result = await first(service.getCatalogTables(PROJECT_ID, 'local', 'chinook-local'));

      expect(result).toEqual({
        tables: [
          { schema: 'main', name: 'Album', dbType: 'BASE TABLE' },
          { schema: 'main', name: 'Artist', dbType: 'BASE TABLE' },
        ],
        views: [],
      });
    });

    it('resolves to an empty catalog when the catalog file has no dbModel', async () => {
      const { service } = setup();
      expect(await first(service.getCatalogTables(PROJECT_ID, 'local', 'unknown-catalog'))).toEqual({
        tables: [],
        views: [],
      });
    });
  });

  describe('listEntityIds', () => {
    it('lists entities/ subfolder names, not entities-summary.json', async () => {
      const { service } = setup();
      expect(await first(service.listEntityIds(PROJECT_ID))).toEqual(['Album', 'Track']);
    });
  });

  describe('getQueriesFolder', () => {
    it('builds the recursive folder tree, one folder per queries/ subfolder', async () => {
      const { service } = setup({
        'demo-project-1/queries/albums/albums_by_title.sql.json': '{"title":"Albums by title"}',
        'demo-project-1/queries/customers/customer-invoices.query.json':
          '{"id":"customer-invoices","title":"Customer invoices","type":"DTQL","connectionId":"chinook-sqlite"}',
      });
      const result = await first(service.getQueriesFolder(PROJECT_ID));

      expect(result.id).toBe('~');
      expect(result.folders?.map((f) => f.id).sort()).toEqual(['albums', 'customers']);
      const albums = result.folders?.find((f) => f.id === 'albums');
      // Legacy `.sql.json` (no "id" field) falls back to the filename-derived
      // bare id — `albums_by_title.sql.json` -> `albums_by_title`.
      expect(albums?.items).toEqual([{ id: 'albums_by_title', title: 'Albums by title', type: 'SQL' }]);
      const customers = result.folders?.find((f) => f.id === 'customers');
      expect(customers?.items?.[0]).toMatchObject({
        id: 'customer-invoices',
        title: 'Customer invoices',
        type: 'DTQL',
        connectionId: 'chinook-sqlite',
      });
      // datatug-cli's own `all_queries` never includes the body — this
      // listing call shouldn't either (queries.service.ts's own doc
      // comment on `IWireQueryItem.text`).
      expect(customers?.items?.[0]).not.toHaveProperty('text');
    });
  });

  describe('getQuery', () => {
    it('reopens serialized public-data pins and federation without fetching lookup data', async () => {
      const publicData = {
        source: {
          schema: {
            repository: 'https://github.com/example/source',
            revision: 'b'.repeat(40),
            path: 'model.json',
            sha256: 'c'.repeat(64),
          },
          module: 'synthetic',
          entity: 'Customer',
          property: 'Country',
          datatype: 'string',
          namespace: 'fixture-only',
        },
        canonical: {
          directory: { revision: 'd'.repeat(40), sha256: 'e'.repeat(64) },
        },
        snapshot: { revision: 'f'.repeat(40), sha256: '1'.repeat(64) },
        eligible: false,
        unavailableReason:
          'Synthetic pending scenario, no production admission.',
      };
      const federation = {
        ovdbBaseUrl: 'https://cloud.openvaultdb.com',
        tables: [],
        bounds: { driver: { source: 'saved exact data pin' } },
      };
      const { service, gh } = setup({
        'demo-project-1/queries/customers/customer-invoices.query.json':
          JSON.stringify({
            id: 'customer-invoices',
            type: 'DTQL',
            publicData,
            federation,
          }),
        'demo-project-1/queries/customers/customer-invoices.query.dtql': '{}',
      });
      const result = await first(
        service.getQuery(PROJECT_ID, 'customers/customer-invoices'),
      );
      expect(result).toMatchObject({
        publicData,
        federation,
        type: 'DTQL',
        text: '{}',
      });
      expect(gh.requests.every((call) => !call.url.includes('/dtql'))).toBe(
        true,
      );
    });


    it('resolves a bare id, fetching both the definition and its sidecar body', async () => {
      const { service } = setup({
        'demo-project-1/queries/customers/customer-invoices.query.json':
          '{"id":"customer-invoices","title":"Customer invoices","type":"DTQL","connectionId":"chinook-sqlite"}',
        'demo-project-1/queries/customers/customer-invoices.query.dtql': 'from:\n  name: Invoice\n',
      });
      const result = await first(service.getQuery(PROJECT_ID, 'customer-invoices'));

      expect(result).toMatchObject({
        id: 'customer-invoices',
        type: 'DTQL',
        connectionId: 'chinook-sqlite',
        text: 'from:\n  name: Invoice\n',
      });
    });

    it('resolves a folder-qualified id the same way', async () => {
      const { service } = setup({
        'demo-project-1/queries/customers/customer-invoices.query.json':
          '{"id":"customer-invoices","type":"DTQL"}',
        'demo-project-1/queries/customers/customer-invoices.query.dtql': 'body',
      });
      const result = await first(service.getQuery(PROJECT_ID, 'customers/customer-invoices'));
      expect(result.id).toBe('customer-invoices');
    });

    it('resolves the legacy "<id>.sql.json" shape, body = def filename minus ".json"', async () => {
      const { service } = setup({
        'demo-project-1/queries/albums/albums_by_title.sql.json': '{"title":"Albums by title"}',
        'demo-project-1/queries/albums/albums_by_title.sql': 'SELECT * FROM Album',
      });
      const result = await first(service.getQuery(PROJECT_ID, 'albums_by_title'));

      expect(result).toMatchObject({
        id: 'albums_by_title',
        type: 'SQL',
        text: 'SELECT * FROM Album',
      });
    });

    it('errors for an id with no matching query file (never a thrown 404 from a guessed URL)', async () => {
      const { service } = setup();
      await expect(first(service.getQuery(PROJECT_ID, 'does-not-exist'))).rejects.toThrow(
        /does-not-exist/,
      );
    });
  });

  describe('getBoard', () => {
    it('injects the requested id (the file itself only has a title)', async () => {
      const { service } = setup({ 'demo-project-1/boards/board1/board.json': '{"title":"1st board"}' });
      expect(await first(service.getBoard(PROJECT_ID, 'board1'))).toEqual({
        id: 'board1',
        title: '1st board',
      });
    });
  });
});
