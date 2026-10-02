import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { GithubProjectIdError } from '../../../nav/github-project-address';
import {
  assertReadableGithubProjectId,
  buildGithubRawUrl,
  GITHUB_RATE_LIMIT_MESSAGE,
  GithubProjectReaderService,
  parseGithubProjectId,
} from './github-project-reader.service';

const PROJECT_ID = 'datatug-demo-projects@datatug@demo-project-1';
const TREE_URL =
  'https://api.github.com/repos/datatug/datatug-demo-projects/git/trees/main?recursive=1';

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

describe('GithubProjectReaderService', () => {
  let service: GithubProjectReaderService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(GithubProjectReaderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

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

    it('builds a project-folder-relative raw URL (branch main, exactly as before)', () => {
      expect(buildGithubRawUrl(PROJECT_ID, 'entities/Album/Album.entity.json')).toBe(
        'https://raw.githubusercontent.com/datatug/datatug-demo-projects/main/demo-project-1/entities/Album/Album.entity.json',
      );
    });

    it.each([
      // [project id, relative path, raw URL]
      ['r@o', 'datatug-project.json', 'https://raw.githubusercontent.com/o/r/main/datatug/datatug-project.json'],
      ['r@o@d', 'datatug-project.json', 'https://raw.githubusercontent.com/o/r/main/d/datatug-project.json'],
      ['r@o@a/b', 'x/y.json', 'https://raw.githubusercontent.com/o/r/main/a/b/x/y.json'],
      // An empty folder is the repo root: no doubled slash.
      ['r@o@', 'datatug-project.json', 'https://raw.githubusercontent.com/o/r/main/datatug-project.json'],
      ['chinook-demo@datatug@', 'queries/q.json', 'https://raw.githubusercontent.com/datatug/chinook-demo/main/queries/q.json'],
      // The explicit ref of a four-part id: a tag or a commit SHA.
      ['r@o@@v1.0.0', 'datatug-project.json', 'https://raw.githubusercontent.com/o/r/v1.0.0/datatug-project.json'],
      ['r@o@d@v1.0.0', 'datatug-project.json', 'https://raw.githubusercontent.com/o/r/v1.0.0/d/datatug-project.json'],
      ['r@o@d@0123456789abcdef0123456789abcdef01234567', 'p.json', 'https://raw.githubusercontent.com/o/r/0123456789abcdef0123456789abcdef01234567/d/p.json'],
      // HEAD is the default branch: no ref, so the reader's branch.
      ['r@o@d@HEAD', 'p.json', 'https://raw.githubusercontent.com/o/r/main/d/p.json'],
      ['r@o@d@', 'p.json', 'https://raw.githubusercontent.com/o/r/main/d/p.json'],
      // Lower-cased owner and repo; folder and ref keep their case.
      ['Repo@Org@Dir@Feature', 'p.json', 'https://raw.githubusercontent.com/org/repo/Feature/Dir/p.json'],
      // Every folder and file segment is encoded (the same bytes on the wire for a space or a non-ASCII letter).
      ['r@o@my dir', 'a b/é.json', 'https://raw.githubusercontent.com/o/r/main/my%20dir/a%20b/%C3%A9.json'],
      // Empty file segments are dropped, never a doubled slash.
      ['r@o@d', '/x//y.json', 'https://raw.githubusercontent.com/o/r/main/d/x/y.json'],
      ['r@o@', '', 'https://raw.githubusercontent.com/o/r/main/'],
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

  describe('a project id the reader cannot read yet', () => {
    it('refuses a four-part id (files at a ref, listing from main would be a mixed project)', () => {
      const id = 'datatug-demo-projects@datatug@demo-project-1@v1.0.0';
      expect(() => assertReadableGithubProjectId(id)).toThrow(/not supported yet/);
      for (const call of [
        () => service.getRawJson(id, 'datatug-project.json'),
        () => service.getRawText(id, 'queries/a.sql'),
        () => service.listDirectory(id, 'entities'),
      ]) {
        let error: unknown;
        call().subscribe({ error: (e: unknown) => (error = e) });
        expect(error).toBeInstanceOf(GithubProjectIdError);
        expect((error as GithubProjectIdError).reason).toBe('ref-not-supported');
      }
      // Nothing was requested.
      httpMock.expectNone(() => true);
    });

    it('refuses an invalid id with an error, not a request', () => {
      for (const id of ['abc', 'r@o@..', 'r@o@a/../b']) {
        let error: unknown;
        service.getRawJson(id, 'x.json').subscribe({ error: (e: unknown) => (error = e) });
        expect(error).toBeInstanceOf(GithubProjectIdError);
      }
      httpMock.expectNone(() => true);
    });

    it('still reads a three-part id from main, as before', () => {
      assertReadableGithubProjectId(PROJECT_ID);
      assertReadableGithubProjectId('r@o');
      assertReadableGithubProjectId('chinook-demo@datatug@');
    });
  });

  describe('listDirectory', () => {
    it('lists immediate children of a folder, files and dirs, from ONE tree fetch', () => {
      let result: { name: string; type: string }[] | undefined;
      service.listDirectory(PROJECT_ID, 'environments').subscribe((r) => (result = r));

      httpMock.expectOne(TREE_URL).flush(DEMO_TREE);

      // Sorted with `localeCompare` (case-insensitive, alphabetical) — 'local'
      // sorts before 'QA' there, unlike a naive ASCII/uppercase-first sort.
      expect(result).toEqual([
        {
          name: 'local',
          path: 'demo-project-1/environments/local',
          type: 'dir',
        },
        { name: 'QA', path: 'demo-project-1/environments/QA', type: 'dir' },
      ]);
    });

    it('reuses the cached tree for a second directory (no second HTTP call)', () => {
      service.listDirectory(PROJECT_ID, 'environments').subscribe();
      httpMock.expectOne(TREE_URL).flush(DEMO_TREE);

      let entities: { name: string }[] | undefined;
      service.listDirectory(PROJECT_ID, 'entities').subscribe((r) => (entities = r));
      httpMock.expectNone(TREE_URL);

      expect(entities?.map((e) => e.name)).toEqual([
        'Album',
        'entities-summary.json',
        'Track',
      ]);
    });

    it('resolves to an empty list for a folder this project does not have (404)', () => {
      let result: unknown[] | undefined;
      service.listDirectory(PROJECT_ID, 'widgets').subscribe((r) => (result = r));

      httpMock.expectOne(TREE_URL).flush(null, { status: 404, statusText: 'Not Found' });

      expect(result).toEqual([]);
    });

    it('surfaces a friendly message on a 403 (rate limited)', () => {
      let error: Error | undefined;
      service.listDirectory(PROJECT_ID, 'entities').subscribe({
        error: (e) => (error = e),
      });

      httpMock.expectOne(TREE_URL).flush(null, { status: 403, statusText: 'Forbidden' });

      expect(error?.message).toBe(GITHUB_RATE_LIMIT_MESSAGE);
    });
  });

  describe('getRawJson / getRawText', () => {
    it('decodes JSON on success', () => {
      let result: { id: string } | undefined;
      service
        .getRawJson<{ id: string }>(PROJECT_ID, 'datatug-project.json')
        .subscribe((r) => (result = r));

      httpMock
        .expectOne(
          'https://raw.githubusercontent.com/datatug/datatug-demo-projects/main/demo-project-1/datatug-project.json',
        )
        .flush({ id: 'datatug-demo-project' });

      expect(result).toEqual({ id: 'datatug-demo-project' });
    });

    it('resolves to undefined on 404 (never an error)', () => {
      let result: unknown = 'not-set';
      let errored = false;
      service.getRawJson(PROJECT_ID, 'entities/Missing/Missing.entity.json').subscribe({
        next: (r) => (result = r),
        error: () => (errored = true),
      });

      httpMock
        .expectOne((r) => r.url.endsWith('entities/Missing/Missing.entity.json'))
        .flush(null, { status: 404, statusText: 'Not Found' });

      expect(errored).toBe(false);
      expect(result).toBeUndefined();
    });

    it('surfaces GITHUB_RATE_LIMIT_MESSAGE on a 403', () => {
      let error: Error | undefined;
      service.getRawText(PROJECT_ID, 'queries/albums/albums_by_title.sql').subscribe({
        error: (e) => (error = e),
      });

      httpMock
        .expectOne((r) => r.url.endsWith('queries/albums/albums_by_title.sql'))
        .flush(null, { status: 403, statusText: 'Forbidden' });

      expect(error?.message).toBe(GITHUB_RATE_LIMIT_MESSAGE);
    });

    it('caches a file so a second read does not re-fetch it', () => {
      service.getRawJson(PROJECT_ID, 'datatug-project.json').subscribe();
      httpMock
        .expectOne((r) => r.url.endsWith('datatug-project.json'))
        .flush({ id: 'x' });

      service.getRawJson(PROJECT_ID, 'datatug-project.json').subscribe();
      httpMock.expectNone((r) => r.url.endsWith('datatug-project.json'));
    });
  });

  describe('getCatalogTables', () => {
    it('resolves the dbModel, then schema, then table folders into ICatalogTables', () => {
      let result: { tables: unknown[]; views: unknown[] } | undefined;
      service
        .getCatalogTables(PROJECT_ID, 'local', 'chinook-local')
        .subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url.endsWith('chinook-local.db.json'))
        .flush({ driver: 'sqlite3', dbModel: 'chinook' });
      httpMock.expectOne(TREE_URL).flush(DEMO_TREE);

      expect(result).toEqual({
        tables: [
          { schema: 'main', name: 'Album', dbType: 'BASE TABLE' },
          { schema: 'main', name: 'Artist', dbType: 'BASE TABLE' },
        ],
        views: [],
      });
    });

    it('resolves to an empty catalog when the catalog file has no dbModel', () => {
      let result: { tables: unknown[]; views: unknown[] } | undefined;
      service
        .getCatalogTables(PROJECT_ID, 'local', 'unknown-catalog')
        .subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url.endsWith('unknown-catalog.db.json'))
        .flush(null, { status: 404, statusText: 'Not Found' });

      expect(result).toEqual({ tables: [], views: [] });
    });
  });

  describe('listEntityIds', () => {
    it('lists entities/ subfolder names, not entities-summary.json', () => {
      let result: string[] | undefined;
      service.listEntityIds(PROJECT_ID).subscribe((r) => (result = r));

      httpMock.expectOne(TREE_URL).flush(DEMO_TREE);

      expect(result).toEqual(['Album', 'Track']);
    });
  });

  describe('getQueriesFolder', () => {
    it('builds the recursive folder tree, one folder per queries/ subfolder', () => {
      let result:
        | { id: string; folders?: { id: string; items?: { id: string; type: string }[] }[] }
        | undefined;
      service.getQueriesFolder(PROJECT_ID).subscribe((r) => (result = r));

      httpMock.expectOne(TREE_URL).flush(DEMO_TREE);
      // One def-file raw fetch per query item found in the tree.
      httpMock
        .expectOne((r) => r.url.endsWith('albums/albums_by_title.sql.json'))
        .flush({ title: 'Albums by title' });
      httpMock
        .expectOne((r) => r.url.endsWith('customers/customer-invoices.query.json'))
        .flush({ id: 'customer-invoices', title: 'Customer invoices', type: 'DTQL' });

      expect(result?.id).toBe('~');
      expect(result?.folders?.map((f) => f.id).sort()).toEqual(['albums', 'customers']);
      const albums = result?.folders?.find((f) => f.id === 'albums');
      // Legacy `.sql.json` (no "id" field) falls back to the filename-derived
      // bare id — `albums_by_title.sql.json` -> `albums_by_title`.
      expect(albums?.items).toEqual([
        { id: 'albums_by_title', title: 'Albums by title', type: 'SQL' },
      ]);
      const customers = result?.folders?.find((f) => f.id === 'customers');
      expect(customers?.items?.[0]).toMatchObject({
        id: 'customer-invoices',
        title: 'Customer invoices',
        type: 'DTQL',
      });
      // datatug-cli's own `all_queries` never includes the body — this
      // listing call shouldn't either (queries.service.ts's own doc
      // comment on `IWireQueryItem.text`).
      expect(customers?.items?.[0]).not.toHaveProperty('text');
    });
  });

  describe('getQuery', () => {
    it('resolves a bare id, fetching both the definition and its sidecar body', () => {
      let result: { id: string; type: string; text?: string } | undefined;
      service.getQuery(PROJECT_ID, 'customer-invoices').subscribe((r) => (result = r));

      httpMock.expectOne(TREE_URL).flush(DEMO_TREE);
      httpMock
        .expectOne((r) => r.url.endsWith('customers/customer-invoices.query.json'))
        .flush({ id: 'customer-invoices', title: 'Customer invoices', type: 'DTQL' });
      httpMock
        .expectOne((r) => r.url.endsWith('customers/customer-invoices.query.dtql'))
        .flush('from:\n  name: Invoice\n');

      expect(result).toMatchObject({
        id: 'customer-invoices',
        type: 'DTQL',
        text: 'from:\n  name: Invoice\n',
      });
    });

    it('resolves a folder-qualified id the same way', () => {
      let result: { id: string } | undefined;
      service
        .getQuery(PROJECT_ID, 'customers/customer-invoices')
        .subscribe((r) => (result = r));

      httpMock.expectOne(TREE_URL).flush(DEMO_TREE);
      httpMock
        .expectOne((r) => r.url.endsWith('customers/customer-invoices.query.json'))
        .flush({ id: 'customer-invoices', type: 'DTQL' });
      httpMock
        .expectOne((r) => r.url.endsWith('customers/customer-invoices.query.dtql'))
        .flush('body');

      expect(result?.id).toBe('customer-invoices');
    });

    it('resolves the legacy "<id>.sql.json" shape, body = def filename minus ".json"', () => {
      let result: { id: string; type: string; text?: string } | undefined;
      service.getQuery(PROJECT_ID, 'albums_by_title').subscribe((r) => (result = r));

      httpMock.expectOne(TREE_URL).flush(DEMO_TREE);
      httpMock
        .expectOne((r) => r.url.endsWith('albums/albums_by_title.sql.json'))
        .flush({ title: 'Albums by title' });
      httpMock
        .expectOne((r) => r.url.endsWith('albums/albums_by_title.sql'))
        .flush('SELECT * FROM Album');

      expect(result).toMatchObject({
        id: 'albums_by_title',
        type: 'SQL',
        text: 'SELECT * FROM Album',
      });
    });

    it('errors for an id with no matching query file (never a thrown 404 from a guessed URL)', () => {
      let error: Error | undefined;
      service.getQuery(PROJECT_ID, 'does-not-exist').subscribe({
        error: (e) => (error = e),
      });

      httpMock.expectOne(TREE_URL).flush(DEMO_TREE);

      expect(error?.message).toContain('does-not-exist');
    });
  });

  describe('getBoard', () => {
    it('injects the requested id (the file itself only has a title)', () => {
      let result: { id: string; title?: string } | undefined;
      service.getBoard(PROJECT_ID, 'board1').subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url.endsWith('boards/board1/board.json'))
        .flush({ title: '1st board' });

      expect(result).toEqual({ id: 'board1', title: '1st board' });
    });
  });
});
