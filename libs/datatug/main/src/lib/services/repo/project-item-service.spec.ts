import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Firestore } from 'firebase/firestore';
import { SneatApiServiceFactory } from '@sneat/api';
import { IProjItemBrief } from '../../models/definition/project';
import { StoreApiService } from './store-api.service';
import { ProjectItemService } from './project-item-service';

// REQ: a saved query's id may be folder-qualified (`customers/customer-invoices`,
// per `queries/applicable`'s `Candidate.queryId` contract, datatug-cli#219). The
// server (`GET /queries/get_query?...&query=<id>`) needs the literal `/` in that
// id to reach it — it is not itself a path segment, this is a query-STRING value,
// so it must not be percent-encoded away. This test locks down that Angular's
// default `HttpParams`/`HttpUrlEncodingCodec` behavior (a documented quirk: it
// un-escapes `%2F` back to a literal `/`, see angular/angular#11058) is in fact
// what `ProjectItemService.getProjItem` gets when passed a plain params object —
// i.e. no extra encoding/decoding is needed in this service for it to work.
describe('ProjectItemService — folder-qualified id in getProjItem', () => {
  let service: ProjectItemService<IProjItemBrief>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        StoreApiService,
        { provide: SneatApiServiceFactory, useValue: {} },
      ],
    });
    const storeApiService = TestBed.inject(StoreApiService);
    httpMock = TestBed.inject(HttpTestingController);
    service = new ProjectItemService(
      {} as Firestore,
      storeApiService,
      'queries',
      'query',
    );
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('sends a folder-qualified id as a literal, unescaped slash in the query string', () => {
    let result: IProjItemBrief | undefined;
    service
      .getProjItem(
        { storeId: 'localhost:8989', projectId: 'demo-project' },
        'customers/customer-invoices',
      )
      .subscribe((r) => (result = r));

    const req = httpMock.expectOne((r) =>
      r.url.endsWith('/datatug/queries/get_query'),
    );
    expect(req.request.method).toBe('GET');
    // The literal (un-percent-encoded) id — this is the exact string the server
    // must receive for `get_query`/fsQueriesStore.LoadQuery to split on `/` and
    // resolve the folder.
    expect(req.request.params.get('query')).toBe('customers/customer-invoices');
    // The actual bytes that go over the wire: confirms the `/` isn't turned into
    // `%2F` by HttpParams' default codec — it stays a literal `/` inside the
    // query component, valid per RFC 3986.
    expect(req.request.urlWithParams).toContain(
      'query=customers/customer-invoices',
    );
    expect(req.request.urlWithParams).not.toContain('%2F');

    const fixture: IProjItemBrief = { id: 'customer-invoices', title: 'x' };
    req.flush(fixture);
    expect(result).toEqual(fixture);
  });

  it('sends a bare id unchanged (existing behavior, unaffected)', () => {
    service
      .getProjItem(
        { storeId: 'localhost:8989', projectId: 'demo-project' },
        'customer-purchases-by-genre',
      )
      .subscribe();

    const req = httpMock.expectOne((r) =>
      r.url.endsWith('/datatug/queries/get_query'),
    );
    expect(req.request.params.get('query')).toBe('customer-purchases-by-genre');
    req.flush({ id: 'customer-purchases-by-genre' });
  });
});

// S174 — datatug-cli v0.24.0 (api-contract.md PR #55) adds `?root=personal`
// to `GET /datatug/queries/all_queries`. These pin down the actual bytes
// `ProjectItemService.getFolder()` puts on the wire: a `root: 'personal'`
// argument adds exactly one `root=personal` query param; omitting it (what
// every pre-v0.24.0 caller, and this app's own "Shared" tab, already did)
// sends no `root` param at all — byte-identical to before this fix, so an
// old agent (any store, not just pre-v0.24.0 datatug-cli) never sees a
// request shape it hasn't always accepted.
describe('ProjectItemService.getFolder — root=personal wire param (S174)', () => {
  let service: ProjectItemService<IProjItemBrief>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        StoreApiService,
        { provide: SneatApiServiceFactory, useValue: {} },
      ],
    });
    const storeApiService = TestBed.inject(StoreApiService);
    httpMock = TestBed.inject(HttpTestingController);
    service = new ProjectItemService(
      {} as Firestore,
      storeApiService,
      'queries',
      'query',
    );
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('root: "personal" adds root=personal to the outgoing request', () => {
    service
      .getFolder(
        { storeId: 'localhost:8989', projectId: 'demo-project' },
        '~',
        'personal',
      )
      .subscribe();

    const req = httpMock.expectOne((r) =>
      r.url.endsWith('/datatug/queries/all_queries'),
    );
    expect(req.request.params.get('root')).toBe('personal');
    expect(req.request.params.get('project')).toBe('demo-project');
    expect(req.request.params.get('folder')).toBe('~');
    req.flush({ id: 'user:admin' });
  });

  it('an omitted root sends no root param — byte-identical to before this fix', () => {
    service
      .getFolder({ storeId: 'localhost:8989', projectId: 'demo-project' }, '~')
      .subscribe();

    const req = httpMock.expectOne((r) =>
      r.url.endsWith('/datatug/queries/all_queries'),
    );
    expect(req.request.params.has('root')).toBe(false);
    req.flush({ id: '~' });
  });
});
