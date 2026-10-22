import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AgentContextService } from '@sneat/datatug-semantic';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { HostedIncidentConversationComponent } from './hosted-incident-conversation.component';
import { DetectiveClientService } from './detective-client.service';
import { decodeIncidentEvent } from '../incidents/incident-client.service';
import { isHostedResolveAction } from './hosted-resolve-contract';
import type { HostedResolveAction } from './hosted-linkage.models';
import wire from './testdata/backend-resolve-complete.http.go.json';
import { restoreStorageSpies } from '../restore-storage-spies.spec-helper';

afterEach(restoreStorageSpies);

// Exact source projections/history and proof bytes; only the unit success receipt echoes the UI-generated operation ID.
const request = wire.request;
const context = {
  kind: 'cloud' as const,
  storage: 'firestore' as const,
  spaceID: request.spaceID,
  project: request.project,
  principal: request.recovery.receiptActorId,
};
const incidentRef = wire.beforeResolve.incident.ref;
type Page = {
  prepareResolve(action: HostedResolveAction): Promise<void>;
  retryCriterion(): Promise<void>;
  body: { set(value: string): void };
  send(): Promise<void>;
  reviewConflict(): Promise<void>;
  abandonPending(): void;
};
function action() {
  const {
    storage: _s,
    spaceID: _i,
    project: _p,
    operationId: _o,
    ...value
  } = structuredClone(request);
  void [_s, _i, _p, _o];
  if (!isHostedResolveAction(value)) throw new Error('Invalid source action');
  return value;
}
function requireValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required fixture value is unavailable');
  return value;
}

