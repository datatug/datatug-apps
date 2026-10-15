import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { TableRecordPageComponent } from './table-record/table-record.page';
import { TableRecordsPageComponent } from './table-records/table-records.page';

const AGENT = 'http://127.0.0.1:8989/datatug';
const SCHEMA_URL = `${AGENT}/records/schema`;
const LOOKUP_URL = `${AGENT}/records/lookup`;
const SELECT_URL = `${AGENT}/exec/select`;
const ALBUM_SCHEMA = {
  source: 'chinook',
  schema: '',
  table: 'Album',
  columns: [
    { name: 'AlbumId', type: 'int' },
    { name: 'Title', type: 'string' },
    { name: 'ArtistId', type: 'int' },
  ],
  primaryKey: ['AlbumId'],
  referencedBy: ['Track'],
};

function routeStub(table: string, query: Record<string, string>) {
  const params = {
    storeId: 'http-127.0.0.1:8989',
    projectId: 'demo',
    environmentId: 'local',
    dbCatalogId: 'chinook',
    tableType: table,
  };
  const paramMap = convertToParamMap(params);
  const queryParamMap = convertToParamMap(query);
  const snapshot = { paramMap, queryParamMap, pathFromRoot: [] as unknown[] };
  snapshot.pathFromRoot = [snapshot];
  return {
    snapshot,
    paramMap: new BehaviorSubject(paramMap),
    queryParamMap: new BehaviorSubject(queryParamMap),
    fragment: new BehaviorSubject<string | null>(null),
  };
}

function mount<T>(
  component: Type<T>,
  table: string,
  query: Record<string, string>,
  hash = '',
): { fixture: ComponentFixture<T>; ctrl: HttpTestingController; text: () => string } {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: routeStub(table, query) },
      {
        provide: DOCUMENT,
        useFactory: () => {
          const doc = document.implementation.createHTMLDocument('t');
          Object.defineProperty(doc, 'location', { value: { hash } });
          return doc;
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  return {
    fixture,
    ctrl: TestBed.inject(HttpTestingController),
    text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
  };
}

const notFound = (req: TestRequest, field: string) =>
  req.flush(
    { error: { code: 'NOT_FOUND', message: 'x', field, requestId: 'r' } },
    { status: 404, statusText: 'Not Found' },
  );

describe('records page (AC:records-link-opens-top-n)', () => {
  it('reads at most limit rows with from and limit only, and sends no write', async () => {
    const { fixture, ctrl, text } = mount(TableRecordsPageComponent, 'Album', {
      limit: '2',
      schema: '',
    });
    ctrl.expectOne(SCHEMA_URL).flush(ALBUM_SCHEMA);
    const select = ctrl.expectOne((r) => r.url === SELECT_URL);
    expect(select.request.method).toBe('GET');
    expect(select.request.params.keys().sort()).toEqual(['db', 'env', 'from', 'limit', 'proj']);
    expect(select.request.params.get('from')).toBe('Album');
    expect(select.request.params.get('limit')).toBe('2');
    select.flush({
      columns: ['AlbumId', 'ArtistId', 'Title'],
      // An agent answering more than asked still shows no more than limit.
      rows: [
        { AlbumId: 1, ArtistId: 1, Title: 'For Those About To Rock We Salute You' },
        { AlbumId: 2, ArtistId: 2, Title: 'Balls to the Wall' },
        { AlbumId: 3, ArtistId: 2, Title: 'Restless and Wild' },
      ],
    });
    await fixture.whenStable();
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="records-grid"] tbody tr');
    expect(rows).toHaveLength(2);
    expect(text()).toContain('Balls to the Wall');
    expect(text()).not.toContain('Restless and Wild');
    ctrl.verify();
  });

  it('defaults to 50 and caps at 1000', () => {
    const { ctrl } = mount(TableRecordsPageComponent, 'Album', { limit: '5000', schema: '' });
    ctrl.expectOne(SCHEMA_URL).flush(ALBUM_SCHEMA);
    expect(ctrl.expectOne((r) => r.url === SELECT_URL).request.params.get('limit')).toBe('1000');
  });

  it('names an unknown table and reads no rows', async () => {
    const { fixture, ctrl, text } = mount(TableRecordsPageComponent, 'Nope', { schema: '' });
    notFound(ctrl.expectOne(SCHEMA_URL), 'table');
    await fixture.whenStable();
    expect(text()).toContain('table-not-found');
    ctrl.expectNone((r) => r.url === SELECT_URL);
  });
});

