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
import { BehaviorSubject, defer, of, Subject } from 'rxjs';
import { IncidentListPageComponent } from './incident-list-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import {
  IncidentApiResult,
  IncidentRequestContext,
  IncidentSummary,
} from '../../../incidents/models';

const incident = (
  storeId: string,
  incidentId: string,
  title: string,
): IncidentSummary => ({
  ref: { storeId, incidentId },
  uid: `uid-${incidentId}`,
  title,
  status: 'open',
  canonicalContext: { facts: [] },
  lastSeq: 1,
});

const context = (
  agentStoreId = 'localhost:8989',
  storeId = 'billing',
): IncidentRequestContext => ({
  agentStoreId,
  scope: {
    storeId,
    project: 'billing',
    environment: 'prod',
    securityContextId: 'ctx-1',
  },
});

describe('IncidentListPageComponent', () => {
  let fixture: ComponentFixture<IncidentListPageComponent>;
  let storeId$: BehaviorSubject<string | undefined>;
  let project$: BehaviorSubject<
    { ref: { storeId: string; projectId: string } } | undefined
  >;
  let environment$: BehaviorSubject<{ id: string } | undefined>;
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let securityContextId: ReturnType<typeof signal<string | undefined>>;
  let refreshAgentContextSpy: ReturnType<typeof vi.fn>;
  let setInvestigationScopeSpy: ReturnType<typeof vi.fn>;
  let clearInvestigationContextSpy: ReturnType<typeof vi.fn>;
  let isCurrentInvestigationScopeSpy: ReturnType<typeof vi.fn>;
  let listResult$: Subject<IncidentApiResult<IncidentSummary[]>>;
  let listSpy: ReturnType<typeof vi.fn>;

  const render = async (query: Record<string, string> = {}) => {
    storeId$ = new BehaviorSubject<string | undefined>(undefined);
    project$ = new BehaviorSubject<
      { ref: { storeId: string; projectId: string } } | undefined
    >(undefined);
    environment$ = new BehaviorSubject<{ id: string } | undefined>(undefined);
    queryParamMap$ = new BehaviorSubject(convertToParamMap(query));
    securityContextId = signal<string | undefined>('ctx-1');
    refreshAgentContextSpy = vi.fn(() => of({ securityContextId: 'ctx-1' }));
    setInvestigationScopeSpy = vi.fn();
    clearInvestigationContextSpy = vi.fn();
    isCurrentInvestigationScopeSpy = vi.fn(() => true);
    listResult$ = new Subject<IncidentApiResult<IncidentSummary[]>>();
    listSpy = vi.fn().mockReturnValue(listResult$);

    await TestBed.configureTestingModule({
      imports: [IncidentListPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: queryParamMap$,
            snapshot: { queryParamMap: queryParamMap$.value },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentStoreId: storeId$,
            currentProject: project$,
            currentEnv: environment$,
          },
        },
        {
          provide: AgentContextService,
          useValue: {
            securityContextId: signal('default-agent-context'),
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
        { provide: IncidentClientService, useValue: { list: listSpy } },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(IncidentListPageComponent);
    fixture.detectChanges();
  };

  const selectScope = (
    agentStoreId = 'localhost:8989',
    projectId = 'billing',
    environment = 'prod',
  ): void => {
    storeId$.next(agentStoreId);
    project$.next({ ref: { storeId: agentStoreId, projectId } });
    environment$.next({ id: environment });
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await render();
  });

  it('shows the "Houston, we\'ve got a problem" entry point', () => {
    expect(fixture.nativeElement.innerHTML).toContain(
      "Houston, we've got a problem",
    );
  });

  it('shows an "open a project" guidance state without a complete scope', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Open a project');
    expect(listSpy).not.toHaveBeenCalled();
  });

  it.each([
    [{ agent: 'agent-b:8989' }, 'agent B'],
    [{ project: 'other-project' }, 'an explicit project'],
  ])(
    'fails closed without a request when the URL has only %s',
    async (query) => {
      TestBed.resetTestingModule();
      await render(query);
      selectScope('agent-a:8989');

      expect(listSpy).not.toHaveBeenCalled();
      expect(fixture.nativeElement.innerHTML).toContain('Open a project');
    },
  );

  it('uses a complete explicit URL scope without ambient mixing', async () => {
    TestBed.resetTestingModule();
    await render({
      agent: 'agent-b:8989',
      storeId: 'ops',
      project: 'operations',
      environment: 'staging',
    });
    selectScope('agent-a:8989');

    expect(listSpy).toHaveBeenCalledWith({
      agentStoreId: 'agent-b:8989',
      scope: {
        storeId: 'ops',
        project: 'operations',
        environment: 'staging',
        securityContextId: 'ctx-1',
      },
    });
  });

  it('calls the client and renders incidents once the full scope is available', () => {
    selectScope();

    expect(listSpy).toHaveBeenCalledWith(context());

    listResult$.next({
      kind: 'ok',
      data: [incident('billing', 'INC-1', 'Checkout errors spike')],
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Checkout errors spike');
  });

  it('recovers once from STALE_CONTEXT using the same explicit agent', () => {
    listSpy
      .mockReturnValueOnce(
        of({
          kind: 'error',
          code: 'STALE_CONTEXT',
          message: 'Refresh agent info and retry.',
        } as const),
      )
      .mockReturnValueOnce(
        of({
          kind: 'ok',
          data: [incident('billing', 'INC-1', 'Recovered incident')],
        } as const),
      );
    refreshAgentContextSpy.mockImplementation(() =>
      defer(() => {
        securityContextId.set('ctx-2');
        return of({ securityContextId: 'ctx-2' });
      }),
    );

    selectScope('agent-b:8989');
    fixture.detectChanges();

    expect(clearInvestigationContextSpy).toHaveBeenCalledTimes(1);
    expect(refreshAgentContextSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenNthCalledWith(
      1,
      context('agent-b:8989', 'billing'),
    );
    expect(listSpy).toHaveBeenNthCalledWith(2, {
      ...context('agent-b:8989', 'billing'),
      scope: {
        ...context('agent-b:8989', 'billing').scope,
        securityContextId: 'ctx-2',
      },
    });
    expect(fixture.nativeElement.innerHTML).toContain('Recovered incident');
  });

  it('ignores a stale response after the active scope changes', () => {
    const nextScopeResult$ = new Subject<
      IncidentApiResult<IncidentSummary[]>
    >();
    listSpy
      .mockReturnValueOnce(listResult$)
      .mockReturnValueOnce(nextScopeResult$);

    selectScope('first-agent');
    selectScope('second-agent');

    nextScopeResult$.next({
      kind: 'ok',
      data: [incident('billing', 'INC-2', 'Current scope incident')],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.innerHTML).toContain('Current scope incident');

    listResult$.next({
      kind: 'ok',
      data: [incident('billing', 'INC-1', 'Stale scope incident')],
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Current scope incident');
    expect(fixture.nativeElement.innerHTML).not.toContain(
      'Stale scope incident',
    );
  });

  it('does not clear, reactivate, refresh, or retry page A after page B owns the investigation scope', () => {
    selectScope('agent-a:8989');
    setInvestigationScopeSpy(
      {
        project: 'other-project',
        environment: 'staging',
        securityContextId: 'ctx-b',
      },
      '//agent-b:8989/datatug',
    );
    isCurrentInvestigationScopeSpy.mockReturnValue(false);

    listResult$.next({
      kind: 'error',
      code: 'STALE_CONTEXT',
      message: 'Old page scope is stale.',
    });

    expect(clearInvestigationContextSpy).not.toHaveBeenCalled();
    expect(refreshAgentContextSpy).not.toHaveBeenCalled();
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(setInvestigationScopeSpy).toHaveBeenCalledTimes(2);
    expect(setInvestigationScopeSpy).toHaveBeenLastCalledWith(
      {
        project: 'other-project',
        environment: 'staging',
        securityContextId: 'ctx-b',
      },
      '//agent-b:8989/datatug',
    );
  });

  it('does not reactivate or retry page A when page B becomes current during refresh', () => {
    const refreshResult$ = new Subject<{ securityContextId: string }>();
    refreshAgentContextSpy.mockReturnValue(refreshResult$);
    selectScope('agent-a:8989');

    listResult$.next({
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
    securityContextId.set('ctx-2');
    refreshResult$.next({ securityContextId: 'ctx-2' });
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(setInvestigationScopeSpy).toHaveBeenCalledTimes(2);
  });

  it('shows the explicit unavailable state when an old server lacks the route', () => {
    selectScope();

    listResult$.next({
      kind: 'unavailable',
      message: 'The incident store is not available on this server yet.',
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain(
      'The incident store is not available on this server yet.',
    );
    expect(
      fixture.nativeElement.querySelector('ion-note')?.getAttribute('role'),
    ).toBe('alert');
  });

  it('shows an empty state when the store has no incidents', () => {
    selectScope();

    listResult$.next({ kind: 'ok', data: [] });
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('No incidents yet');
  });

  it('builds a route-store-authoritative detail link', () => {
    selectScope();

    interface Internals {
      incidentLink(incident: IncidentSummary): readonly string[];
      scopeQueryParams(): Readonly<Record<string, string>> | undefined;
    }
    const peek = fixture.componentInstance as unknown as Internals;
    expect(peek.incidentLink(incident('ops', 'INC-1', 't'))).toEqual([
      '/incidents',
      'ops',
      'INC-1',
    ]);
    expect(peek.scopeQueryParams()).toEqual({
      agent: 'localhost:8989',
      storeId: 'billing',
      project: 'billing',
      environment: 'prod',
    });
  });
});
