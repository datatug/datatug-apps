import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { QuickSearchPageComponent } from './quick-search-page.component';
import { QuickSearchApiService } from './quick-search-api.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { ProjectService } from '../services/project/project.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { QueriesService } from '../queries/queries.service';
import { QuickSearchSnapshotService } from './quick-search-snapshot.service';

const model = {
  id: 'shop',
  title: 'Shop database',
  schemas: [
    {
      id: 'dbo',
      tables: [
        {
          name: 'Customers',
          tags: ['customer'],
          Columns: [{ name: 'ID', tags: ['key'], dbType: 'secret-type' }],
        },
      ],
    },
  ],
};
function setup(
  files: Record<string, unknown>,
  fail?: string,
  moveOnRead = false,
) {
  let epoch = 0;
  const directory = vi.fn((_project: string, path: string) => {
    if (path === fail) return throwError(() => new Error('read failed'));
    const children = new Map<string, string>();
    for (const file of Object.keys(files)) {
      if (!file.startsWith(path + '/')) continue;
      const rest = file.slice(path.length + 1),
        slash = rest.indexOf('/');
      children.set(
        slash < 0 ? rest : rest.slice(0, slash),
        slash < 0 ? 'file' : 'dir',
      );
    }
    return of(
      [...children].map(([name, type]) => ({
        name,
        type,
        path: path + '/' + name,
      })),
    );
  });
  TestBed.configureTestingModule({
    providers: [
      {provide:QuickSearchApiService,useValue:{}},
      {
        provide: ProjectService,
        useValue: { watchProjectSummary: () => of({ id: 'p' }) },
      },
      {
        provide: QueriesService,
        useValue: { getQueriesFolder: () => of({ id: '~', items: [] }) },
      },
      { provide: ProjectQueryApiService, useValue: {} },
      {
        provide: GithubProjectReaderService,
        useValue: {
          readInfo: () => of({ commit: 'a'.repeat(40) }),
          visitEpoch: () => String(epoch),
          listDirectory: directory,
          getRawJson: (_project: string, path: string) => {
            if (moveOnRead) epoch++;
            return path === fail
              ? throwError(() => new Error('read failed'))
              : of(files[path]);
          },
        },
      },
    ],
  });
  return {
    preview: () =>
      TestBed.inject(QuickSearchSnapshotService).preview({
        storeId: 'github.com',
        projectId: 'repo@owner@',
        branch: 'main',
      }),
    directory,
  };
}
describe('Quick Search schema file layouts', () => {
  it.each(['dbmodels/shop.dbmodel.json', 'dbmodels/shop/shop.dbmodel.json'])(
    'projects inline metadata at %s',
    async (path) => {
      const snapshot = await setup({ [path]: model }).preview();
      expect(
        snapshot.documents.map((d) => [d.kind, d.name, d.sourceName]),
      ).toEqual([
        ['table', 'Customers', 'Shop database'],
        ['column', 'ID', 'Shop database'],
      ]);
      expect(snapshot.documents[1].reference).toEqual({
        dbModelId: 'shop',
        schema: 'dbo',
        table: 'Customers',
        column: 'ID',
      });
      expect(JSON.stringify(snapshot)).not.toContain('secret-type');
      expect(
        snapshot.sourceCoverage.find((c) => c.kind === 'table')?.status,
      ).toBe('complete');
    },
  );
  it('does not manufacture complete zero coverage after a schema read failure', async () => {
    const snapshot = await setup(
      { 'dbmodels/shop.dbmodel.json': model },
      'dbmodels/shop.dbmodel.json',
    ).preview();
    expect(snapshot.documents).toEqual([]);
    for (const kind of ['table', 'column', 'view'])
      expect(
        snapshot.sourceCoverage.find((c) => c.kind === kind),
      ).toMatchObject({ status: 'unavailable', count: 0 });
  });
});

