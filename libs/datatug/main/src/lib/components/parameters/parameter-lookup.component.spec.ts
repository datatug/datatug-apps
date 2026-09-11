import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { Subject } from 'rxjs';

import { ParameterLookupComponent } from './parameter-lookup.component';
import { DatatugStoreService } from '../../services/repo/datatug-store.service';
import { IExecuteResponse } from '../../dto/execute';

describe('ParameterLookupComponent', () => {
  let component: ParameterLookupComponent;
  let fixture: ComponentFixture<ParameterLookupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParameterLookupComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: DatatugStoreService, useValue: {} },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ModalController,
          useValue: { dismiss: vi.fn(() => Promise.resolve()) },
        },
      ],
    })
      .overrideComponent(ParameterLookupComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ParameterLookupComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for the zoneless bug class this repo hit in
 * pages/signed-in/project/project-page.component.ts (PR #95) and is now
 * guarded fleet-wide by tools/check-zoneless-fields.mjs: `grid` used to be a
 * plain field, written from inside the `.subscribe()` callback in
 * ngOnInit(). This app runs `provideZonelessChangeDetection()`
 * (apps/datatug-app/src/main.ts), so a plain-field write from an async
 * callback never schedules a repaint on its own — the lookup grid would
 * never appear once the query result arrived, with no unrelated event
 * around to accidentally mask the gap.
 *
 * The real DataGridComponent renders via the real Tabulator library, which
 * is unnecessary risk for a unit test of this specific bug (and not this
 * component's own concern) — this test overrides the template with a
 * minimal text projection of `grid()` instead, while still exercising the
 * real component class end to end: the real `ngOnInit()`, the real
 * `.subscribe()` callback, the real signal write.
 *
 * Uses a `Subject`, not `of(response)`, so the response arrives strictly
 * after the initial render — matching real HTTP timing — and never calls
 * `fixture.detectChanges()` again afterwards, relying only on
 * `fixture.whenStable()` to prove the signal write alone re-renders the
 * grid summary with no manual intervention.
 */
describe('ParameterLookupComponent renders the grid once the lookup response arrives (zoneless)', () => {
  let fixture: ComponentFixture<ParameterLookupComponent>;
  let lookupResponse$: Subject<IExecuteResponse>;

  beforeEach(async () => {
    lookupResponse$ = new Subject<IExecuteResponse>();

    await TestBed.configureTestingModule({
      imports: [ParameterLookupComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: DatatugStoreService, useValue: {} },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ModalController,
          useValue: { dismiss: vi.fn(() => Promise.resolve()) },
        },
      ],
    })
      .overrideComponent(ParameterLookupComponent, {
        set: {
          imports: [],
          template: '<p>columns: {{ grid()?.columns?.length ?? "none" }}</p>',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ParameterLookupComponent);
    fixture.componentRef.setInput('lookupResponse', lookupResponse$.asObservable());
  });

  it('shows the grid column count once the lookup response arrives, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — no response has arrived yet
    expect(fixture.nativeElement.textContent).toContain('columns: none');

    const response: IExecuteResponse = {
      duration: 1,
      commands: [
        {
          commandId: 'cmd-1',
          items: [
            {
              type: 'recordset',
              value: {
                columns: [
                  { name: 'id', dbType: 'INT' },
                  { name: 'title', dbType: 'NVARCHAR' },
                ],
                rows: [],
              },
            },
          ],
        },
      ],
    };

    // The response arrives strictly after the initial render — no
    // detectChanges() call between this and the assertion below; only
    // whenStable().
    lookupResponse$.next(response);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('columns: 2');
  });
});
