import { ComponentFixture, TestBed } from '@angular/core/testing';
import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AgentContextService } from '@sneat/datatug-semantic';
import { BehaviorSubject, of, Subject } from 'rxjs';
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
    state: vi.fn(), projectIncidents: vi.fn(), projectIncident: vi.fn(), incidentAction: vi.fn(),
  };
  const router = { events: of(), navigate: vi.fn().mockResolvedValue(true), navigateByUrl: vi.fn().mockResolvedValue(true) };
  let routeParams$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  async function mount(mode: 'list' | 'new' | 'detail', cases = [caseRecord], requestedEnvironment = 'demo') {
    const project = new BehaviorSubject({ ref });
    const authState = new BehaviorSubject({ user: { uid: 'sarah' } });
    client.state.mockReturnValue(of({ environments: ['demo'], cases }));
    client.projectIncidents.mockReturnValue(of({ incidents: [incident] }));
    client.projectIncident.mockReturnValue(of({ incident }));
    const data = { incidentMode: mode };
    const params = convertToParamMap(mode === 'detail' ? {
      incidentStoreId: incident.ref.storeId, incidentId: incident.ref.incidentId,
    } : {});
    routeParams$ = new BehaviorSubject(params);
    const queryParams = convertToParamMap({ environment: requestedEnvironment });
    await TestBed.configureTestingModule({
      imports: [HostedIncidentsPageComponent],
      providers: [
        { provide: DetectiveClientService, useValue: client },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: {
          snapshot: { data, paramMap: params, queryParamMap: queryParams },
          data: of(data), paramMap: routeParams$.asObservable(), queryParamMap: of(queryParams),
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
    router.navigate.mockResolvedValue(true);
    router.navigateByUrl.mockResolvedValue(true);
  });
  afterEach(() => TestBed.resetTestingModule());

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
    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain('Second Incident'));
    expect(fixture.nativeElement.textContent).not.toContain(incident.title);
    expect(client.projectIncident).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'cloud' }), 'demo',
      'detective-incidents-9c561d36/INC-2',
    );
  });
});