describe('schema layout conflict and coverage boundaries', () => {
  const split = {
    'dbmodels/shop/dbo/tables/Customers/dbo.Customers.columns.json': {
      columns: [{ name: 'ID', tags: ['key'] }],
      tags: ['customer'],
    },
  };
  it('preserves actual split Chinook layout identities even with a titled descriptor', async () => {
    const snapshot = await setup({
      ...split,
      'dbmodels/shop/shop.dbmodel.json': {
        id: 'shop',
        title: 'Friendly title',
      },
    }).preview();
    expect(snapshot.documents.map((d) => [d.id, d.sourceName])).toEqual([
      ['shop/dbo/table/Customers', 'shop'],
      ['shop/dbo/table/Customers/ID', 'shop'],
    ]);
  });
  it('unions different models and deduplicates identical flat and nested inline models', async () => {
    const snapshot = await setup({
      'dbmodels/shop.dbmodel.json': model,
      'dbmodels/shop/shop.dbmodel.json': model,
      'dbmodels/other.dbmodel.json': { ...model, id: 'other' },
    }).preview();
    expect(snapshot.documents).toHaveLength(4);
  });
  it('chooses split canonical metadata when full sets agree except sourceName', async () => {
    const snapshot = await setup({
      ...split,
      'dbmodels/shop/shop.dbmodel.json': model,
    }).preview();
    expect(snapshot.documents).toHaveLength(2);
    expect(snapshot.documents.every((d) => d.sourceName === 'shop')).toBe(true);
  });
  it('combines real Chinook split paths with another inline model without changing split identity', async () => {
    const snapshot = await setup({
      'dbmodels/chinook/chinook.dbmodel.json': {
        id: 'chinook',
        title: 'Chinook',
      },
      'dbmodels/chinook/main/tables/Album/main.Album.columns.json': {
        columns: [{ name: 'AlbumId' }, { name: 'Title' }],
      },
      'dbmodels/shop.dbmodel.json': model,
    }).preview();
    expect(snapshot.documents).toHaveLength(5);
    expect(snapshot.documents.find((d) => d.name === 'Album')).toMatchObject({
      id: 'chinook/main/table/Album',
      sourceName: 'chinook',
      reference: { dbModelId: 'chinook', schema: 'main', table: 'Album' },
    });
  });
  it('retains unavailable coverage on refresh after a previously successful inline read disappears', async () => {
    const files: Record<string, unknown> = {
      'dbmodels/shop.dbmodel.json': model,
    };
    const reader = setup(files);
    expect(
      (await reader.preview()).sourceCoverage.find((c) => c.kind === 'table'),
    ).toMatchObject({ status: 'complete', count: 1 });
    files['dbmodels/shop.dbmodel.json'] = undefined;
    const refresh = await reader.preview();
    expect(refresh.documents).toEqual([]);
    expect(
      refresh.sourceCoverage.find((c) => c.kind === 'table'),
    ).toMatchObject({ status: 'unavailable', count: 0 });
  });
  it('preserves inline title exactly including surrounding spaces', async () => {
    const snapshot = await setup({
      'dbmodels/shop.dbmodel.json': { ...model, title: ' Chinook ' },
    }).preview();
    expect(snapshot.documents.every((d) => d.sourceName === ' Chinook ')).toBe(
      true,
    );
  });
  it.each([
    { 'dbmodels/shop.dbmodel.json': { ...model, id: 'wrong' } },
    { 'dbmodels/shop.dbmodel.json': { ...model, schemas: null } },
    { 'dbmodels/shop.dbmodel.json': { id: 'shop' } },
    { 'dbmodels/shop/shop.dbmodel.json': { id: 'shop' } },
    { 'dbmodels/shop.dbmodel.json': undefined },
    {'dbmodels/shop.dbmodel.json':model,'dbmodels/shop/shop.dbmodel.json':{id:'shop'}},
    {'dbmodels/shop/unrecognized/file.json':{}},
    {
      'dbmodels/shop.dbmodel.json': {
        ...model,
        schemas: [
          { id: 'dbo', tables: [{ name: 'Customers', Columns: [{}] }] },
        ],
      },
    },
    {
      'dbmodels/shop.dbmodel.json': model,
      'dbmodels/shop/shop.dbmodel.json': { ...model, title: 'Different' },
    },
    { ...split, 'dbmodels/shop.dbmodel.json': { ...model, schemas: [] } },
    {
      ...split,
      'dbmodels/shop.dbmodel.json': {
        ...model,
        schemas: [
          {
            id: 'dbo',
            tables: [{ name: 'Customers', Columns: [{ name: 'ID' }] }],
          },
        ],
      },
    },
  ])(
    'fails the whole category for invalid or conflicting representation %#',
    async (files) => {
      const snapshot = await setup(files).preview();
      expect(snapshot.documents).toEqual([]);
      expect(
        snapshot.sourceCoverage.find((c) => c.kind === 'table'),
      ).toMatchObject({ status: 'unavailable', count: 0 });
    },
  );
  it.each([{}, { 'dbmodels/shop.dbmodel.json': { id: 'shop', schemas: [] } }])(
    'allows verified empty inventory %#',
    async (files) => {
      const snapshot = await setup(files).preview();
      expect(snapshot.documents).toEqual([]);
      expect(
        snapshot.sourceCoverage.find((c) => c.kind === 'table'),
      ).toMatchObject({ status: 'complete', count: 0 });
    },
  );
});

