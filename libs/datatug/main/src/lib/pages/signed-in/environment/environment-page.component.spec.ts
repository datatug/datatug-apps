import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { EnvironmentPageComponent } from './environment-page.component';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { IEnvironmentSummary } from '../../../models/definition/environments';

const project = { ref: { storeId: 'github.com', projectId: 'r@o@' } };
describe('EnvironmentPage', () => {
  let fixture: ComponentFixture<EnvironmentPageComponent>;
  let summary: Subject<IEnvironmentSummary>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let currentProject: BehaviorSubject<
    import('../../../nav/nav-models').IProjectContext
  >;
  let getSummary: ReturnType<typeof vi.fn>;
  const goCatalog = vi.fn();
  beforeEach(async () => {
    summary = new Subject();
    currentProject = new BehaviorSubject(project);
    params = new BehaviorSubject(convertToParamMap({ environmentId: 'QA' }));
    getSummary = vi.fn(() => summary);
    goCatalog.mockClear();
    await TestBed.configureTestingModule({
      imports: [EnvironmentPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        {
          provide: EnvironmentService,
          useValue: { getEnvSummary: getSummary },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject },
        },
        { provide: DatatugNavService, useValue: { goCatalog } },
        { provide: ErrorLogger, useValue: { logError: vi.fn() } },
      ],
    })
      .overrideComponent(EnvironmentPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(EnvironmentPageComponent);
    fixture.detectChanges();
  });

  it('loads a cold deep link and renders an async summary without another detectChanges', async () => {
    expect(getSummary).toHaveBeenCalledWith(project.ref, 'QA');
    summary.next({
      id: 'QA',
      title: 'QA',
      editionConnections: ['chinook-postgresql'],
      presentation: {
        label: 'Acceptance',
        tone: 'warning',
        icon: 'flask-outline',
      },
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Acceptance');
    expect(el.textContent).toContain('Use caution');
    expect(el.textContent).toContain('chinook-postgresql');
    expect(el.textContent).toContain('do not enable browser query execution');
    expect(el.textContent).not.toContain('Sign in');
    expect(
      el.querySelectorAll('[data-testid="edition-assignment"]'),
    ).toHaveLength(1);
  });

  it('keeps catalog navigation in the loaded environment', async () => {
    summary.next({
      id: 'QA',
      title: 'QA',
      dbServers: [
        {
          id: 'sqlite',
          driver: 'sqlite3',
          host: '',
          catalogs: ['chinook-local'],
        },
      ],
    });
    await fixture.whenStable();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="environment-catalog"]',
      ) as HTMLElement
    ).click();
    expect(goCatalog).toHaveBeenCalledWith(project, 'QA', 'chinook-local');
  });

  it('cancels the old environment request when the route changes', async () => {
    const previous = summary;
    summary = new Subject();
    params.next(convertToParamMap({ environmentId: 'UAT' }));
    previous.next({ id: 'QA', title: 'Stale QA' });
    summary.next({ id: 'UAT', title: 'UAT' });
    await fixture.whenStable();
    expect(fixture.componentInstance.env()?.id).toBe('UAT');
    expect(fixture.nativeElement.textContent).not.toContain('Stale QA');
    expect(fixture.nativeElement.textContent).toContain('No data connections');
  });

  it.each([
    { branch: 'release' },
    { spaceID: 'space-b' },
    { projectApi: 'cloud' as const },
  ])('reloads when only the project ref changes: %j', async (change) => {
    currentProject.next({ ref: { ...project.ref, ...change } });
    expect(getSummary).toHaveBeenLastCalledWith(
      { ...project.ref, ...change },
      'QA',
    );
    expect(getSummary).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.project()?.ref).toEqual({
      ...project.ref,
      ...change,
    });
  });

  it('replaces loading with an explicit error', async () => {
    summary.error(new Error('unavailable'));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'Could not load this environment',
    );
    expect(fixture.nativeElement.querySelector('ion-skeleton-text')).toBeNull();
  });
});
