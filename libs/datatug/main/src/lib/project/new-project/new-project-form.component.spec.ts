import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PopoverController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { Subject } from 'rxjs';

import { NewProjectFormComponent } from './new-project-form.component';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { ProjectService } from '../../services/project/project.service';

describe('NewProjectFormComponent', () => {
  let component: NewProjectFormComponent;
  let fixture: ComponentFixture<NewProjectFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewProjectFormComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ProjectService,
          useValue: { createNewProject: vi.fn(() => new Subject()) },
        },
        {
          provide: PopoverController,
          useValue: { dismiss: vi.fn(() => Promise.resolve(true)) },
        },
        { provide: DatatugNavService, useValue: { goProject: vi.fn() } },
      ],
    })
      .overrideComponent(NewProjectFormComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(NewProjectFormComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for the zoneless bug class this repo hit in
 * pages/signed-in/project/project-page.component.ts (PR #95) and is now
 * guarded fleet-wide by tools/check-zoneless-fields.mjs: `isCreating` used to
 * be a plain field, set back to `false` from inside the `.subscribe()` error
 * callback in `create()`. This app runs `provideZonelessChangeDetection()`
 * (apps/datatug-app/src/main.ts), so a plain-field write from an async
 * callback never schedules a repaint on its own — the "Create new project"
 * and "Cancel" buttons would stay disabled forever after a failed create,
 * with no unrelated event around to accidentally mask the gap.
 *
 * Uses a `Subject`, not `throwError(...)`, so the error arrives strictly
 * after the click — matching real HTTP timing — and never calls
 * `fixture.detectChanges()` again after the click, relying only on
 * `fixture.whenStable()` to prove the signal write alone re-renders the
 * buttons with no manual intervention.
 */
describe('NewProjectFormComponent re-enables its buttons after a failed create (zoneless)', () => {
  let component: NewProjectFormComponent;
  let fixture: ComponentFixture<NewProjectFormComponent>;
  let createNewProject$: Subject<string>;

  beforeEach(async () => {
    createNewProject$ = new Subject<string>();

    await TestBed.configureTestingModule({
      imports: [NewProjectFormComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ProjectService,
          useValue: {
            createNewProject: vi.fn(() => createNewProject$.asObservable()),
          },
        },
        {
          provide: PopoverController,
          useValue: { dismiss: vi.fn(() => Promise.resolve(true)) },
        },
        { provide: DatatugNavService, useValue: { goProject: vi.fn() } },
      ],
    })
      // NewProjectFormComponent's own `imports` array pulls in
      // DatatugServicesProjectModule directly (the standalone-component/
      // NgModule DI-duplication pattern this repo has elsewhere — see S126's
      // report on project-page.component.ts, PR #95): that module provides
      // its own real ProjectService on the component's injector, which
      // would shadow the mock above and pull in a real Firestore dependency.
      // Drop it for this test the same way PR #95 does. FormsModule is
      // dropped too — without Ionic's own forms integration registered,
      // NgModel has no value accessor for the ion-* custom elements;
      // CUSTOM_ELEMENTS_SCHEMA is enough to let `[(ngModel)]` through as a
      // plain (inert, for this test) property/event binding instead.
      .overrideComponent(NewProjectFormComponent, {
        set: {
          imports: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(NewProjectFormComponent);
    component = fixture.componentInstance;
  });

  function findCreateButton(): (HTMLElement & { disabled?: boolean }) | null {
    // Not the first `ion-button` in DOM order — that's the header's Cancel
    // (X) icon button, which has no [disabled] binding at all.
    const buttons = fixture.nativeElement.querySelectorAll('ion-button');
    return Array.from(buttons).find((el) =>
      (el as HTMLElement).textContent?.includes('Create new project'),
    ) as (HTMLElement & { disabled?: boolean }) | null;
  }

  it('re-enables the Create button once the failed request completes, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — not creating yet
    expect(findCreateButton()?.disabled).toBeFalsy();

    component.create();
    await fixture.whenStable();
    expect(findCreateButton()?.disabled).toBe(true);

    // The error arrives strictly after the click — no detectChanges() call
    // between this and the assertion below; only whenStable().
    createNewProject$.error(new Error('boom'));
    await fixture.whenStable();

    expect(findCreateButton()?.disabled).toBe(false);
  });
});
