import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import {
  AgentContextService,
  InvestigationContextService,
} from '@sneat/datatug-semantic';
import { BehaviorSubject, defer, Observable, of, Subject } from 'rxjs';
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
    type: 'note.added',
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
  let refreshAgentContextSpy: ReturnType<typeof vi.fn>;
  let setInvestigationScopeSpy: ReturnType<typeof vi.fn>;
  let clearInvestigationContextSpy: ReturnType<typeof vi.fn>;
  let isCurrentInvestigationScopeSpy: ReturnType<typeof vi.fn>;
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
    refreshAgentContextSpy = vi.fn(() =>
      of({ securityContextId: 'ctx-current' }),
    );
    setInvestigationScopeSpy = vi.fn();
    clearInvestigationContextSpy = vi.fn();
    isCurrentInvestigationScopeSpy = vi.fn(() => true);
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
        {
          provide: AgentContextService,
          useValue: {
            securityContextId: signal('ctx-default-agent'),
            contextFor: vi.fn(() => ({
              securityContextId,
              refresh: refreshAgentContextSpy,
            })),
          },
        },
        {
          provide: InvestigationContextService,
          useValue: {
            setScope: setInvestigationScopeSpy,
            clear: clearInvestigationContextSpy,
            isCurrentScope: isCurrentInvestigationScopeSpy,
          },
        },
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

  it.each([
    [{ agent: 'agent-b:8989' }, 'agent B'],
    [{ project: 'operations' }, 'an explicit project'],
  ])(
    'fails closed without projection or events requests for partial explicit scope: %s',
    async (query) => {
      await render(undefined, query);
      navStore$.next('agent-a:8989');
      navProject$.next({
        ref: { storeId: 'agent-a:8989', projectId: 'billing' },
      });
      navEnvironment$.next({ id: 'prod' });
      fixture.detectChanges();

      expect(getSpy).not.toHaveBeenCalled();
      expect(eventsSpy).not.toHaveBeenCalled();
      expect(fixture.nativeElement.innerHTML).toContain(
        'missing its DataTug agent, project, or environment scope',
      );
    },
  );

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

  it('refreshes once and retries projection and events after STALE_CONTEXT', async () => {
    await render();
    getSpy
      .mockReturnValueOnce(
        of({
          kind: 'error',
          code: 'STALE_CONTEXT',
          message: 'Refresh agent info and retry.',
        }),
      )
      .mockReturnValueOnce(of({ kind: 'ok', data: incident('Recovered') }));
    eventsSpy
      .mockReturnValueOnce(
        of({
          kind: 'error',
          code: 'STALE_CONTEXT',
          message: 'Refresh agent info and retry.',
        }),
      )
      .mockReturnValueOnce(
        of({
          kind: 'ok',
          data: [streamItem('cursor-2', 'Recovered timeline')],
        }),
      );
    refreshAgentContextSpy.mockImplementation(() =>
      defer(() => {
        securityContextId.set('ctx-refreshed');
        return of({ securityContextId: 'ctx-refreshed' });
      }),
    );

    paramMap$.next(
      convertToParamMap({ storeId: 'ops', incidentId: 'INC-retry' }),
    );
    fixture.detectChanges();
    fixture.detectChanges();

    expect(clearInvestigationContextSpy).toHaveBeenCalledTimes(1);
    expect(refreshAgentContextSpy).toHaveBeenCalledTimes(1);
    expect(getSpy.mock.calls.at(-1)?.[0].scope.securityContextId).toBe(
      'ctx-refreshed',
    );
    expect(eventsSpy.mock.calls.at(-1)?.[0].scope.securityContextId).toBe(
      'ctx-refreshed',
    );
    expect(fixture.nativeElement.innerHTML).toContain('Recovered timeline');
  });

  it('recovers when only the text-mode events request reports STALE_CONTEXT', async () => {
    const firstTimeline$ = new Subject<
      IncidentApiResult<IncidentStreamItem[]>
    >();
    await render(
      undefined,
      undefined,
      of({ kind: 'ok', data: incident('Projection remains visible') }),
      firstTimeline$,
    );
    eventsSpy.mockReturnValue(
      of({
        kind: 'ok',
        data: [streamItem('cursor-retry', 'Recovered events-only timeline')],
      }),
    );
    refreshAgentContextSpy.mockImplementation(() =>
      defer(() => {
        securityContextId.set('ctx-events-refreshed');
        return of({ securityContextId: 'ctx-events-refreshed' });
      }),
    );

    firstTimeline$.next({
      kind: 'error',
      code: 'STALE_CONTEXT',
      message: 'Refresh agent info and retry.',
    });
    fixture.detectChanges();
    fixture.detectChanges();

    expect(clearInvestigationContextSpy).toHaveBeenCalledTimes(1);
    expect(refreshAgentContextSpy).toHaveBeenCalledTimes(1);
    expect(eventsSpy.mock.calls.at(-1)?.[0].scope.securityContextId).toBe(
      'ctx-events-refreshed',
    );
    expect(fixture.nativeElement.innerHTML).toContain(
      'Recovered events-only timeline',
    );
  });

  it('does not clear or refresh another active investigation scope after a late stale detail response', async () => {
    const projection$ = new Subject<IncidentApiResult<IncidentDetail>>();
    const timeline$ = new Subject<IncidentApiResult<IncidentStreamItem[]>>();
    await render(undefined, undefined, projection$, timeline$);
    isCurrentInvestigationScopeSpy.mockReturnValue(false);

    projection$.next({
      kind: 'error',
      code: 'STALE_CONTEXT',
      message: 'Old page scope is stale.',
    });
    timeline$.next({
      kind: 'error',
      code: 'STALE_CONTEXT',
      message: 'Old page scope is stale.',
    });

    expect(clearInvestigationContextSpy).not.toHaveBeenCalled();
    expect(refreshAgentContextSpy).not.toHaveBeenCalled();
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(eventsSpy).toHaveBeenCalledTimes(1);
  });

  it('does not reactivate or retry page A when page B becomes current during refresh', async () => {
    const projection$ = new Subject<IncidentApiResult<IncidentDetail>>();
    const timeline$ = new Subject<IncidentApiResult<IncidentStreamItem[]>>();
    const refreshResult$ = new Subject<{ securityContextId: string }>();
    await render(undefined, undefined, projection$, timeline$);
    refreshAgentContextSpy.mockReturnValue(refreshResult$);

    projection$.next({
      kind: 'error',
      code: 'STALE_CONTEXT',
      message: 'Refresh agent info and retry.',
    });
    expect(refreshAgentContextSpy).toHaveBeenCalledTimes(1);

    setInvestigationScopeSpy(
      {
        project: 'other-project',
        environment: 'staging',
        securityContextId: 'ctx-b',
      },
      '//agent-b:8989/datatug',
    );
    isCurrentInvestigationScopeSpy.mockReturnValue(false);
    securityContextId.set('ctx-refreshed');
    refreshResult$.next({ securityContextId: 'ctx-refreshed' });
    fixture.detectChanges();

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(eventsSpy).toHaveBeenCalledTimes(1);
    expect(setInvestigationScopeSpy).toHaveBeenCalledTimes(2);
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
    expect(
      fixture.nativeElement.querySelector('ion-note')?.getAttribute('role'),
    ).toBe('alert');
  });

  it('announces a dynamic timeline error', async () => {
    await render(
      undefined,
      undefined,
      of({ kind: 'ok', data: incident('Loaded incident') }),
      of({ kind: 'error', message: 'Timeline cannot be loaded.' }),
    );
    fixture.detectChanges();

    const note = Array.from(
      fixture.nativeElement.querySelectorAll('ion-note'),
    ).find((item) => item.textContent?.includes('Timeline cannot be loaded.'));
    expect(note?.getAttribute('role')).toBe('alert');
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

  it('renders a body only for note.added events', async () => {
    await render();
    interface Internals {
      eventSummary(event: IncidentStreamItem['event']): string;
    }
    const component = fixture.componentInstance as unknown as Internals;

    expect(
      component.eventSummary({
        ...streamItem('cursor-note', 'Visible note').event,
        type: 'note.added',
      }),
    ).toBe('Visible note');
    expect(
      component.eventSummary({
        ...streamItem('cursor-status', 'must not render').event,
        type: 'incident.status',
        payload: { status: 'investigating', body: 'must not render' },
      }),
    ).toBe('incident.status');
  });
});
