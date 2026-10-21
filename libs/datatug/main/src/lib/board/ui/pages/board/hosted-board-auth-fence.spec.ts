import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  TestRequest,
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import {
  AgentContextService,
  DatatugApiBaseUrl,
} from '@sneat/datatug-semantic';
import { HostedBoardWorkspaceComponent } from './hosted-board-workspace.component';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { DetectiveClientService } from '../../../../detective/detective-client.service';
import { ProjectQueryApiService } from '../../../../services/project/project-query-api.service';

describe('Hosted Board native mutation auth/scope fence', () => {
  async function mount() {
    sessionStorage.clear();
    const auth = new BehaviorSubject({
      status: 'authenticated',
      user: { uid: 'sarah' },
    });
    const project = new BehaviorSubject({
      ref: { storeId: 'firestore', spaceID: 'S1', projectId: 'training' },
    });
    const params = new BehaviorSubject(convertToParamMap({ board: 'saved' }));
    const query = new BehaviorSubject(
      convertToParamMap({ environment: 'training' }),
    );
    TestBed.configureTestingModule({
      imports: [HostedBoardWorkspaceComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: project, currentEnv: of(undefined) },
        },
        { provide: AgentContextService, useValue: {} },
        {
          provide: DetectiveClientService,
          useValue: {
            state: () =>
              of({
                environments: ['training', 'other'],
                capabilities: { canRead: true, canWrite: true },
              }),
          },
        },
        {
          provide: ProjectQueryApiService,
          useValue: { folder: () => of({ id: '~', items: [] }) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params,
            queryParamMap: query,
            snapshot: {
              paramMap: params.value,
              queryParamMap: query.value,
              data: {},
            },
          },
        },
      ],
    });
    const bridge = TestBed.inject(SneatApiAuthTokenBridge);
    bridge.setExplicitToken('token-A');
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostedBoardWorkspaceComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    let detail: TestRequest | undefined;
    await vi.waitFor(() => {
      detail = http.expectOne((r) => r.url.endsWith('/boards/board'));
    });
    if (!detail) throw new Error('Missing actual Board detail request.');
    detail.flush(JSON.stringify({ id: 'saved', title: 'Shipping', rows: [] }), {
      headers: { ETag: '"rev1"', 'X-Datatug-Asset-Revision': 'rev1' },
    });
    await vi.waitFor(() =>
      expect(fixture.componentInstance.draft()?.title).toBe('Shipping'),
    );
    fixture.componentInstance.beginEdit();
    await fixture.whenStable();
    return { auth, project, params, query, bridge, http, fixture };
  }
  it.each(['actor', 'project', 'environment', 'board'] as const)(
    'cancels token wait synchronously on actual native %s stream change',
    async (change) => {
      const f = await mount();
      f.bridge.beginAuthentication();
      const saving = f.fixture.componentInstance.save();
      f.http.expectNone((r) => r.url.endsWith('/boards/save_board'));
      if (change === 'actor')
        f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
      if (change === 'project')
        f.project.next({
          ref: { storeId: 'firestore', spaceID: 'S1', projectId: 'other' },
        });
      if (change === 'environment')
        f.query.next(convertToParamMap({ environment: 'other' }));
      if (change === 'board')
        f.params.next(convertToParamMap({ board: 'other' }));
      f.bridge.setExplicitToken('token-B');
      await saving;
      f.http.expectNone((r) => r.url.endsWith('/boards/save_board'));
      f.fixture.destroy();
      f.http.verify({ ignoreCancelled: true });
    },
  );
  it.each(['actor', 'environment', 'board'] as const)(
    'already-changed %s cannot save the old held definition before effects',
    async (change) => {
      const f = await mount();
      if (change === 'actor')
        f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
      if (change === 'environment')
        f.query.next(convertToParamMap({ environment: 'other' }));
      if (change === 'board')
        f.params.next(convertToParamMap({ board: 'other' }));
      if (change === 'actor')
        expect(f.fixture.componentInstance.scope.canWrite()).toBe(false);
      await f.fixture.componentInstance.save();
      f.http.expectNone((r) => r.url.endsWith('/boards/save_board'));
      f.fixture.destroy();
      f.http.verify({ ignoreCancelled: true });
    },
  );
  it('retains401 uncertainty and retries the exact native save only after explicit current-rights refresh', async () => {
    const f = await mount();
    const saving = f.fixture.componentInstance.save();
    const first = f.http.expectOne((r) => r.url.endsWith('/boards/save_board'));
    const body = first.request.body;
    first.flush({}, { status: 401, statusText: 'Unauthorized' });
    await saving;
    await f.fixture.whenStable();
    expect(f.fixture.componentInstance.scope.canWrite()).toBe(false);
    expect(
      Object.keys(sessionStorage).filter((key) =>
        key.startsWith('datatug:board-save:'),
      ),
    ).toHaveLength(1);
    f.http.expectNone((r) => r.url.endsWith('/boards/save_board'));
    f.fixture.componentInstance.scope.refresh();
    let detail: TestRequest | undefined;
    await vi.waitFor(() => {
      detail = f.http.expectOne((r) => r.url.endsWith('/boards/board'));
    });
    if (!detail) throw new Error('Missing current authorized Board detail.');
    detail.flush(JSON.stringify({ id: 'saved', title: 'Shipping', rows: [] }), {
      headers: { ETag: '"rev1"', 'X-Datatug-Asset-Revision': 'rev1' },
    });
    await vi.waitFor(() =>
      expect(f.fixture.componentInstance.pending()?.write.operationId).toBe(
        body.operationId,
      ),
    );
    const retrying = f.fixture.componentInstance.save();
    const retry = f.http.expectOne((r) => r.url.endsWith('/boards/save_board'));
    expect(retry.request.body).toEqual(body);
    retry.flush({
      board: { id: 'saved' },
      revision: 'rev2',
      receipt: body.operationId,
    });
    await vi.waitFor(() => {
      detail = f.http.expectOne((r) => r.url.endsWith('/boards/board'));
    });
    if (!detail)
      throw new Error('Missing fresh Board after acknowledged retry.');
    detail.flush(JSON.stringify({ id: 'saved', title: 'Shipping', rows: [] }), {
      headers: { ETag: '"rev2"', 'X-Datatug-Asset-Revision': 'rev2' },
    });
    await retrying;
    expect(f.fixture.componentInstance.notice()).toBe('Board saved.');
    f.fixture.destroy();
    f.http.verify({ ignoreCancelled: true });
  });
  it('clears protected definition journal on actual403 revocation', async () => {
    const f = await mount();
    const saving = f.fixture.componentInstance.save();
    f.http
      .expectOne((r) => r.url.endsWith('/boards/save_board'))
      .flush({}, { status: 403, statusText: 'Forbidden' });
    await saving;
    await f.fixture.whenStable();
    expect(f.fixture.componentInstance.scope.canWrite()).toBe(false);
    expect(
      Object.keys(sessionStorage).filter((key) =>
        key.startsWith('datatug:board-save:'),
      ),
    ).toHaveLength(0);
    f.fixture.destroy();
    f.http.verify({ ignoreCancelled: true });
  });
  it('destruction cancels a pending native token wait', async () => {
    const f = await mount();
    const readiness = f.bridge.beginAuthentication();
    const saving = f.fixture.componentInstance.save();
    f.fixture.destroy();
    readiness.resolve('token-A');
    await saving;
    f.http.expectNone((r) => r.url.endsWith('/boards/save_board'));
    f.http.verify({ ignoreCancelled: true });
  });
  it('cancels in-flight HTTP on an actor change before any401 can replay it', async () => {
    const f = await mount();
    const saving = f.fixture.componentInstance.save();
    const first = f.http.expectOne((r) => r.url.endsWith('/boards/save_board'));
    f.auth.next({ status: 'authenticated', user: { uid: 'maya' } });
    f.bridge.setExplicitToken('token-B');
    expect(first.cancelled).toBe(true);
    expect(() =>
      first.flush({}, { status: 401, statusText: 'Unauthorized' }),
    ).toThrow(/cancelled/);
    await saving;
    f.http.expectNone((r) => r.url.endsWith('/boards/save_board'));
    f.fixture.destroy();
    f.http.verify({ ignoreCancelled: true });
  });
});
