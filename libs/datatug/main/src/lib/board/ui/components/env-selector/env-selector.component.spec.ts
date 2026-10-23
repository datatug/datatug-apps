import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';

import { EnvSelectorComponent } from './env-selector.component';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { IProjectContext } from '../../../../nav/nav-models';
import { provideMockErrorLogger } from '../../../../testing/error-logger.spec-helper';

describe('EnvSelectorComponent', () => {
  let component: EnvSelectorComponent;
  let fixture: ComponentFixture<EnvSelectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EnvSelectorComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
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
        provideMockErrorLogger(),
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
  });

  it('renders the fetched environments and selects the fetched current env, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — nothing has arrived yet
    expect(fixture.nativeElement.textContent).toContain('currentEnvId:');
    expect(
      fixture.nativeElement.querySelectorAll('ion-segment-button').length,
    ).toBe(0); // An unverified list must not invent a Local option

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
    const summary = project.summary;
    if (!summary) throw new Error('Expected project summary fixture.');
    currentProject$.next({ ...project, summary: { ...summary, environments: undefined } });
    await fixture.whenStable();
    expect(fixture.componentInstance.currentEnvId()).toBeUndefined();
    expect(fixture.nativeElement.querySelectorAll('ion-segment-button').length).toBe(0);
    currentProject$.next(project);
    await fixture.whenStable();
    expect(fixture.componentInstance.currentEnvId()).toBe('prod');

  });
  it('clears stale project and account environments after rendering without manual change detection', async () => {
    fixture.detectChanges();
    currentProject$.next({ ref: { storeId: 'firestore', projectId: 'A' }, summary: {
      id: 'A', title: 'A', access: 'private', environments: [{ id: 'secret-a', title: 'Secret A' }],
    } });
    currentEnv$.next({ id: 'secret-a' });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Secret A');
    currentProject$.next({ ref: { storeId: 'firestore', projectId: 'B' }, summary: { id: 'B', title: 'B', access: 'private' } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Secret A');
    expect(fixture.componentInstance.environments()).toBeUndefined();
    expect(fixture.componentInstance.currentEnvId()).toBeUndefined();
    currentProject$.next({ ref: { storeId: 'firestore', projectId: 'B' }, summary: {
      id: 'B', title: 'B', access: 'private', environments: [{ id: 'prod', title: 'Verified B' }],
    } });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Verified B');
    currentProject$.next(undefined);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Verified B');
    expect(fixture.componentInstance.environments()).toBeUndefined();
  });

});
