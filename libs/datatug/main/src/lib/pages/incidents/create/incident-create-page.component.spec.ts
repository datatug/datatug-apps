import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { IncidentCreatePageComponent } from './incident-create-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import { IncidentApiResult, IncidentDetail } from '../../../incidents/models';

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
  let storeId$: Subject<string | undefined>;
  let createSpy: ReturnType<typeof vi.fn>;
  let router: Router;

  const render = async () => {
    storeId$ = new Subject<string | undefined>();
    createSpy = vi.fn();

    await TestBed.configureTestingModule({
      imports: [IncidentCreatePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DatatugNavContextService,
          useValue: { currentStoreId: storeId$ },
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
      'Open a project first',
    );
  });

  it('calls the client with the trimmed title and description', () => {
    storeId$.next('localhost:8989');
    const result$ = new Subject<IncidentApiResult<IncidentDetail>>();
    createSpy.mockReturnValue(result$);

    peek(fixture.componentInstance).title = '  Checkout errors spike  ';
    peek(fixture.componentInstance).description = '  5xx rate up  ';
    peek(fixture.componentInstance).submit();

    expect(createSpy).toHaveBeenCalledWith('localhost:8989', {
      title: 'Checkout errors spike',
      description: '5xx rate up',
    });
  });

  it('navigates to the deep-linkable detail route on success', () => {
    storeId$.next('localhost:8989');
    createSpy.mockReturnValue(
      of({
        kind: 'ok',
        data: { id: 'INC-1', title: 'x', status: 'open' },
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
    expect(peek(fixture.componentInstance).title).toBe(
      'Checkout errors spike',
    );
    expect(peek(fixture.componentInstance).description).toBe('draft text');
  });
});
