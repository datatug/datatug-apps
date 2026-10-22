import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';
import type { ProjectCard } from '@datatug/board-models';
import { firstValueFrom, of } from 'rxjs';
import { IProjectRef } from '../core/project-context';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { GITHUB_READ_ONLY_MESSAGE } from '../services/repo/store-api.service';
import {
  CardNotFoundError,
  ProjectCardsService,
  validBrief,
} from './project-cards.service';

const customer: ProjectCard = {
  id: 'customer',
  title: 'Customer',
  parameters: [
    {
      id: 'customerId',
      type: 'string',
      isRequired: true,
      match: [{ column: 'CustomerID' }],
    },
  ],
  widget: {
    name: 'fields',
    data: { source: { queryId: 'customers/by-id' } },
  },
};
const local: IProjectRef = { storeId: 'localhost:8989', projectId: 'demo' };
const hostedRef: IProjectRef = {
  storeId: 'firestore',
  spaceID: 'space',
  projectId: 'training',
};
const params = (req: { request: { params: { keys(): string[]; get(k: string): string | null } } }) =>
  Object.fromEntries(
    req.request.params.keys().map((k) => [k, req.request.params.get(k)]),
  );

describe('ProjectCardsService: local agent', () => {
  let http: HttpTestingController;
  let service: ProjectCardsService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ProjectCardsService);
  });
  afterEach(() => http.verify());

  it('lists through /cards/all_cards, drops invalid rows, sorts and caches the list', async () => {
    const first = firstValueFrom(service.listCards(local));
    const req = http.expectOne((r) => r.url.endsWith('/datatug/cards/all_cards'));
    expect(req.request.method).toBe('GET');
    expect(params(req)).toEqual({ project: 'demo' });
    req.flush([
      { id: 'zeta', title: 'Zeta' },
      { id: '../bad', title: 'Bad' },
      {
        id: 'customer',
        title: 'Customer',
        parameters: [
          { id: 'customerId', type: 'string', isRequired: true, match: [{ column: 'CustomerID' }, { entity: 7 }] },
        ],
      },
    ]);
    const rows = await first;
    expect(rows.map((r) => r.id)).toEqual(['customer', 'zeta']);
    // malformed match list is dropped from the row, the row itself stays
    expect(rows[0].parameters?.[0].match).toBeUndefined();
    // second subscription is served from the cache: no new request
    expect(await firstValueFrom(service.listCards(local))).toBe(rows);
  });

  it('reads a card through /cards/card and validates it', async () => {
    const p = firstValueFrom(service.getCard(local, 'customer'));
    const req = http.expectOne((r) => r.url.endsWith('/datatug/cards/card'));
    expect(params(req)).toEqual({ project: 'demo', id: 'customer' });
    req.flush(customer);
    expect((await p).id).toBe('customer');
  });

  it('rejects an invalid card body and an identity mismatch', async () => {
    const bad = firstValueFrom(service.getCard(local, 'customer'));
    http.expectOne((r) => r.url.endsWith('/cards/card')).flush({ ...customer, extra: 1 });
    await expect(bad).rejects.toThrow();
    const mismatch = firstValueFrom(service.getCard(local, 'other'));
    http.expectOne((r) => r.url.endsWith('/cards/card')).flush(customer);
    await expect(mismatch).rejects.toThrow('identity mismatch');
  });

  it('maps a 404 to CardNotFoundError and does not cache the failure', async () => {
    const miss = firstValueFrom(service.getCard(local, 'gone'));
    http.expectOne((r) => r.url.endsWith('/cards/card')).flush('no', { status: 404, statusText: 'Not Found' });
    await expect(miss).rejects.toBeInstanceOf(CardNotFoundError);
    const again = firstValueFrom(service.getCard(local, 'gone'));
    http.expectOne((r) => r.url.endsWith('/cards/card')).flush(customer, { status: 200, statusText: 'OK' });
    await expect(again).rejects.toThrow();
  });

  it('creates, saves and deletes through /cards/*, invalidating the cached list on every write', async () => {
    const list = () => {
      const p = firstValueFrom(service.listCards(local));
      http.expectOne((r) => r.url.endsWith('/cards/all_cards')).flush([]);
      return p;
    };
    await list();
    await firstValueFrom(service.listCards(local)); // cached: no request

    const created = firstValueFrom(service.createCard(local, customer));
    const create = http.expectOne((r) => r.url.endsWith('/datatug/cards/create_card'));
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(customer);
    expect(params(create)).toEqual({ project: 'demo' });
    create.flush({});
    await created;
    await list(); // invalidated

    const saved = firstValueFrom(service.saveCard(local, customer));
    const save = http.expectOne((r) => r.url.endsWith('/datatug/cards/save_card'));
    expect(save.request.method).toBe('PUT');
    save.flush({});
    await saved;
    await list();

    const removed = firstValueFrom(service.deleteCard(local, 'customer'));
    const del = http.expectOne((r) => r.url.endsWith('/datatug/cards/delete_card'));
    expect(del.request.method).toBe('DELETE');
    expect(params(del)).toEqual({ project: 'demo', id: 'customer' });
    del.flush({});
    await removed;
    await list();
  });

  it('refuses invalid ids and cards before any request', async () => {
    await expect(firstValueFrom(service.createCard(local, { ...customer, id: '../x' }))).rejects.toThrow();
    await expect(firstValueFrom(service.deleteCard(local, 'a/b'))).rejects.toThrow('Invalid card id');
    await expect(firstValueFrom(service.getCard(local, 'a/b'))).rejects.toThrow('Invalid card id');
  });
});

