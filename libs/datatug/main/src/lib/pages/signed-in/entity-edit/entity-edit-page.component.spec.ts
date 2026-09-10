import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { PopoverController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { of, Subject } from 'rxjs';

import { EntityEditPageComponent } from './entity-edit-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { EntityService } from '../../../services/unsorted/entity.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { IProjectContext } from '../../../nav/nav-models';

describe('EntityEditPage', () => {
  let component: EntityEditPageComponent;
  let fixture: ComponentFixture<EntityEditPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityEditPageComponent],
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
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
          },
        },
        { provide: EntityService, useValue: { createEntity: vi.fn() } },
        { provide: DatatugNavService, useValue: { goEntity: vi.fn() } },
        { provide: PopoverController, useValue: { create: vi.fn() } },
      ],
    })
      .overrideComponent(EntityEditPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EntityEditPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for the zoneless bug class this repo hit in
 * pages/signed-in/project/project-page.component.ts (PR #95) and is now
 * guarded fleet-wide by tools/check-zoneless-fields.mjs: `backUrl` used to
 * be a plain field, written from inside the `.subscribe()` callback in the
 * constructor. This app runs `provideZonelessChangeDetection()`
 * (apps/datatug-app/src/main.ts), so a plain-field write from an async
 * callback never schedules a repaint on its own — the back button would
 * keep pointing at "/" forever once the real project context arrived, with
 * no unrelated event around to accidentally mask the gap.
 *
 * Uses a `Subject`, not `of(...)`, so the project arrives strictly after the
 * initial render — matching real nav-context timing — and never calls
 * `fixture.detectChanges()` again afterwards, relying only on
 * `fixture.whenStable()` to prove the signal write alone re-renders the
 * back button with no manual intervention.
 */
describe('EntityEditPage re-targets the back button once the project arrives (zoneless)', () => {
  let component: EntityEditPageComponent;
  let fixture: ComponentFixture<EntityEditPageComponent>;
  let currentProject$: Subject<IProjectContext | undefined>;

  beforeEach(async () => {
    currentProject$ = new Subject<IProjectContext | undefined>();

    await TestBed.configureTestingModule({
      imports: [EntityEditPageComponent],
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
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: currentProject$.asObservable(),
            currentEnv: of(undefined),
          },
        },
        { provide: EntityService, useValue: { createEntity: vi.fn() } },
        { provide: DatatugNavService, useValue: { goEntity: vi.fn() } },
        { provide: PopoverController, useValue: { create: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EntityEditPageComponent);
    component = fixture.componentInstance;
  });

  function findBackButton(): HTMLElement & { defaultHref?: string } {
    return fixture.nativeElement.querySelector(
      'ion-back-button',
    ) as HTMLElement & { defaultHref?: string };
  }

  it('points the back button at the project entities list once it arrives, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — no project has arrived yet
    expect(findBackButton().defaultHref).toBe('/');

    const project: IProjectContext = {
      ref: { projectId: 'p1', storeId: 'firestore' },
    };

    // The project arrives strictly after the initial render — no
    // detectChanges() call between this and the assertion below; only
    // whenStable().
    currentProject$.next(project);
    await fixture.whenStable();

    expect(findBackButton().defaultHref).toBe(
      '/store/firestore/project/p1/entities',
    );
  });
});
