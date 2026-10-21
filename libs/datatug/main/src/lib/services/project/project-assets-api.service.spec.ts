import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';
import { firstValueFrom } from 'rxjs';
import { ProjectAssetsApiService } from './project-assets-api.service';
const ref = { storeId: 'firestore', spaceID: 'space', projectId: 'training' };
const board = { id: 'shipping', title: 'Shipping', rows: [] };
describe('ProjectAssetsApiService', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
      ],
    });
    TestBed.inject(SneatApiAuthTokenBridge).setExplicitToken(
      'actual-test-token',
    );
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('qualifies authenticated board reads with Space/project/environment and retains the opaque revision', async () => {
    const promise = firstValueFrom(
      TestBed.inject(ProjectAssetsApiService).board(ref, 'demo', 'shipping'),
    );
    const request = http.expectOne((r) => r.url.endsWith('/boards/board'));
    expect(request.request.headers.get('Authorization')).toBe(
      'Bearer actual-test-token',
    );
    expect(
      Object.fromEntries(
        request.request.params
          .keys()
          .map((key) => [key, request.request.params.get(key)]),
      ),
    ).toEqual({
      storage: 'firestore',
      spaceID: 'space',
      project: 'training',
      environment: 'demo',
      id: 'shipping',
    });
    request.flush(board, {
      headers: {
        ETag: '"opaque-rev"',
        'X-Datatug-Asset-Revision': 'opaque-rev',
      },
    });
    await expect(promise).resolves.toEqual({ board, revision: 'opaque-rev' });
  });
  it('posts only the scoped canonical definition and exact condition/operation, retaining receipts', async () => {
    const write = { operationId: 'operation-one', ifMatch: 'old-rev', board };
    const promise = firstValueFrom(
      TestBed.inject(ProjectAssetsApiService).saveBoard(ref, 'demo', write),
    );
    const request = http.expectOne(
      'https://datatug.test/v0/datatug/boards/save_board',
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toEqual({
      storage: 'firestore',
      spaceID: 'space',
      project: 'training',
      environment: 'demo',
      ...write,
    });
    request.flush({ board, revision: 'new-rev', receipt: 'operation-one' });
    await expect(promise).resolves.toMatchObject({
      revision: 'new-rev',
      receipt: 'operation-one',
    });
  });
  it('denies missing environment before network and rejects missing/mismatched revision or receipt', async () => {
    const service = TestBed.inject(ProjectAssetsApiService);
    await expect(
      firstValueFrom(service.board(ref, '', 'shipping')),
    ).rejects.toThrow('Choose');
    http.expectNone((r) => r.url.includes('/boards/'));
    const pending = firstValueFrom(service.board(ref, 'demo', 'shipping'));
    const rejected = expect(pending).rejects.toThrow('revision');
    http.expectOne((r) => r.url.endsWith('/boards/board')).flush(board);
    await rejected;
    const write = {
      operationId: 'original',
      ifNoneMatch: true as const,
      board,
    };
    const saved = firstValueFrom(service.saveBoard(ref, 'demo', write));
    const invalid = expect(saved).rejects.toThrow('receipt');
    http
      .expectOne((r) => r.url.endsWith('/boards/save_board'))
      .flush({ board, revision: 'r', receipt: 'foreign' });
    await invalid;
  });
});