describe('ProjectCardsService: hosted shared-asset API', () => {
  let http: HttpTestingController;
  let service: ProjectCardsService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
      ],
    });
    TestBed.inject(SneatApiAuthTokenBridge).setExplicitToken('token');
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ProjectCardsService);
  });
  afterEach(() => http.verify());

  it('lists with the space/project/environment scope', async () => {
    const p = firstValueFrom(service.listCards(hostedRef, 'demo'));
    const req = http.expectOne((r) => r.url.endsWith('/datatug/cards/all_cards'));
    expect(params(req)).toEqual({
      storage: 'firestore',
      spaceID: 'space',
      project: 'training',
      environment: 'demo',
    });
    req.flush([{ id: 'customer', title: 'Customer' }]);
    expect((await p)[0].id).toBe('customer');
  });

  it('reads with revision headers and saves with If-Match, then rolls the revision forward', async () => {
    const read = firstValueFrom(service.getCard(hostedRef, 'customer', 'demo'));
    const get = http.expectOne((r) => r.url.endsWith('/datatug/cards/card'));
    expect(params(get)).toMatchObject({ id: 'customer', environment: 'demo' });
    get.flush(JSON.stringify(customer), {
      headers: { 'X-Datatug-Asset-Revision': 'r1', ETag: '"r1"' },
    });
    expect((await read).id).toBe('customer');

    const saved = firstValueFrom(service.saveCard(hostedRef, customer, 'demo'));
    const save = http.expectOne((r) => r.url.endsWith('/datatug/cards/save_card'));
    expect(save.request.body).toMatchObject({ ifMatch: 'r1', card: { id: 'customer' } });
    expect(save.request.body.ifNoneMatch).toBeUndefined();
    save.flush({ receipt: save.request.body.operationId, revision: 'r2', card: { id: 'customer' } });
    await saved;

    const again = firstValueFrom(service.saveCard(hostedRef, customer, 'demo'));
    const second = http.expectOne((r) => r.url.endsWith('/datatug/cards/save_card'));
    expect(second.request.body.ifMatch).toBe('r2');
    second.flush({ receipt: second.request.body.operationId, revision: 'r3', card: { id: 'customer' } });
    await again;
  });

  it('creates with If-None-Match, blocks saving an unread card and refuses delete', async () => {
    const created = firstValueFrom(service.createCard(hostedRef, customer, 'demo'));
    const req = http.expectOne((r) => r.url.endsWith('/datatug/cards/save_card'));
    expect(req.request.body.ifNoneMatch).toBe(true);
    expect(req.request.body.ifMatch).toBeUndefined();
    req.flush({ receipt: req.request.body.operationId, revision: 'r1', card: { id: 'customer' } });
    await created;
    await expect(
      firstValueFrom(service.saveCard(hostedRef, { ...customer, id: 'fresh' }, 'demo')),
    ).rejects.toThrow('Reload the card');
    await expect(firstValueFrom(service.deleteCard(hostedRef, 'customer', 'demo'))).rejects.toThrow('not available');
  });

  it('rejects a card with a missing revision header', async () => {
    const read = firstValueFrom(service.getCard(hostedRef, 'customer', 'demo'));
    http.expectOne((r) => r.url.endsWith('/datatug/cards/card')).flush(JSON.stringify(customer));
    await expect(read).rejects.toThrow('revision header is missing');
  });
});