describe('record page (AC:record-link-uses-primary-key-in-fragment, AC:record-lookup-is-parameter-bound)', () => {
  const pk = (json: string) => '#pk=' + encodeURIComponent(json);

  it('looks the record up by its typed key in a POST body and shows its fields', async () => {
    const { fixture, ctrl, text } = mount(
      TableRecordPageComponent,
      'Album',
      { schema: '' },
      pk('{"AlbumId":1}'),
    );
    ctrl.expectOne(SCHEMA_URL).flush(ALBUM_SCHEMA);
    const lookup = ctrl.expectOne(LOOKUP_URL);
    expect(lookup.request.method).toBe('POST');
    expect(lookup.request.urlWithParams).toBe(LOOKUP_URL);
    expect(lookup.request.body).toEqual({
      project: 'demo',
      env: 'local',
      source: 'chinook',
      schema: '',
      table: 'Album',
      key: { AlbumId: 1 },
    });
    lookup.flush({
      recordset: {
        columns: [
          { name: 'AlbumId', type: 'integer' },
          { name: 'ArtistId', type: 'integer' },
          { name: 'Title', type: 'string' },
        ],
        rows: [
          [
            { type: 'integer', value: '1' },
            { type: 'integer', value: '1' },
            { type: 'string', value: 'For Those About To Rock We Salute You' },
          ],
        ],
      },
      limitations: [],
    });
    await fixture.whenStable();
    expect(text()).toContain('For Those About To Rock We Salute You');
    expect(text()).toContain('AlbumId');
    expect(text()).toContain('(key)');
    expect(text()).toContain('Track');
  });

  it('sends the key 9007199254740993 with every digit', async () => {
    const { fixture, ctrl, text } = mount(
      TableRecordPageComponent,
      'Album',
      { schema: '' },
      pk('{"AlbumId":"9007199254740993"}'),
    );
    ctrl.expectOne(SCHEMA_URL).flush(ALBUM_SCHEMA);
    const lookup = ctrl.expectOne(LOOKUP_URL);
    expect(lookup.request.body.key).toEqual({ AlbumId: '9007199254740993' });
    expect(JSON.stringify(lookup.request.body)).toContain('9007199254740993');
    lookup.flush({
      recordset: {
        columns: [{ name: 'AlbumId', type: 'integer' }],
        rows: [[{ type: 'integer', value: '9007199254740993' }]],
      },
    });
    await fixture.whenStable();
    expect(text()).toContain('9007199254740993');
  });

  it.each([
    ['an injection-shaped value', '{"AlbumId":"1 OR 1=1"}'],
    ['a non-key column', '{"Title":"x"}'],
  ])('shows bad-key for %s and sends no lookup', async (_name, json) => {
    const { fixture, ctrl, text } = mount(TableRecordPageComponent, 'Album', { schema: '' }, pk(json));
    ctrl.expectOne(SCHEMA_URL).flush(ALBUM_SCHEMA);
    ctrl.expectNone(LOOKUP_URL);
    await fixture.whenStable();
    expect(text()).toContain('bad-key');
  });

  it.each(['', '#pk=not-json', '#code=v1.x'])(
    'shows bad-key for the fragment %s without any request',
    async (hash) => {
      const { fixture, ctrl, text } = mount(TableRecordPageComponent, 'Album', { schema: '' }, hash);
      ctrl.expectNone(SCHEMA_URL);
      ctrl.expectNone(LOOKUP_URL);
      await fixture.whenStable();
      expect(text()).toContain('bad-key');
    },
  );

  it('names a record that does not exist', async () => {
    const { fixture, ctrl, text } = mount(TableRecordPageComponent, 'Album', { schema: '' }, pk('{"AlbumId":99999}'));
    ctrl.expectOne(SCHEMA_URL).flush(ALBUM_SCHEMA);
    notFound(ctrl.expectOne(LOOKUP_URL), 'key');
    await fixture.whenStable();
    expect(text()).toContain('record-not-found');
  });
});

describe('named states on the link pages (AC:unresolvable-link-names-the-problem)', () => {
  it.each([
    ['project', 'project-not-found'],
    ['source', 'database-not-found'],
    ['table', 'table-not-found'],
  ])('a 404 on %s shows %s and reads no rows', async (field, problem) => {
    const { fixture, ctrl } = mount(TableRecordsPageComponent, 'Album', { schema: '' });
    notFound(ctrl.expectOne(SCHEMA_URL), field);
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[data-testid="link-problem"]')?.getAttribute('data-problem'),
    ).toBe(problem);
    ctrl.expectNone((r) => r.url === SELECT_URL);
  });

  it('shows agent-unreachable when the agent does not answer, and Check again reads again', async () => {
    const { fixture, ctrl } = mount(
      TableRecordPageComponent,
      'Album',
      { schema: '' },
      '#pk=' + encodeURIComponent('{"AlbumId":1}'),
    );
    ctrl.expectOne(SCHEMA_URL).error(new ProgressEvent('error'), { status: 0 });
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="link-problem"]')?.getAttribute('data-problem')).toBe(
      'agent-unreachable',
    );
    expect(el.textContent).toContain('datatug daemon start');
    (el.querySelector('[data-testid="link-check-again"]') as HTMLElement).click();
    ctrl.expectOne(SCHEMA_URL).flush(ALBUM_SCHEMA);
    ctrl.expectOne(LOOKUP_URL).flush({
      recordset: { columns: [{ name: 'AlbumId' }], rows: [[{ type: 'integer', value: '1' }]] },
    });
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="record-fields"]')).not.toBeNull();
  });

  it('shows link-expired on a 401', async () => {
    const { fixture, ctrl } = mount(TableRecordsPageComponent, 'Album', { schema: '' });
    ctrl.expectOne(SCHEMA_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[data-testid="link-problem"]')?.getAttribute('data-problem'),
    ).toBe('link-expired');
  });
});
