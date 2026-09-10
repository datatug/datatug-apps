import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { Subject } from 'rxjs';

import { AddDbServerComponent } from './add-db-server.component';
import { DbServerService } from '../../../services/unsorted/db-server.service';
import { IDbServerSummary } from '../../../models/definition/apis/database';

describe('AddDbServerComponent', () => {
  let component: AddDbServerComponent;
  let fixture: ComponentFixture<AddDbServerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddDbServerComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ModalController,
          useValue: { create: vi.fn(), dismiss: vi.fn() },
        },
        { provide: DbServerService, useValue: { addDbServer: vi.fn() } },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    })
      .overrideComponent(AddDbServerComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AddDbServerComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for the zoneless bug class this repo hit in
 * pages/signed-in/project/project-page.component.ts (PR #95) and is now
 * guarded fleet-wide by tools/check-zoneless-fields.mjs: `submitting` used to
 * be a plain field, set back to `false` from inside the `.subscribe()`
 * error callback in `submit()`. This app runs
 * `provideZonelessChangeDetection()` (apps/datatug-app/src/main.ts), so a
 * plain-field write from an async callback never schedules a repaint on its
 * own — the "Add to project" button would stay disabled forever after a
 * failed submit, with no user-triggered event to mask the gap (there is no
 * unrelated click here the way there was in J1's dropdown workaround).
 *
 * Uses a `Subject`, not `throwError(...)`, so the error arrives strictly
 * after the initial render/click — matching real HTTP timing — and never
 * calls `fixture.detectChanges()` again after the click, relying only on
 * `fixture.whenStable()` to prove the signal write alone re-renders the
 * button with no manual intervention.
 */
describe('AddDbServerComponent re-enables the submit button after a failed submit (zoneless)', () => {
  let component: AddDbServerComponent;
  let fixture: ComponentFixture<AddDbServerComponent>;
  let addDbServer$: Subject<IDbServerSummary>;

  beforeEach(async () => {
    addDbServer$ = new Subject<IDbServerSummary>();

    await TestBed.configureTestingModule({
      imports: [AddDbServerComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ModalController,
          useValue: { create: vi.fn(), dismiss: vi.fn() },
        },
        {
          provide: DbServerService,
          useValue: { addDbServer: vi.fn(() => addDbServer$.asObservable()) },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AddDbServerComponent);
    component = fixture.componentInstance;
  });

  function findHostInput(): HTMLElement & { disabled?: boolean } {
    return fixture.nativeElement.querySelector(
      'ion-input',
    ) as HTMLElement & { disabled?: boolean };
  }

  it('re-enables the Host name input once the failed request completes, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — not submitting yet
    expect(findHostInput().disabled).toBeFalsy();

    component.submit();
    await fixture.whenStable();
    expect(findHostInput().disabled).toBe(true);

    // The error arrives strictly after the click — no detectChanges() call
    // between this and the assertion below; only whenStable().
    addDbServer$.error(new Error('boom'));
    await fixture.whenStable();

    expect(findHostInput().disabled).toBe(false);
  });
});
