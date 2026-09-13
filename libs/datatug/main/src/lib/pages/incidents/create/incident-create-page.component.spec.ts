import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import {
  AgentContextService,
  ContextItem,
  InvestigationContextService,
} from '@sneat/datatug-semantic';
import { RandomIdService } from '@sneat/random';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { IncidentCreatePageComponent } from './incident-create-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import {
  CreateIncidentRequest,
  IncidentApiResult,
  IncidentDetail,
} from '../../../incidents/models';

interface Internals {
  title: string;
  description: string;
  submit(): void;
  isSubmitting(): boolean;
  errorMessage(): string | undefined;
}

const peek = (component: IncidentCreatePageComponent): Internals =>
  component as unknown as Internals;

const incident = (storeId = 'ops', incidentId = 'INC-1'): IncidentDetail => ({
  ref: { storeId, incidentId },
  uid: 'uid-1',
  title: 'Checkout errors spike',
  status: 'open',
  canonicalContext: { facts: [] },
  lastSeq: 1,
});

describe('IncidentCreatePageComponent', () => {
  let fixture: ComponentFixture<IncidentCreatePageComponent>;
  let storeId$: BehaviorSubject<string | undefined>;
  let project$: BehaviorSubject<
    { ref: { storeId: string; projectId: string } } | undefined
  >;
  let environment$: BehaviorSubject<{ id: string } | undefined>;
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let securityContextId: ReturnType<typeof signal<string | undefined>>;
  let investigationItems: ReturnType<typeof signal<readonly ContextItem[]>>;
  let setScopeSpy: ReturnType<typeof vi.fn>;
  let createSpy: ReturnType<typeof vi.fn>;
  let randomIdSpy: ReturnType<typeof vi.fn>;
  let router: Router;

  const render = async (query: Record<string, string> = {}): Promise<void> => {
    storeId$ = new BehaviorSubject<string | undefined>('localhost:8989');
    project$ = new BehaviorSubject({
      ref: { storeId: 'localhost:8989', projectId: 'billing' },
    });
    environment$ = new BehaviorSubject({ id: 'prod' });
    queryParamMap$ = new BehaviorSubject(convertToParamMap(query));
    securityContextId = signal<string | undefined>('ctx-1');
    investigationItems = signal<readonly ContextItem[]>([]);
    setScopeSpy = vi.fn();
    createSpy = vi.fn();
    randomIdSpy = vi.fn(() => 'test-id');

    await TestBed.configureTestingModule({
      imports: [IncidentCreatePageComponent],
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
        { provide: AgentContextService, useValue: { securityContextId } },
        {
          provide: InvestigationContextService,
          useValue: { items: investigationItems, setScope: setScopeSpy },
        },
        {
          provide: RandomIdService,
          useValue: { newRandomId: randomIdSpy },
        },
        { provide: IncidentClientService, useValue: { create: createSpy } },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(IncidentCreatePageComponent);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await render();
  });

  it('does not submit an empty title', () => {
    peek(fixture.componentInstance).title = '   ';
    peek(fixture.componentInstance).submit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('reports guidance when no complete scope is available', () => {
    project$.next(undefined);
    environment$.next(undefined);
    storeId$.next(undefined);
    fixture.detectChanges();
    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).submit();

    expect(createSpy).not.toHaveBeenCalled();
    expect(peek(fixture.componentInstance).errorMessage()).toContain(
      'Open a project and environment',
    );
  });

  it('calls the client with trimmed input, full scope, and canonical context', () => {
    investigationItems.set([
      {
        id: 'Customer.ID:integer="5"',
        entity: 'Customer',
        field: 'ID',
        value: { type: 'integer', value: '5' },
        origin: 'context',
        enabled: true,
        label: 'Customer.ID = 5',
        source: 'grid',
        addedAt: '2026-09-13T08:00:00Z',
        condition: '==',
      },
      {
        id: 'ignored',
        entity: 'Customer',
        field: 'ID',
        value: { type: 'integer', value: '6' },
        origin: 'context',
        enabled: false,
        label: 'disabled',
        source: 'grid',
        addedAt: '2026-09-13T08:00:00Z',
        condition: '==',
      },
    ]);
    const result$ = new Subject<IncidentApiResult<IncidentDetail>>();
    createSpy.mockReturnValue(result$);

    peek(fixture.componentInstance).title = '  Checkout errors spike  ';
    peek(fixture.componentInstance).description = '  5xx rate up  ';
    peek(fixture.componentInstance).submit();

    expect(createSpy).toHaveBeenCalledWith('localhost:8989', {
      storeId: 'billing',
      project: 'billing',
      environment: 'prod',
      securityContextId: 'ctx-1',
      mutationId: 'incident-create-test-id',
      title: 'Checkout errors spike',
      description: '5xx rate up',
      canonicalContext: {
        facts: [
          {
            id: 'Customer.ID:integer="5"',
            entity: 'Customer',
            field: 'ID',
            value: { type: 'integer', value: '5' },
            origin: 'context',
            enabled: true,
            scope: {
              storeId: 'local',
              projectId: 'billing',
              environment: 'prod',
            },
          },
        ],
      },
    } satisfies CreateIncidentRequest);
  });

  it('navigates with replaceUrl to the returned route-authoritative detail', () => {
    createSpy.mockReturnValue(
      of({
        kind: 'ok',
        data: incident(),
      } satisfies IncidentApiResult<IncidentDetail>),
    );
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).submit();

    expect(navigateSpy).toHaveBeenCalledWith(['/incidents', 'ops', 'INC-1'], {
      queryParams: {
        agent: 'localhost:8989',
        storeId: 'ops',
        project: 'billing',
        environment: 'prod',
      },
      replaceUrl: true,
    });
  });

  it('keeps the draft, restores controls, and reuses the mutation id on failure', () => {
    createSpy.mockReturnValue(
      of({
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      } satisfies IncidentApiResult<IncidentDetail>),
    );

    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).description = 'draft text';
    peek(fixture.componentInstance).submit();

    expect(peek(fixture.componentInstance).isSubmitting()).toBe(false);
    expect(peek(fixture.componentInstance).errorMessage()).toBe(
      'The incident store is not available on this server yet.',
    );
    expect(peek(fixture.componentInstance).title).toBe('Checkout errors spike');
    expect(peek(fixture.componentInstance).description).toBe('draft text');

    peek(fixture.componentInstance).submit();
    const firstRequest = createSpy.mock.calls[0][1] as CreateIncidentRequest;
    const secondRequest = createSpy.mock.calls[1][1] as CreateIncidentRequest;
    expect(randomIdSpy).toHaveBeenCalledTimes(1);
    expect(secondRequest.mutationId).toBe(firstRequest.mutationId);
  });

  it('disables title, description, submit, and cancel while persistence is pending', () => {
    createSpy.mockReturnValue(new Subject<IncidentApiResult<IncidentDetail>>());
    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).submit();
    fixture.detectChanges();

    expect(peek(fixture.componentInstance).isSubmitting()).toBe(true);
    for (const testId of [
      'incident-title-input',
      'incident-description-input',
    ]) {
      expect(
        fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)
          .disabled,
      ).toBe(true);
    }
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('ion-button'),
    ) as Array<{ disabled: boolean }>;
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it('uses URL non-secret scope over ambient navigation context', async () => {
    TestBed.resetTestingModule();
    await render({
      agent: 'url-agent:8989',
      storeId: 'ops',
      project: 'url-project',
      environment: 'staging',
    });
    createSpy.mockReturnValue(new Subject<IncidentApiResult<IncidentDetail>>());
    peek(fixture.componentInstance).title = 'Scoped incident';
    peek(fixture.componentInstance).submit();

    expect(createSpy.mock.calls[0][0]).toBe('url-agent:8989');
    expect(createSpy.mock.calls[0][1]).toMatchObject({
      storeId: 'ops',
      project: 'url-project',
      environment: 'staging',
      securityContextId: 'ctx-1',
    });
  });

  it('ignores a late success after the active agent changes', () => {
    const result$ = new Subject<IncidentApiResult<IncidentDetail>>();
    createSpy.mockReturnValue(result$);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).submit();
    storeId$.next('other:8989');
    fixture.detectChanges();

    result$.next({ kind: 'ok', data: incident() });

    expect(peek(fixture.componentInstance).isSubmitting()).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores a late failure after the security context changes', () => {
    const result$ = new Subject<IncidentApiResult<IncidentDetail>>();
    createSpy.mockReturnValue(result$);

    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).submit();
    securityContextId.set('ctx-2');
    fixture.detectChanges();

    result$.next({ kind: 'error', message: 'stale failure' });

    expect(peek(fixture.componentInstance).isSubmitting()).toBe(false);
    expect(peek(fixture.componentInstance).errorMessage()).toBeUndefined();
  });

  it('uses a new idempotency key after the active agent changes', () => {
    createSpy.mockReturnValue(
      of({
        kind: 'error',
        message: 'try again',
      } satisfies IncidentApiResult<IncidentDetail>),
    );
    randomIdSpy
      .mockReturnValueOnce('original-agent')
      .mockReturnValueOnce('new-agent');

    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).submit();
    const firstRequest = createSpy.mock.calls[0][1] as CreateIncidentRequest;

    storeId$.next('other:8989');
    fixture.detectChanges();
    peek(fixture.componentInstance).submit();
    const secondRequest = createSpy.mock.calls[1][1] as CreateIncidentRequest;

    expect(createSpy.mock.calls[1][0]).toBe('other:8989');
    expect(secondRequest.mutationId).not.toBe(firstRequest.mutationId);
  });
});
