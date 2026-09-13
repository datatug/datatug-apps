import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { IncidentListPageComponent } from './incident-list-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import { IncidentApiResult, IncidentSummary } from '../../../incidents/models';

const incident = (
  storeId: string,
  incidentId: string,
  title: string,
): IncidentSummary => ({
  ref: { storeId, incidentId },
  uid: `uid-${incidentId}`,
  title,
  status: 'open',
  lastSeq: 1,
});

describe('IncidentListPageComponent', () => {
  let fixture: ComponentFixture<IncidentListPageComponent>;
  let storeId$: Subject<string | undefined>;
  let listResult$: Subject<IncidentApiResult<IncidentSummary[]>>;
  let listSpy: ReturnType<typeof vi.fn>;

  const render = async () => {
    storeId$ = new Subject<string | undefined>();
    listResult$ = new Subject<IncidentApiResult<IncidentSummary[]>>();
    listSpy = vi.fn().mockReturnValue(listResult$);

    await TestBed.configureTestingModule({
      imports: [IncidentListPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DatatugNavContextService,
          useValue: { currentStoreId: storeId$ },
        },
        { provide: IncidentClientService, useValue: { list: listSpy } },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(IncidentListPageComponent);
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

  it('shows an "open a project" guidance state with no store in context', () => {
    storeId$.next(undefined);
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Open a project');
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('calls the client and renders incidents once a store is in context', () => {
    storeId$.next('localhost:8989');
    fixture.detectChanges();

    expect(listSpy).toHaveBeenCalledWith('localhost:8989');

    listResult$.next({
      kind: 'ok',
      data: [incident('localhost:8989', 'INC-1', 'Checkout errors spike')],
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Checkout errors spike');
  });

  it('ignores a stale response after the active store changes', () => {
    const nextStoreResult$ = new Subject<
      IncidentApiResult<IncidentSummary[]>
    >();
    listSpy
      .mockReturnValueOnce(listResult$)
      .mockReturnValueOnce(nextStoreResult$);

    storeId$.next('first-store');
    storeId$.next('second-store');

    nextStoreResult$.next({
      kind: 'ok',
      data: [incident('second-store', 'INC-2', 'Current store incident')],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.innerHTML).toContain('Current store incident');

    listResult$.next({
      kind: 'ok',
      data: [incident('first-store', 'INC-1', 'Stale store incident')],
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Current store incident');
    expect(fixture.nativeElement.innerHTML).not.toContain(
      'Stale store incident',
    );
  });

  it('shows the explicit unavailable state when the server 404s', () => {
    storeId$.next('localhost:8989');
    fixture.detectChanges();

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
    storeId$.next('localhost:8989');
    fixture.detectChanges();

    listResult$.next({ kind: 'ok', data: [] });
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('No incidents yet');
  });

  it('builds a store-scoped deep link to the detail route (IncidentRef in the URL)', () => {
    storeId$.next('localhost:8989');
    fixture.detectChanges();

    interface Internals {
      incidentLink(incident: IncidentSummary): string;
    }
    const peek = fixture.componentInstance as unknown as Internals;
    expect(peek.incidentLink(incident('localhost:8989', 'INC-1', 't'))).toBe(
      '/incidents/localhost%3A8989/INC-1',
    );
  });
});
