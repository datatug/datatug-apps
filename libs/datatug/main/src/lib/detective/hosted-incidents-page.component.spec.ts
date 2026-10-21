import { ComponentFixture, TestBed } from '@angular/core/testing';
import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AgentContextService } from '@sneat/datatug-semantic';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DetectiveClientService } from './detective-client.service';
import { HostedIncidentsPageComponent } from './hosted-incidents-page.component';

const ref = { storeId: 'firestore', spaceID: 'private-space', projectId: 'private-project' };
const incident = {
  ref: { storeId: 'detective-incidents-9c561d36', incidentId: 'INC-1' },
  uid: 'INC-1', title: 'Order 11039 is missing', status: 'open',
  description: 'Customer reported a missing order.', canonicalContext: {}, lastSeq: 1,
};
const caseRecord = {
  id: 'incident-case-1', title: 'Investigate Order 11039', status: 'active' as const,
  version: 1, context: {}, incidentRefs: ['detective-incidents-9c561d36/INC-1'],
  scenarioRefs: [], runRefs: [], evidence: [], findings: [], timeline: [],
};

describe('HostedIncidentsPageComponent', () => {
  const client = {
    state: vi.fn(), incidentEvents: vi.fn(), projectIncidents: vi.fn(), projectIncident: vi.fn(), incidentAction: vi.fn(),
  };
  const router = { events: of(), navigate: vi.fn().mockResolvedValue(true), navigateByUrl: vi.fn().mockResolvedValue(true) };
  let routeParams$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let queryParams$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  async function mount(mode: 'list' | 'new' | 'detail', cases = [caseRecord], requestedEnvironment = 'demo', canWrite = true, projectRef = ref, draft = '', initialIncidents = [incident]) {
    const project = new BehaviorSubject({ ref: projectRef });
    const authState = new BehaviorSubject({ status: 'authenticated', user: { uid: 'sarah' } });
    client.incidentEvents.mockReturnValue(of({ events: [], nextAfterSeq: 1, hasMore: false }));
    client.state.mockReturnValue(of({ environments: ['demo'], cases, capabilities: { canWrite } }));
    client.projectIncidents.mockReturnValue(of({ incidents: initialIncidents }));
    client.projectIncident.mockReturnValue(of({ incident }));
    const data = { incidentMode: mode };
    const params = convertToParamMap(mode === 'detail' ? {
      incidentStoreId: incident.ref.storeId, incidentId: incident.ref.incidentId,
    } : {});
    routeParams$ = new BehaviorSubject(params);
    const queryParams = convertToParamMap({ environment: requestedEnvironment, ...(draft ? { draft } : {}) });
    queryParams$ = new BehaviorSubject(queryParams);
    await TestBed.configureTestingModule({
      imports: [HostedIncidentsPageComponent],
      providers: [
        { provide: DetectiveClientService, useValue: client },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: {
          snapshot: { data, paramMap: params, queryParamMap: queryParams },
          data: of(data), paramMap: routeParams$.asObservable(), queryParamMap: queryParams$.asObservable(),
        } },
        { provide: DatatugNavContextService, useValue: {
          currentProject: project.asObservable(), currentEnv: of(undefined),
        } },
        { provide: SneatAuthStateService, useValue: { authState: authState.asObservable() } },
        { provide: AgentContextService, useValue: {} },
      ],
    }).compileComponents();
    const fixture: ComponentFixture<HostedIncidentsPageComponent> = TestBed.createComponent(HostedIncidentsPageComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    router.navigate.mockResolvedValue(true);
    router.navigateByUrl.mockResolvedValue(true);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });


  it('offers the shared landing only for an empty hosted list', async () => {
    const fixture = await mount('list', [], 'demo', true, ref, '', []);
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain('Try a test incident'));
    expect(fixture.nativeElement.textContent).toContain('Report an incident');
    expect(client.incidentAction).not.toHaveBeenCalled();
  });

  it('lets the user edit a test draft and only creates on explicit submission', async () => {
    const fixture = await mount('new', [], 'demo', true, ref, 'test');
    const page = fixture.componentInstance as unknown as {
      title: { set(value: string): void; (): string };
      description: { set(value: string): void };
      create(): Promise<void>;
    };
    expect(page.title()).toBe('[Test] Investigate a delayed delivery');
    expect(fixture.nativeElement.textContent).toContain('editable example');
    expect(client.incidentAction).not.toHaveBeenCalled();
    page.title.set('[Test] Edited title');
    page.description.set('Edited observation');
    client.incidentAction.mockReturnValue(of({ incident }));
    await page.create();
    expect(client.incidentAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cloud' }), expect.objectContaining({ title: '[Test] Edited title', description: 'Edited observation', environment: 'demo' }), expect.any(String), expect.any(AbortSignal));
    expect(router.navigate).toHaveBeenCalledWith([expect.stringContaining('/incidents/detective-incidents-9c561d36/INC-1')], { queryParams: { environment: 'demo' }, replaceUrl: true });
  });
  it('clears canceled sample text and preserves an unsaved hosted draft on query changes', async () => {
    const fixture = await mount('new', [], 'demo', true, ref, 'test');
    const page = fixture.componentInstance as unknown as {
      title: { set(value: string): void; (): string };
      description: { (): string };
      cancelDraft(): void;
    };
    page.cancelDraft();
    fixture.componentInstance.ionViewWillEnter();
    expect(page.title()).toBe('[Test] Investigate a delayed delivery');
    page.cancelDraft();
    queryParams$.next(convertToParamMap({ environment: 'demo' }));
    await fixture.whenStable();
    expect(page.title()).toBe('');
    expect(page.description()).toBe('');
    page.title.set('Unsaved hosted report');
    queryParams$.next(convertToParamMap({ environment: 'demo', draft: 'test' }));
    await fixture.whenStable();
    expect(page.title()).toBe('Unsaved hosted report');
    expect(client.incidentAction).not.toHaveBeenCalled();
  });

  it('lists private Incidents after the scoped backend responds, with a route to create', async () => {
    const pending = new Subject<{ incidents: typeof incident[] }>();
    const fixture = await mount('list');
    client.projectIncidents.mockReturnValue(pending.asObservable());
    (fixture.componentInstance as unknown as { retryLoad(): void }).retryLoad();
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain('Loading Incidents'));
    await vi.waitFor(() => expect(client.projectIncidents).toHaveBeenCalledTimes(2));
    pending.next({ incidents: [incident] });
    pending.complete();
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain('Order 11039 is missing'));
    expect(fixture.nativeElement.textContent).toContain('Create Incident');
    expect(fixture.nativeElement.querySelector('ion-list h2')?.textContent).toBe('INC-1 — Order 11039 is missing');
    expect(fixture.nativeElement.textContent).not.toContain(incident.ref.storeId);
    expect((fixture.componentInstance as unknown as { detailHref(item: typeof incident): string }).detailHref(incident))
      .toBe('/space/private-space/store/firestore/project/private-project/incidents/detective-incidents-9c561d36/INC-1');
  });

  it('creates an Incident without a Case, preserves numeric OrderID, and opens its returned full ref', async () => {
    client.incidentAction.mockReturnValue(of({ incident, receipt: 'saved' }));
    const fixture = await mount('new', []);
    const page = fixture.componentInstance as unknown as {
      title: { set(value: string): void };
      description: { set(value: string): void };
      orderId: { set(value: string): void };
      create(): Promise<void>;
    };
    page.title.set('Order 11039 is missing');
    page.description.set('Customer reported a missing order.');
    page.orderId.set('11039');
    await page.create();
    expect(client.incidentAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cloud', project: 'private-project' }),
      expect.objectContaining({
        type: 'create', environment: 'demo', title: 'Order 11039 is missing',
        context: { OrderID: { type: 'number', value: 11039 } },
      }),
      expect.stringMatching(/^operation-/),
      expect.any(AbortSignal),
    );
    expect(client.incidentAction.mock.calls[0][1]).not.toHaveProperty('caseId');
    expect(router.navigate).toHaveBeenCalledWith(
      ['/space/private-space/store/firestore/project/private-project/incidents/detective-incidents-9c561d36/INC-1'],
      { queryParams: { environment: 'demo' }, replaceUrl: true },
    );
  });

  it('cold-loads the exact non-Firestore IncidentRef, shows its linked Case, and starts a distinct Case', async () => {
    client.incidentAction.mockReturnValue(of({ incident, case: { ...caseRecord, id: 'incident-new-case' }, receipt: 'started' }));
    const fixture = await mount('detail');
    await vi.waitFor(() => expect(client.projectIncident).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cloud', project: 'private-project' }),
      'demo', 'detective-incidents-9c561d36/INC-1',
    ));
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain('Detective Case incident-case-1'));
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toBe('INC-1 — Order 11039 is missing');
    expect(fixture.nativeElement.textContent).not.toContain(incident.ref.storeId);
    await (fixture.componentInstance as unknown as { startCase(): Promise<void> }).startCase();
    expect(client.incidentAction.mock.calls[0][1]).toMatchObject({
      type: 'start-case', incidentRef: 'detective-incidents-9c561d36/INC-1',
      environment: 'demo', case: { incidentRefs: [], version: 0 },
    });
    expect(client.incidentAction.mock.calls[0][1].case.id).not.toBe(incident.ref.incidentId);
    expect(router.navigateByUrl).toHaveBeenCalledWith(
      '/space/private-space/store/firestore/project/private-project/detective/incident-new-case',
    );
  });

  it('accepts a fresh conversation projection without regressing title, status or context on an older replay', async () => {
    const fixture = await mount('detail', []);
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain(incident.title));
    const page = fixture.componentInstance as unknown as {
      updateConversationIncident(item: typeof incident): void;
      incident(): typeof incident;
    };
    const current = {...incident, title: 'Current investigation', status: 'investigating', canonicalContext: {order: 11039}, lastSeq: 4};
    page.updateConversationIncident(current);
    page.updateConversationIncident({...incident, lastSeq: 2});
    expect(page.incident()).toEqual(current);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Current investigation');
  });

  it('keeps the saved Incident available when navigation fails without sending a second create', async () => {
    client.incidentAction.mockReturnValue(of({ incident, receipt: 'saved' }));
    router.navigate.mockResolvedValue(false);
    const fixture = await mount('new', []);
    const page = fixture.componentInstance as unknown as {
      title: { set(value: string): void };
      create(): Promise<void>;
      openSavedIncident(): Promise<void>;
    };
    page.title.set('Order 11039 is missing');
    await page.create();
    await page.create();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain('Open saved Incident'));
    router.navigate.mockResolvedValue(true);
    await page.openSavedIncident();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledTimes(2);
  });

  it('rejects an explicit unknown environment before reading or writing an Incident', async () => {
    const fixture = await mount('detail', [], 'other');
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain('Environment other is unavailable'));
    expect(client.projectIncident).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Open Incidents list');
  });

  it('loads a second Incident ID in a reused detail component and discards the first record', async () => {
    const second = { ...incident, ref: { ...incident.ref, incidentId: 'INC-2' }, title: 'Second Incident' };
    const fixture = await mount('detail', []);
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain(incident.title));
    client.projectIncident.mockImplementation((_context, _environment, ref: string) =>
      of({ incident: ref.endsWith('/INC-2') ? second : incident }));
    routeParams$.next(convertToParamMap({
      incidentStoreId: second.ref.storeId, incidentId: second.ref.incidentId,
    }));
    await vi.waitFor(() => expect(fixture.nativeElement.querySelector('h1')?.textContent).toBe('INC-2 — Second Incident'));
    expect(fixture.nativeElement.querySelector('h1')?.textContent).not.toContain('INC-1');
    expect(fixture.nativeElement.textContent).not.toContain(incident.title);
    expect(client.projectIncident).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'cloud' }), 'demo',
      'detective-incidents-9c561d36/INC-2',
    );
  });

  it('keeps viewer Incidents readable while blocking create and start-case actions', async () => {
    const list = await mount('list', [], 'demo', false);
    await vi.waitFor(() => expect(list.nativeElement.textContent).toContain('Order 11039 is missing'));
    expect(list.nativeElement.textContent).toContain('cannot create them');
    expect(list.nativeElement.textContent).not.toContain('Create Incident');
    list.destroy();
    TestBed.resetTestingModule();

    const newPage = await mount('new', [], 'demo', false);
    const create = newPage.componentInstance as unknown as { title: { set(value: string): void }; create(): Promise<void> };
    create.title.set('Viewer must not create');
    await create.create();
    expect(client.incidentAction).not.toHaveBeenCalled();
    newPage.destroy();
    TestBed.resetTestingModule();

    const detail = await mount('detail', [], 'demo', false);
    await vi.waitFor(() => expect(detail.nativeElement.textContent).toContain('Order 11039 is missing'));
    expect(detail.nativeElement.textContent).toContain('cannot start a Detective Case');
    await (detail.componentInstance as unknown as { startCase(): Promise<void> }).startCase();
    expect(client.incidentAction).not.toHaveBeenCalled();
  });

  it('reuses an ambiguous create operation ID after remount, but changes it for changed text or project', async () => {
    client.incidentAction.mockReturnValue(throwError(() => new Error('connection lost')));
    const first = await mount('new', []);
    const firstPage = first.componentInstance as unknown as { title: { set(value: string): void }; create(): Promise<void> };
    firstPage.title.set('Order 11039 is missing');
    await firstPage.create();
    const originalId = client.incidentAction.mock.calls[0][2];
    expect(originalId).toMatch(/^operation-/);
    first.destroy();
    TestBed.resetTestingModule();

    const second = await mount('new', []);
    const secondPage = second.componentInstance as unknown as { title: { set(value: string): void }; create(): Promise<void> };
    secondPage.title.set('Order 11039 is missing');
    await secondPage.create();
    expect(client.incidentAction.mock.calls[1][2]).toBe(originalId);
    secondPage.title.set('A different Incident');
    client.incidentAction.mockReturnValue(of({ incident, receipt: 'saved' }));
    await secondPage.create();
    expect(client.incidentAction.mock.calls[2][2]).not.toBe(originalId);
    second.destroy();
    TestBed.resetTestingModule();

    const third = await mount('new', []);
    const thirdPage = third.componentInstance as unknown as { title: { set(value: string): void }; create(): Promise<void> };
    thirdPage.title.set('Order 11039 is missing');
    await thirdPage.create();
    expect(client.incidentAction.mock.calls[3][2]).toBe(originalId);
    third.destroy();
    TestBed.resetTestingModule();

    const fourth = await mount('new', [], 'demo', true, { ...ref, projectId: 'another-project' });
    const fourthPage = fourth.componentInstance as unknown as { title: { set(value: string): void }; create(): Promise<void> };
    fourthPage.title.set('Order 11039 is missing');
    await fourthPage.create();
    expect(client.incidentAction.mock.calls[4][2]).not.toBe(originalId);
  });

  it('holds the environment while a create is in flight', async () => {
    const pending = new Subject<{ incident: typeof incident; receipt: string }>();
    client.incidentAction.mockReturnValue(pending.asObservable());
    const fixture = await mount('new', []);
    const page = fixture.componentInstance as unknown as {
      title: { set(value: string): void };
      environment(): string;
      selectEnvironment(value: string): void;
      create(): Promise<void>;
    };
    page.title.set('Order 11039 is missing');
    const saving = page.create();
    await vi.waitFor(() => expect(client.incidentAction).toHaveBeenCalledTimes(1));
    page.selectEnvironment('other');
    expect(page.environment()).toBe('demo');
    expect(router.navigate).not.toHaveBeenCalled();
    pending.next({ incident, receipt: 'saved' });
    pending.complete();
    await saving;
    expect(router.navigate).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ queryParams: { environment: 'demo' } }),
    );
  });

  it('retries a lost start-case response with the same Case and operation IDs after remount', async () => {
    client.incidentAction.mockReturnValue(throwError(() => new Error('connection lost')));
    const first = await mount('detail', []);
    await vi.waitFor(() => expect(first.nativeElement.textContent).toContain(incident.title));
    await (first.componentInstance as unknown as { startCase(): Promise<void> }).startCase();
    const firstAction = client.incidentAction.mock.calls[0][1];
    const firstOperation = client.incidentAction.mock.calls[0][2];
    first.destroy();
    TestBed.resetTestingModule();

    client.incidentAction.mockReturnValue(of({ incident, case: { ...caseRecord, id: firstAction.case.id }, receipt: 'started' }));
    const second = await mount('detail', []);
    await vi.waitFor(() => expect(second.nativeElement.textContent).toContain(incident.title));
    await (second.componentInstance as unknown as { startCase(): Promise<void> }).startCase();
    expect(client.incidentAction.mock.calls[1][1]).toEqual(firstAction);
    expect(client.incidentAction.mock.calls[1][2]).toBe(firstOperation);
    second.destroy();
    TestBed.resetTestingModule();

    const third = await mount('detail', []);
    await vi.waitFor(() => expect(third.nativeElement.textContent).toContain(incident.title));
    await (third.componentInstance as unknown as { startCase(): Promise<void> }).startCase();
    expect(client.incidentAction.mock.calls[2][1].case.id).not.toBe(firstAction.case.id);
    expect(client.incidentAction.mock.calls[2][2]).not.toBe(firstOperation);
  });

  it('keeps exact create and start-case retry IDs in memory when session storage is disabled', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage disabled'); });
    client.incidentAction.mockReturnValue(throwError(() => new Error('connection lost')));
    const newPage = await mount('new', []);
    const create = newPage.componentInstance as unknown as { title: { set(value: string): void }; create(): Promise<void> };
    create.title.set('Order 11039 is missing');
    await create.create();
    await create.create();
    expect(client.incidentAction.mock.calls[1][2]).toBe(client.incidentAction.mock.calls[0][2]);
    newPage.destroy();
    TestBed.resetTestingModule();

    const detail = await mount('detail', []);
    await vi.waitFor(() => expect(detail.nativeElement.textContent).toContain(incident.title));
    const start = detail.componentInstance as unknown as { startCase(): Promise<void> };
    await start.startCase();
    await start.startCase();
    expect(client.incidentAction.mock.calls[3][2]).toBe(client.incidentAction.mock.calls[2][2]);
    expect(client.incidentAction.mock.calls[3][1].case.id).toBe(client.incidentAction.mock.calls[2][1].case.id);
  });
});
