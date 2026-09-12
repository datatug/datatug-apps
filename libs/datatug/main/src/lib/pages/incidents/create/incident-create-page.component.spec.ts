import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { IncidentCreatePageComponent } from './incident-create-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import { IncidentApiResult, IncidentDetail } from '../../../incidents/models';
import { AgentContextService } from '@sneat/datatug-semantic';
import { RandomIdService } from '@sneat/random';

interface Internals {
  title: string;
  description: string;
  submit(): void;
  isSubmitting(): boolean;
  errorMessage(): string | undefined;
}
const peek = (c: IncidentCreatePageComponent): Internals =>
  c as unknown as Internals;

describe('IncidentCreatePageComponent', () => {
  let fixture: ComponentFixture<IncidentCreatePageComponent>;
  let storeId$: BehaviorSubject<string | undefined>;
  let project$: BehaviorSubject<{
    ref: { storeId: string; projectId: string };
  }>;
  let environment$: BehaviorSubject<{ id: string }>;
  let securityContextId: ReturnType<typeof signal<string | undefined>>;
  let createSpy: ReturnType<typeof vi.fn>;
  let randomIdSpy: ReturnType<typeof vi.fn>;
  let router: Router;

  const render = async () => {
    storeId$ = new BehaviorSubject<string | undefined>('localhost:8989');
    project$ = new BehaviorSubject({
      ref: { storeId: 'localhost:8989', projectId: 'billing' },
    });
    environment$ = new BehaviorSubject({ id: 'prod' });
    securityContextId = signal<string | undefined>('ctx-1');
    createSpy = vi.fn();
    randomIdSpy = vi.fn(() => 'test-id');

    await TestBed.configureTestingModule({
      imports: [IncidentCreatePageComponent],
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
        {
          provide: AgentContextService,
          useValue: { securityContextId },
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
    storeId$.next('localhost:8989');
    peek(fixture.componentInstance).title = '   ';
    peek(fixture.componentInstance).submit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('reports guidance when no store is in context yet', () => {
    storeId$.next(undefined);
    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).submit();

    expect(createSpy).not.toHaveBeenCalled();
    expect(peek(fixture.componentInstance).errorMessage()).toContain(
      'Open a project and environment',
    );
  });

  it('calls the client with the trimmed title and description', () => {
    storeId$.next('localhost:8989');
    const result$ = new Subject<IncidentApiResult<IncidentDetail>>();
    createSpy.mockReturnValue(result$);

    peek(fixture.componentInstance).title = '  Checkout errors spike  ';
    peek(fixture.componentInstance).description = '  5xx rate up  ';
    peek(fixture.componentInstance).submit();

    expect(createSpy).toHaveBeenCalledWith({
      storeId: 'localhost:8989',
      project: 'billing',
      environment: 'prod',
      securityContextId: 'ctx-1',
      mutationId: 'incident-create-test-id',
      title: 'Checkout errors spike',
      description: '5xx rate up',
      projects: [
        {
          storeId: 'localhost:8989',
          projectId: 'billing',
          environment: 'prod',
        },
      ],
    });
  });

  it('navigates to the deep-linkable detail route on success', () => {
    storeId$.next('localhost:8989');
    createSpy.mockReturnValue(
      of({
        kind: 'ok',
        data: {
          ref: { storeId: 'localhost:8989', incidentId: 'INC-1' },
          uid: 'uid-1',
          title: 'x',
          status: 'open',
          lastSeq: 1,
        },
      } satisfies IncidentApiResult<IncidentDetail>),
    );
    const navigateSpy = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).submit();

    expect(navigateSpy).toHaveBeenCalledWith(
      '/incidents/localhost%3A8989/INC-1',
    );
  });

  it('keeps the draft and reports the failure when the server is unavailable', () => {
    storeId$.next('localhost:8989');
    createSpy.mockReturnValue(
      of({
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      } satisfies IncidentApiResult<IncidentDetail>),
    );

    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).description = 'draft text';
    peek(fixture.componentInstance).submit();

    expect(peek(fixture.componentInstance).errorMessage()).toBe(
      'The incident store is not available on this server yet.',
    );
    // The draft is never cleared on failure.
    expect(peek(fixture.componentInstance).title).toBe('Checkout errors spike');
    expect(peek(fixture.componentInstance).description).toBe('draft text');

    // A retry after a lost/unavailable response carries the same mutation id,
    // so the server can return the durable receipt instead of duplicating it.
    peek(fixture.componentInstance).submit();
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(randomIdSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[1][0].mutationId).toBe(
      createSpy.mock.calls[0][0].mutationId,
    );
  });

  it('ignores a late success after the active store changes', () => {
    const result$ = new Subject<IncidentApiResult<IncidentDetail>>();
    createSpy.mockReturnValue(result$);
    const navigateSpy = vi
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true);

    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).submit();
    expect(peek(fixture.componentInstance).isSubmitting()).toBe(true);

    storeId$.next('other:8989');
    fixture.detectChanges();
    expect(peek(fixture.componentInstance).isSubmitting()).toBe(false);

    result$.next({
      kind: 'ok',
      data: {
        ref: { storeId: 'localhost:8989', incidentId: 'INC-1' },
        uid: 'uid-1',
        title: 'Checkout errors spike',
        status: 'open',
        lastSeq: 1,
      },
    });

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(peek(fixture.componentInstance).errorMessage()).toBeUndefined();
  });

  it('ignores a late failure after the security context changes', () => {
    const result$ = new Subject<IncidentApiResult<IncidentDetail>>();
    createSpy.mockReturnValue(result$);

    peek(fixture.componentInstance).title = 'Checkout errors spike';
    peek(fixture.componentInstance).submit();
    expect(peek(fixture.componentInstance).isSubmitting()).toBe(true);

    securityContextId.set('ctx-2');
    fixture.detectChanges();
    expect(peek(fixture.componentInstance).isSubmitting()).toBe(false);

    result$.next({
      kind: 'unavailable',
      message: 'The incident store is not available on this server yet.',
    });

    expect(peek(fixture.componentInstance).errorMessage()).toBeUndefined();
  });
});