describe('ProjectCardsService: GitHub reader (read-only)', () => {
  const ghRef: IProjectRef = { storeId: 'github.com', projectId: 'datatug/demo-project' };
  const files: Record<string, unknown> = {
    'cards/customer/card.json': customer,
    'cards/flat.card.json': { ...customer, id: 'flat', title: 'Flat' },
    'cards/both/card.json': { ...customer, id: 'both', title: 'Folder wins' },
    'cards/both.card.json': { ...customer, id: 'both', title: 'Flat loses' },
    'cards/broken/card.json': { nonsense: true },
  };
  let reader: { listDirectory: ReturnType<typeof vi.fn>; getRawJson: ReturnType<typeof vi.fn> };
  let service: ProjectCardsService;
  beforeEach(() => {
    reader = {
      listDirectory: vi.fn(() =>
        of([
          { name: 'customer', path: 'cards/customer', type: 'dir' },
          { name: 'both', path: 'cards/both', type: 'dir' },
          { name: 'broken', path: 'cards/broken', type: 'dir' },
          { name: 'flat.card.json', path: 'cards/flat.card.json', type: 'file' },
          { name: 'both.card.json', path: 'cards/both.card.json', type: 'file' },
          { name: 'README.md', path: 'cards/README.md', type: 'file' },
        ]),
      ),
      getRawJson: vi.fn((_project: string, path: string) => of(files[path])),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: GithubProjectReaderService, useValue: reader },
      ],
    });
    service = TestBed.inject(ProjectCardsService);
  });

  it('lists folder and flat cards (folder wins), skipping broken files', async () => {
    const rows = await firstValueFrom(service.listCards(ghRef));
    expect(rows.map((r) => [r.id, r.title])).toEqual([
      ['customer', 'Customer'],
      ['flat', 'Flat'],
      ['both', 'Folder wins'],
    ]);
    expect(rows.find((r) => r.id === 'customer')?.parameters?.[0].match).toEqual([{ column: 'CustomerID' }]);
  });

  it('reads folder card, flat card, and reports a missing one', async () => {
    expect((await firstValueFrom(service.getCard(ghRef, 'customer'))).title).toBe('Customer');
    expect((await firstValueFrom(service.getCard(ghRef, 'flat'))).title).toBe('Flat');
    expect((await firstValueFrom(service.getCard(ghRef, 'both'))).title).toBe('Folder wins');
    await expect(firstValueFrom(service.getCard(ghRef, 'nope'))).rejects.toBeInstanceOf(CardNotFoundError);
    await expect(firstValueFrom(service.getCard(ghRef, 'broken'))).rejects.toThrow();
  });

  it('refuses every write', async () => {
    for (const call of [
      service.createCard(ghRef, customer),
      service.saveCard(ghRef, customer),
      service.deleteCard(ghRef, 'customer'),
    ])
      await expect(firstValueFrom(call)).rejects.toThrow(GITHUB_READ_ONLY_MESSAGE);
  });
});

describe('ProjectCardsService: qualified common API (read-only)', () => {
  it('reads through ProjectQueryApiService and refuses writes', async () => {
    const qualified = {
      cards: vi.fn(() => of([{ id: 'customer', title: 'Customer' }])),
      card: vi.fn(() => of(customer)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ProjectQueryApiService, useValue: qualified },
      ],
    });
    const service = TestBed.inject(ProjectCardsService);
    const ref: IProjectRef = { storeId: 'github.com', projectId: 'a/b', projectApi: 'cloud', branch: 'main' };
    expect((await firstValueFrom(service.listCards(ref)))[0].id).toBe('customer');
    expect((await firstValueFrom(service.getCard(ref, 'customer'))).id).toBe('customer');
    expect(qualified.card).toHaveBeenCalledWith(ref, 'customer');
    await expect(firstValueFrom(service.saveCard(ref, customer))).rejects.toThrow('read-only');
  });
});

describe('validBrief', () => {
  it('defaults the title to the id and rejects non-objects', () => {
    expect(validBrief({ id: 'a' })?.title).toBe('a');
    expect(validBrief(null)).toBeUndefined();
    expect(validBrief({ id: 'a b' })).toBeUndefined();
  });
});

describe('ProjectCardsService: write capabilities', () => {
  let service: ProjectCardsService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProjectCardsService);
  });
  it('writes and deletes on a local agent', () => {
    expect(service.canWrite(local)).toBe(true);
    expect(service.canDelete(local)).toBe(true);
  });
  it('writes but cannot delete in a shared cloud project', () => {
    expect(service.canWrite(hostedRef)).toBe(true);
    expect(service.canDelete(hostedRef)).toBe(false);
  });
  it('is read-only for GitHub and qualified projects', () => {
    const github: IProjectRef = { storeId: 'github.com', projectId: 'a@b@' };
    const qualified: IProjectRef = { ...local, projectApi: 'cloud' };
    for (const ref of [github, qualified]) {
      expect(service.canWrite(ref)).toBe(false);
      expect(service.canDelete(ref)).toBe(false);
    }
  });
});
