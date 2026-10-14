import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { SneatApiNotAuthenticatedError } from '@sneat/api';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, Subject } from 'rxjs';
import { SessionContextApiService } from './session-context-api.service';
import { ContextCapabilities } from './session-context-contract';
import { LegacyContextImportService } from './legacy-context-import.service';
import { SessionWorkspaceShellComponent } from './session-workspace-shell.component';
import { SESSION_DEVICE_DRAFTS, SessionWorkspaceService } from './session-workspace.service';

describe('SessionWorkspaceShellComponent auth lifecycle', () => {
  let fixture: ComponentFixture<SessionWorkspaceShellComponent>;
  let authState: BehaviorSubject<{ status: string; user?: { uid: string } }>;
  let api: { capabilities: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };
  const caps: ContextCapabilities = {
    schemaVersion: 1,
    actorId: 'actor-1',
    databaseId: 'ops',
    projectId: 'shop',
    environments: [],
    actions: ['createSession'],
  };
  const projectUrl = '/project/http-localhost:8989/shop/tree/HEAD/demo/-/sessions';

  beforeEach(async () => {
    authState = new BehaviorSubject({ status: 'notAuthenticated' });
    api = {
      capabilities: vi.fn()
        .mockRejectedValueOnce(SneatApiNotAuthenticatedError)
        .mockResolvedValue(caps),
      list: vi.fn(async () => ({ items: [], hasMore: false })),
    };
    const params = new BehaviorSubject(convertToParamMap({ storeId: 'http-localhost:8989', projectId: 'shop' }));
    const query = new BehaviorSubject(convertToParamMap({}));
    const route = {
      paramMap: params.asObservable(),
      queryParamMap: query.asObservable(),
      snapshot: { paramMap: params.value, queryParamMap: query.value },
    };
    const routerEvents = new Subject<unknown>();
    const router = {
      url: projectUrl,
      events: routerEvents.asObservable(),
      routerState: { snapshot: { root: { paramMap: convertToParamMap({}), firstChild: null } } },
    };

    await TestBed.configureTestingModule({
      imports: [SessionWorkspaceShellComponent],
      providers: [
        SessionWorkspaceService,
        { provide: SessionContextApiService, useValue: { ...api, read: vi.fn(), command: vi.fn(), operation: vi.fn(), run: vi.fn() } },
        { provide: SESSION_DEVICE_DRAFTS, useValue: { read: vi.fn(), write: vi.fn(), readPending: vi.fn(), writePending: vi.fn(), removePending: vi.fn() } },
        { provide: LegacyContextImportService, useValue: {} },
        { provide: SneatAuthStateService, useValue: { authState: authState.asObservable() } },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
      ],
    }).overrideComponent(SessionWorkspaceShellComponent, { set: { template: '' } }).compileComponents();
    fixture = TestBed.createComponent(SessionWorkspaceShellComponent);
    fixture.detectChanges();
  });

  it('refreshes capabilities after sign-in while the Sessions URL stays unchanged', async () => {
    const workspace = TestBed.inject(SessionWorkspaceService);
    await fixture.whenStable();
    expect(api.capabilities).toHaveBeenCalledTimes(1);
    expect(workspace.authRequired()).toBe(true);
    expect(workspace.capabilities()).toBeUndefined();
    expect(fixture.componentInstance.signInReturnTo()).toBe(projectUrl);

    authState.next({ status: 'authenticated', user: { uid: 'actor-1' } });
    await vi.waitFor(() => expect(workspace.capabilities()).toEqual(caps));
    await fixture.whenStable();

    expect(api.capabilities).toHaveBeenCalledTimes(2);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(workspace.authRequired()).toBe(false);
    expect(workspace.capabilities()).toEqual(caps);
    expect(workspace.sessions()).toEqual([]);
  });
});