describe('inline schema navigation and snapshot consistency', () => {
  it('aborts the entire accumulated preview when the reader visit changes during file reads', async () => {
    await expect(
      setup({ 'dbmodels/shop.dbmodel.json': model }, undefined, true).preview(),
    ).rejects.toThrow('changed during preview');
  });
  it('reuses a schema detail route with real inline snapshot projection for table and column navigation', async () => {
    setup({ 'dbmodels/shop.dbmodel.json': model });
    const params = new BehaviorSubject(
      convertToParamMap({ dbModelId: 'shop' }),
    );
    const query = new BehaviorSubject(
      convertToParamMap({ schema: 'dbo', table: 'Customers' }),
    );
    TestBed.configureTestingModule({
      imports: [QuickSearchPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { schemaDetail: true },
              paramMap: params.value,
              queryParamMap: query.value,
            },
            paramMap: params,
            queryParamMap: query,
          },
        },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: of({ status: 'authenticated', user: { uid: 'actor' } }),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of({
              ref: {
                storeId: 'github.com',
                projectId: 'repo@owner@',
                branch: 'main',
              },
            }),
          },
        },
        {
          provide: QuickSearchApiService,
          useValue: {
            status: () =>
              of({ state: 'disabled', canManage: true, eligible: true }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(QuickSearchPageComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance.items().map((d) => d.name)).toEqual([
      'Customers',
      'ID',
    ]);
    query.next(
      convertToParamMap({ schema: 'dbo', table: 'Customers', column: 'ID' }),
    );
    await fixture.whenStable();
    expect(fixture.componentInstance.items().map((d) => d.name)).toEqual([
      'ID',
    ]);
    expect(fixture.componentInstance.items()[0].sourceName).toBe(
      'Shop database',
    );
    params.next(convertToParamMap({ dbModelId: 'unknown' }));
    await fixture.whenStable();
    expect(fixture.componentInstance.items()).toEqual([]);
  });
});

describe('split schema empty-directory sentinel parity',()=>{
  it('ignores only an explicit .gitkeep file in a verified tables/views inventory',async()=>{
    const snapshot=await setup({'dbmodels/shop/dbo/tables/Customers/dbo.Customers.columns.json':{columns:[]},'dbmodels/shop/dbo/views/.gitkeep':''}).preview();
    expect(snapshot.sourceCoverage.find(c=>c.kind==='view')).toMatchObject({status:'complete',count:0});
    expect(snapshot.sourceCoverage.find(c=>c.kind==='table')).toMatchObject({status:'complete',count:1});
  });
  it('keeps an unknown schema inventory file unavailable',async()=>{
    const snapshot=await setup({'dbmodels/shop/dbo/views/unknown.json':{}}).preview();
    expect(snapshot.sourceCoverage.find(c=>c.kind==='view')).toMatchObject({status:'unavailable',count:0});
  });
});