describe('human Resolve existing shared Incident journal and cold history', () => {
  const client = {
    projectIncident: vi.fn(),
    incidentEvents: vi.fn(),
    incidentAction: vi.fn(),
  };
  const auth = new BehaviorSubject({
    status: 'authenticated',
    user: { uid: context.principal },
  });
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    auth.next({ status: 'authenticated', user: { uid: context.principal } });
    client.projectIncident.mockReturnValue(
      of(structuredClone(wire.beforeResolve)),
    );
    client.incidentEvents.mockReturnValue(
      of({
        ...structuredClone(wire.beforeResolveEvents),
        events: wire.beforeResolveEvents.events.map(decodeIncidentEvent),
      }),
    );
    client.incidentAction.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });
  async function mount() {
    await TestBed.configureTestingModule({
      imports: [HostedIncidentConversationComponent],
      providers: [
        provideRouter([]),
        { provide: AgentContextService, useValue: {} },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentEnv: of(undefined),
            currentProject: new BehaviorSubject({
              ref: {
                storeId: context.storage,
                spaceID: context.spaceID,
                projectId: context.project,
              },
            }),
          },
        },
        { provide: DetectiveClientService, useValue: client },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(HostedIncidentConversationComponent);
    for (const [key, value] of Object.entries({
      context,
      environment: request.environment,
      incidentRef,
      canWrite: true,
      checks: [],
    }))
      f.componentRef.setInput(key, value);
    f.detectChanges();
    await f.whenStable();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).not.toContain(
        'Loading conversation…',
      ),
    );
    return f;
  }
  const page = (f: Awaited<ReturnType<typeof mount>>) =>
    f.componentInstance as unknown as Page;
  it('retains the exact run/recovery/note/sequence through a lost reply and remount, blocking competing chat', async () => {
    let f = await mount();
    await page(f).prepareResolve(action());
    expect(client.incidentAction).toHaveBeenCalledOnce();
    const original = structuredClone(
      client.incidentAction.mock.calls[0].slice(0, 3),
    );
    expect(original[1]).toEqual(action());
    expect(original[2]).toMatch(/^operation-/);
    const bytes = sessionStorage.getItem(requireValue(sessionStorage.key(0)));
    page(f).body.set('Competing draft');
    await page(f).send();
    expect(client.incidentAction).toHaveBeenCalledOnce();
    f.destroy();
    TestBed.resetTestingModule();
    f = await mount();
    await page(f).retryCriterion();
    expect(client.incidentAction.mock.calls[1].slice(0, 3)).toEqual(original);
    expect(sessionStorage.getItem(requireValue(sessionStorage.key(0)))).toBe(
      bytes,
    );
    client.incidentAction.mockImplementation((_c, _a, id) =>
      of({ ...structuredClone(wire.success), receipt: id }),
    );
    await page(f).retryCriterion();
    await f.whenStable();
    expect(sessionStorage.length).toBe(0);
    expect(f.nativeElement.textContent).toContain('Resolved by human review');
    expect(f.nativeElement.textContent).toContain(request.humanNote);
  });
  it('requires durable readback and refuses to retire a substituted acknowledgement', async () => {
    const f = await mount();
    const write = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    await page(f).prepareResolve(action());
    expect(client.incidentAction).not.toHaveBeenCalled();
    write.mockRestore();
    f.destroy();
    TestBed.resetTestingModule();
    const fresh = await mount();
    client.incidentAction.mockReturnValue(of(structuredClone(wire.success)));
    await page(fresh).prepareResolve(action());
    await fresh.whenStable();
    expect(sessionStorage.length).toBe(1);
    expect(fresh.nativeElement.textContent).not.toContain(
      'Resolved by human review',
    );
    page(fresh).body.set('Blocked');
    await page(fresh).send();
    expect(client.incidentAction).toHaveBeenCalledOnce();
  });
  it('keeps a409 intent immutable until explicit current-history review and local abandonment', async () => {
    const f = await mount();
    client.incidentAction.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );
    await page(f).prepareResolve(action());
    const original = client.incidentAction.mock.calls[0][2];
    await page(f).retryCriterion();
    expect(client.incidentAction).toHaveBeenCalledOnce();
    await page(f).reviewConflict();
    await page(f).prepareResolve(action());
    expect(client.incidentAction).toHaveBeenCalledOnce();
    page(f).abandonPending();
    await page(f).prepareResolve(action());
    expect(client.incidentAction.mock.calls[1][2]).not.toBe(original);
  });
  it('rejects a late owner acknowledgement after actor replacement while preserving the original scoped journal', async () => {
    const f = await mount(),
      reply = new Subject<unknown>();
    client.incidentAction.mockReturnValue(reply.asObservable());
    const sending = page(f).prepareResolve(action());
    const id = client.incidentAction.mock.calls[0][2];
    const key = requireValue(sessionStorage.key(0));
    const updates: unknown[] = [];
    f.componentInstance.incidentUpdated.subscribe((value) =>
      updates.push(value),
    );
    auth.next({ status: 'authenticated', user: { uid: 'another-actor' } });
    reply.next({ ...structuredClone(wire.success), receipt: id });
    reply.complete();
    await sending;
    await f.whenStable();
    expect(updates).toEqual([]);
    expect(sessionStorage.getItem(key)).toContain(id);
    expect(f.nativeElement.textContent).not.toContain(
      'Resolved by human review',
    );
  });
  it('cold-opens the exact resolved projection and chronological real event history without executing or re-aging the proof', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z'));
    client.projectIncident.mockReturnValue(
      of(structuredClone(wire.afterResolve)),
    );
    client.incidentEvents.mockReturnValue(
      of({
        ...structuredClone(wire.afterResolveEvents),
        events: wire.afterResolveEvents.events.map(decodeIncidentEvent),
      }),
    );
    const f = await mount();
    expect(f.nativeElement.textContent).toContain('Resolved by human review');
    expect(f.nativeElement.textContent).toContain(request.humanNote);
    expect(f.nativeElement.textContent).toContain('Criterion finalized');
    expect(f.nativeElement.textContent).toContain('Open retained Check run');
    expect(client.incidentAction).not.toHaveBeenCalled();
  });
});
