import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  RouterLink,
} from '@angular/router';
import { By } from '@angular/platform-browser';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { PublicDemoInvestigationPreviewComponent } from './public-demo-investigation-preview.component';

describe('PublicDemoInvestigationPreviewComponent', () => {
  let fixture: ComponentFixture<PublicDemoInvestigationPreviewComponent>;
  let project$: BehaviorSubject<{ ref: typeof DEMO_PROJECT_REF } | undefined>;
  let params$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  async function render(section: 'sessions' | 'incidents', exampleId?: string) {
    project$ = new BehaviorSubject<
      { ref: typeof DEMO_PROJECT_REF } | undefined
    >({ ref: DEMO_PROJECT_REF });
    params$ = new BehaviorSubject(
      convertToParamMap(exampleId ? { exampleId } : {}),
    );
    await TestBed.configureTestingModule({
      imports: [PublicDemoInvestigationPreviewComponent],
      providers: [
        provideRouter([]),
        {
          provide: SneatAuthStateService,
          useValue: { authState: of({ status: 'notAuthenticated' }) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params$.asObservable(),
            snapshot: { paramMap: params$.value, data: { section } },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: project$.asObservable() },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PublicDemoInvestigationPreviewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders a Session sample entry and a detail with all actual public destinations', async () => {
    await render('sessions');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'Sample Sessions',
    );
    expect(
      fixture.nativeElement.querySelector('ion-item h2')?.textContent,
    ).toContain('Customer coverage investigation');

    params$.next(
      convertToParamMap({ exampleId: 'customer-coverage-investigation' }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Read-only sample Session');
    const links = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .map(
        (debugElement) =>
          debugElement.injector.get(RouterLink).urlTree?.toString() ?? '',
      );
    expect(
      links.some(
        (url) =>
          url.includes('/query/demodb%2Fchinook-customer-inventory') &&
          url.includes('id=demodb%2Fchinook-customer-inventory'),
      ),
    ).toBe(true);
    expect(
      links.some((url) => url.endsWith('/checks/chinook-customer-coverage')),
    ).toBe(true);
    expect(
      links.some((url) =>
        url.endsWith('/checks/chinook-customer-coverage-failure'),
      ),
    ).toBe(true);
    expect(links.some((url) => url.endsWith('/sessions'))).toBe(true);
  });

  it('renders the pinned baseline incident with the expected and observed counts', async () => {
    await render('incidents', 'customer-coverage-gap');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('pre-recorded example');
    expect(text).toContain('not a fresh server result');
    expect(text).toContain('60');
    expect(text).toContain('59');
    const links = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .map(
        (debugElement) =>
          debugElement.injector.get(RouterLink).urlTree?.toString() ?? '',
      );
    expect(
      links.some((url) =>
        url.endsWith('/checks/chinook-customer-coverage-failure'),
      ),
    ).toBe(true);
  });

  it('keeps the page loading until project context resolves', async () => {
    const currentProject$ = new Subject<
      { ref: typeof DEMO_PROJECT_REF } | undefined
    >();
    await TestBed.configureTestingModule({
      imports: [PublicDemoInvestigationPreviewComponent],
      providers: [
        provideRouter([]),
        {
          provide: SneatAuthStateService,
          useValue: { authState: of({ status: 'notAuthenticated' }) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({})),
            snapshot: {
              paramMap: convertToParamMap({}),
              data: { section: 'sessions' },
            },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: currentProject$.asObservable() },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PublicDemoInvestigationPreviewComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Loading project context',
    );
    expect(fixture.nativeElement.textContent).not.toContain('unavailable');

    currentProject$.next({ ref: DEMO_PROJECT_REF });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'Sample Sessions',
    );
  });

  it('keeps unknown examples and non-demo references useful without exposing sample content', async () => {
    await render('incidents', 'missing-example');
    expect(fixture.nativeElement.textContent).toContain(
      'Sample Incident unavailable',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Customer coverage is one below expected',
    );

    project$.next({
      ref: {
        storeId: 'localhost:8989',
        projectId: 'shop',
      } as typeof DEMO_PROJECT_REF,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Read-only investigation samples are available only',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Expected customers',
    );
  });
});
