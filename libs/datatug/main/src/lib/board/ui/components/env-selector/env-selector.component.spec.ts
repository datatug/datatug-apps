import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { of, Subject } from 'rxjs';

import { EnvSelectorComponent } from './env-selector.component';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { IProjectContext } from '../../../../nav/nav-models';

describe('EnvSelectorComponent', () => {
  let component: EnvSelectorComponent;
  let fixture: ComponentFixture<EnvSelectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EnvSelectorComponent],
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
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
      ],
    })
      .overrideComponent(EnvSelectorComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EnvSelectorComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for the zoneless bug class this repo hit in
 * pages/signed-in/project/project-page.component.ts (PR #95) and is now
 * guarded fleet-wide by tools/check-zoneless-fields.mjs: `environments` and
 * `currentEnvId` used to be plain fields, written from inside `.subscribe()`
 * callbacks in the constructor. This app runs
 * `provideZonelessChangeDetection()` (apps/datatug-app/src/main.ts), so a
 * plain-field write from an async callback never schedules a repaint on its
 * own — the segment would stay on its "Local" placeholder forever once the
 * real project/environment data arrived, with no unrelated event around to
 * accidentally mask the gap.
 *
 * Uses `Subject`s, not `of(...)`, so the values arrive strictly after the
 * initial render — matching real HTTP/nav-context timing — and never calls
 * `fixture.detectChanges()` again afterwards, relying only on
 * `fixture.whenStable()` to prove the signal writes alone re-render the
 * segment with no manual intervention.
 */
describe('EnvSelectorComponent renders the current project/env once they arrive (zoneless)', () => {
  let component: EnvSelectorComponent;
  let fixture: ComponentFixture<EnvSelectorComponent>;
  let currentProject$: Subject<IProjectContext | undefined>;
  let currentEnv$: Subject<{ id?: string } | undefined>;

  beforeEach(async () => {
    currentProject$ = new Subject<IProjectContext | undefined>();
    currentEnv$ = new Subject<{ id?: string } | undefined>();

    await TestBed.configureTestingModule({
      imports: [EnvSelectorComponent],
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
          provide: DatatugNavContextService,
          useValue: {
            currentProject: currentProject$.asObservable(),
            currentEnv: currentEnv$.asObservable(),
            setCurrentEnvironment: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EnvSelectorComponent);
    component = fixture.componentInstance;
  });

  it('renders the fetched environments and selects the fetched current env, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — nothing has arrived yet
    expect(fixture.nativeElement.textContent).toContain('currentEnvId:');
    expect(
      fixture.nativeElement.querySelectorAll('ion-segment-button').length,
    ).toBe(1); // just the "Local" placeholder

    const project: IProjectContext = {
      ref: { projectId: 'p1', storeId: 'firestore' },
      summary: {
        id: 'p1',
        title: 'Project 1',
        access: 'private',
        environments: [
          { id: 'dev', title: 'Dev' },
          { id: 'prod', title: 'Prod' },
        ],
      },
    };

    // Both arrive strictly after the initial render — no detectChanges()
    // call between this and the assertions below; only whenStable().
    currentProject$.next(project);
    currentEnv$.next({ id: 'prod' });
    await fixture.whenStable();

    expect(
      fixture.nativeElement.querySelectorAll('ion-segment-button').length,
    ).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('currentEnvId: prod');
  });
});
