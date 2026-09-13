import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { AgentContextService } from '@sneat/datatug-semantic';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { IncidentDetailPageComponent } from './incident-detail-page.component';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import {
  IncidentApiResult,
  IncidentDetail,
  IncidentRequestContext,
  IncidentStreamItem,
} from '../../../incidents/models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';

const incident = (title: string, incidentId = 'INC-1'): IncidentDetail => ({
  ref: { storeId: 'ops', incidentId },
  uid: `uid-${incidentId}`,
  title,
  status: 'investigating',
  description: '5xx rate above baseline',
  canonicalContext: { facts: [] },
  lastSeq: 2,
});

const streamItem = (
  cursor: string,
  body: string,
  incidentId = 'INC-1',
): IncidentStreamItem => ({
  cursor,
  event: {
    id: `event-${cursor}`,
    seq: 1,
    at: '2026-09-13T08:00:00Z',
    visibleAt: '2026-09-13T08:00:00Z',
    incident: { storeId: 'ops', incidentId },
    actor: { kind: 'human', id: 'alex', via: 'web' },
    type: 'incident.note_added',
    assertion: { kind: 'observation' },
    payload: { body },
  },
});

const requestContext = (
  incidentStoreId = 'ops',
  incidentIdContext = 'ctx-current',
): IncidentRequestContext => ({
  agentStoreId: 'url-agent:8989',
  scope: {
    storeId: incidentStoreId,
    project: 'billing',
    environment: 'prod',
    securityContextId: incidentIdContext,
  },
});

describe('IncidentDetailPageComponent', () => {
  let fixture: ComponentFixture<IncidentDetailPageComponent>;
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navStore$: BehaviorSubject<string | undefined>;
  let navProject$: BehaviorSubject<
    { ref: { storeId: string; projectId: string } } | undefined
  >;
  let navEnvironment$: BehaviorSubject<{ id: string } | undefined>;
  let securityContextId: ReturnType<typeof signal<string | undefined>>;
  let getSpy: ReturnType<typeof vi.fn>;
  let eventsSpy: ReturnType<typeof vi.fn>;

  const render = async (
    initialParams: Record<string, string> = {
      storeId: 'ops',
      incidentId: 'INC-1',
    },
    initialQuery: Record<string, string> = {
      agent: 'url-agent:8989',
      project: 'billing',
      environment: 'prod',
    },
    getReturn: Observable<IncidentApiResult<IncidentDetail>> = new Subject(),
    eventsReturn: Observable<IncidentApiResult<IncidentStreamItem[]>> = of({
      kind: 'ok',
      data: [],
    }),
  ): Promise<void> => {
    paramMap$ = new BehaviorSubject(convertToParamMap(initialParams));
    queryParamMap$ = new BehaviorSubject(convertToParamMap(initialQuery));
    navStore$ = new BehaviorSubject<string | undefined>(undefined);
    navProject$ = new BehaviorSubject<
      { ref: { storeId: string; projectId: string } } | undefined
    >(undefined);
    navEnvironment$ = new BehaviorSubject<{ id: string } | undefined>(
      undefined,
    );
    securityContextId = signal<string | undefined>('ctx-current');
    getSpy = vi.fn().mockReturnValue(getReturn);
    eventsSpy = vi.fn().mockReturnValue(eventsReturn);

    await TestBed.configureTestingModule({
      imports: [IncidentDetailPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$,
            queryParamMap: queryParamMap$,
            snapshot: {
              paramMap: paramMap$.value,
              queryParamMap: queryParamMap$.value,
            },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentStoreId: navStore$,
            currentProject: navProject$,
            currentEnv: navEnvironment$,
          },
        },
        { provide: AgentContextService, useValue: { securityContextId } },
        {
          provide: IncidentClientService,
          useValue: { get: getSpy, events: eventsSpy },
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(IncidentDetailPageComponent);
    fixture.detectChanges();
  };

  it('cold-loads from URL-only non-secret scope and current security context', async () => {
    await render();

    expect(getSpy).toHaveBeenCalledWith(requestContext(), 'INC-1', undefined);
    expect(eventsSpy).toHaveBeenCalledWith(requestContext(), 'INC-1');
  });

  it('keeps the route store authoritative over a conflicting query store', async () => {
    await render(undefined, {
      agent: 'url-agent:8989',
      storeId: 'wrong-store',
      project: 'billing',
      environment: 'prod',
    });

    expect(getSpy).toHaveBeenCalledWith(
      requestContext('ops'),
      'INC-1',
      undefined,
    );
  });

  it('renders the incident and finite timeline once loaded', async () => {
    await render(
      undefined,
      undefined,
      of({ kind: 'ok', data: incident('Checkout errors spike') }),
      of({ kind: 'ok', data: [streamItem('cursor-1', 'Payment API is slow')] }),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Checkout errors spike');
    expect(fixture.nativeElement.innerHTML).toContain('investigating');
    expect(fixture.nativeElement.innerHTML).toContain(
      '5xx rate above baseline',
    );
    expect(fixture.nativeElement.innerHTML).toContain('Payment API is slow');
  });

  it('shows explicit unavailable states for projection and timeline', async () => {
    await render(
      undefined,
      undefined,
      of({
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      }),
      of({
        kind: 'error',
        message: 'Could not load the incident timeline.',
      }),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain(
      'The incident store is not available on this server yet.',
    );
  });

  it('does nothing when the route does not contain an incident id', async () => {
    await render({ storeId: 'ops', incidentId: '' });
    expect(getSpy).not.toHaveBeenCalled();
    expect(eventsSpy).not.toHaveBeenCalled();
  });

  it('ignores late projection and timeline results after the URL scope changes', async () => {
    const oldIncident$ = new Subject<IncidentApiResult<IncidentDetail>>();
    const oldEvents$ = new Subject<IncidentApiResult<IncidentStreamItem[]>>();
    await render(undefined, undefined, oldIncident$, oldEvents$);
    const currentIncident$ = new Subject<IncidentApiResult<IncidentDetail>>();
    const currentEvents$ = new Subject<
      IncidentApiResult<IncidentStreamItem[]>
    >();
    getSpy.mockReturnValue(currentIncident$);
    eventsSpy.mockReturnValue(currentEvents$);

    paramMap$.next(convertToParamMap({ storeId: 'ops', incidentId: 'INC-2' }));
    fixture.detectChanges();
    currentIncident$.next({
      kind: 'ok',
      data: incident('Current incident', 'INC-2'),
    });
    currentEvents$.next({
      kind: 'ok',
      data: [streamItem('cursor-2', 'Current timeline', 'INC-2')],
    });
    fixture.detectChanges();

    oldIncident$.next({ kind: 'ok', data: incident('Stale incident') });
    oldEvents$.next({
      kind: 'ok',
      data: [streamItem('cursor-1', 'Stale timeline')],
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Current incident');
    expect(fixture.nativeElement.innerHTML).toContain('Current timeline');
    expect(fixture.nativeElement.innerHTML).not.toContain('Stale incident');
    expect(fixture.nativeElement.innerHTML).not.toContain('Stale timeline');
  });
});
