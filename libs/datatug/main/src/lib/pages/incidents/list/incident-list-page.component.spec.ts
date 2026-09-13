import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AgentContextService } from '@sneat/datatug-semantic';
import { BehaviorSubject, Subject } from 'rxjs';
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
  let securityContextId: ReturnType<typeof signal<string | undefined>>;
  let listResult$: Subject<IncidentApiResult<IncidentSummary[]>>;
  let listSpy: ReturnType<typeof vi.fn>;

  const render = async () => {
    storeId$ = new BehaviorSubject<string | undefined>(undefined);
    project$ = new BehaviorSubject<
      { ref: { storeId: string; projectId: string } } | undefined
    >(undefined);
    environment$ = new BehaviorSubject<{ id: string } | undefined>(undefined);
    securityContextId = signal<string | undefined>('ctx-1');
    listResult$ = new Subject<IncidentApiResult<IncidentSummary[]>>();
    listSpy = vi.fn().mockReturnValue(listResult$);

    await TestBed.configureTestingModule({
      imports: [IncidentListPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DatatugNavContextService,
          useValue: {
            currentStoreId: storeId$,
            currentProject: project$,
            currentEnv: environment$,
          },
        },
        { provide: AgentContextService, useValue: { securityContextId } },
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
