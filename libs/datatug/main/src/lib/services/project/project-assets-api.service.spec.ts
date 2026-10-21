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
  it('does not retry an old Board mutation with a different current credential after401', async () => {
    const bridge = TestBed.inject(SneatApiAuthTokenBridge);
    bridge.setExplicitToken('token-A');
    const write = {
      board,
      operationId: 'sarah-board-op',
      ifMatch: 'revision-1',
    };
    const failed = vi.fn();
    const subscription = TestBed.inject(ProjectAssetsApiService)
      .saveBoard(ref, 'demo', write)
      .subscribe({ error: failed });
    const first = http.expectOne((r) => r.url.endsWith('/boards/save_board'));
    expect(first.request.headers.get('Authorization')).toBe('Bearer token-A');
    bridge.setExplicitToken('token-B');
    first.flush({}, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();
    const repeats = http.match((r) => r.url.endsWith('/boards/save_board'));
    subscription.unsubscribe();
    expect(repeats.map((r) => r.request.headers.get('Authorization'))).toEqual(
      [],
    );
    expect(failed).toHaveBeenCalledOnce();
  });
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
    request.flush(JSON.stringify(board), {
      headers: {
        ETag: '"opaque-rev"',
        'X-Datatug-Asset-Revision': 'opaque-rev',
      },
    });
    await expect(promise).resolves.toEqual({ board, revision: 'opaque-rev' });
  });
  it.each([
    '9007199254740993',
    '0.10000000000000001',
    '1.0',
    '1e2',
    '1e+21',
    '-0',
  ])(
    'refuses raw nested numeric token %s before ordinary JSON parsing can rewrite it',
    async (token) => {
      const service = TestBed.inject(ProjectAssetsApiService);
      const pending = firstValueFrom(service.board(ref, 'demo', 'shipping'));
      const rejected = expect(pending).rejects.toThrow(
        'unsupported numeric precision',
      );
      const request = http.expectOne((r) => r.url.endsWith('/boards/board'));
      expect(request.request.responseType).toBe('text');
      request.flush(
        '{"id":"shipping","title":"Shipping","parameters":[{"id":"input","type":"number","defaultValue":' +
          token +
          '}],"rows":[]}',
        { headers: { ETag: '"r"', 'X-Datatug-Asset-Revision': 'r' } },
      );
      await rejected;
    },
  );
  it('retains normal nested integer/float definitions and numeric-looking quoted strings exactly', async () => {
    const raw =
      '{"id":"shipping","title":"9007199254740993 \\"quoted\\" -0 1e2","parameters":[{"id":"input","type":"number","defaultValue":1.5}],"rows":[{"cards":[{"id":"card","title":"Query","widget":{"name":"SQL","data":{"sql":{"queryId":"q","parameters":[{"id":"value","value":7}]}}}}]}]}';
    const pending = firstValueFrom(
      TestBed.inject(ProjectAssetsApiService).board(ref, 'demo', 'shipping'),
    );
    http
      .expectOne((r) => r.url.endsWith('/boards/board'))
      .flush(raw, {
        headers: { ETag: '"r"', 'X-Datatug-Asset-Revision': 'r' },
      });
    await expect(pending).resolves.toEqual({
      board: JSON.parse(raw),
      revision: 'r',
    });
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
    await expect(promise).resolves.toEqual({
      boardId: board.id,
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
    http
      .expectOne((r) => r.url.endsWith('/boards/board'))
      .flush(JSON.stringify(board));
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
