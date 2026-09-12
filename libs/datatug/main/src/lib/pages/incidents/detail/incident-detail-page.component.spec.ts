import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { Observable, of, Subject } from 'rxjs';
import { IncidentDetailPageComponent } from './incident-detail-page.component';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import { IncidentApiResult, IncidentDetail } from '../../../incidents/models';

describe('IncidentDetailPageComponent', () => {
  let fixture: ComponentFixture<IncidentDetailPageComponent>;
  let paramMap$: Subject<ReturnType<typeof convertToParamMap>>;
  let getSpy: ReturnType<typeof vi.fn>;

  const render = async (
    initialParams: Record<string, string> = {
      storeId: 'localhost:8989',
      incidentId: 'INC-1',
    },
    // The client's `get()` return value must be wired up *before* the route
    // params are emitted below (that emission synchronously calls `get()`),
    // so it's a parameter here rather than set by the caller afterwards.
    getReturn: Observable<IncidentApiResult<IncidentDetail>> = new Subject(),
  ) => {
    paramMap$ = new Subject();
    getSpy = vi.fn().mockReturnValue(getReturn);

    await TestBed.configureTestingModule({
      imports: [IncidentDetailPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$,
            snapshot: { paramMap: convertToParamMap(initialParams) },
          },
        },
        { provide: IncidentClientService, useValue: { get: getSpy } },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(IncidentDetailPageComponent);
    fixture.detectChanges();
    paramMap$.next(convertToParamMap(initialParams));
    fixture.detectChanges();
  };

  it('reads storeId/incidentId from the route and calls the client', async () => {
    await render();
    expect(getSpy).toHaveBeenCalledWith('localhost:8989', 'INC-1');
  });

  it('renders the incident once loaded (same page regardless of which profile linked to it)', async () => {
    const result$ = new Subject<IncidentApiResult<IncidentDetail>>();
    await render(undefined, result$);

    result$.next({
      kind: 'ok',
      data: {
        ref: { storeId: 'localhost:8989', incidentId: 'INC-1' },
        uid: 'uid-1',
        title: 'Checkout errors spike',
        status: 'investigating',
        description: '5xx rate above baseline',
        lastSeq: 2,
      },
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Checkout errors spike');
    expect(fixture.nativeElement.innerHTML).toContain('investigating');
    expect(fixture.nativeElement.innerHTML).toContain(
      '5xx rate above baseline',
    );
  });

  it('shows the explicit unavailable state on a 404', async () => {
    await render(
      undefined,
      of({
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      } satisfies IncidentApiResult<IncidentDetail>),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain(
      'The incident store is not available on this server yet.',
    );
  });

  it('does nothing without both storeId and incidentId params', async () => {
    await render({ storeId: 'localhost:8989', incidentId: '' });
    expect(getSpy).not.toHaveBeenCalled();
  });
});
