import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { InvestigationScenario } from './models';
import {
  PublicScenarioCatalogService,
  PublicScenarioNotFoundError,
} from './public-scenario-catalog';
import { PublicScenariosPageComponent } from './public-scenarios-page.component';

const scenario: InvestigationScenario = {
  id: 'chinook-customer-coverage-walkthrough',
  title: 'Review customer coverage',
  description: 'Follow the inventory query and coverage Check.',
  version: 1,
  inputs: [],
  steps: [
    {
      id: 'inventory',
      kind: 'query',
      ref: 'demodb/chinook-customer-inventory',
    },
    { id: 'coverage', kind: 'check', ref: 'chinook-customer-coverage' },
  ],
};

describe('PublicScenariosPageComponent', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let project: BehaviorSubject<{ ref: typeof DEMO_PROJECT_REF }>;
  const catalog = {
    list: vi.fn(() => of([scenario])),
    get: vi.fn(() => of(scenario)),
  };

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({}));
    project = new BehaviorSubject({ ref: DEMO_PROJECT_REF });
    catalog.list.mockReset().mockReturnValue(of([scenario]));
    catalog.get.mockReset().mockReturnValue(of(scenario));
    await TestBed.configureTestingModule({
      imports: [PublicScenariosPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params, snapshot: { paramMap: params.value } },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: project },
        },
        { provide: PublicScenarioCatalogService, useValue: catalog },
      ],
    }).compileComponents();
  });

  it('shows a read-only catalog at the canonical public demo entry', async () => {
    const fixture = TestBed.createComponent(PublicScenariosPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(catalog.list).toHaveBeenCalledOnce();
    expect(text).toContain('Public Scenarios');

    expect(
      fixture.nativeElement.querySelector('ion-item h2')?.textContent,
    ).toContain(scenario.title);
    expect(text).not.toMatch(
      /New Case|New Scenario|Apply Scenario|Edit Scenario/,
    );
  });

  it('does not read GitHub content for a noncanonical project context', async () => {
    project.next({
      ref: { storeId: 'github.com', projectId: 'someone/other@demo' },
    });
    const fixture = TestBed.createComponent(PublicScenariosPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(catalog.list).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'canonical DataTug demo project',
    );
    expect(
      fixture.nativeElement
        .querySelector('main')
        ?.getAttribute('aria-labelledby'),
    ).toBe(fixture.nativeElement.querySelector('main h1')?.id);
  });

  it('renders query and Check steps as links from a cold detail URL', async () => {
    params.next(convertToParamMap({ scenarioId: scenario.id }));
    const fixture = TestBed.createComponent(PublicScenariosPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const anchors = Array.from(
      fixture.nativeElement.querySelectorAll('a'),
    ) as HTMLAnchorElement[];
    const queryLink = anchors.find((anchor) =>
      anchor.textContent?.includes('Query: demodb/chinook-customer-inventory'),
    );
    const checkLink = anchors.find((anchor) =>
      anchor.textContent?.includes('Check: chinook-customer-coverage'),
    );
    expect(catalog.get).toHaveBeenCalledWith(DEMO_PROJECT_REF, scenario.id);
    const headings = Array.from(
      fixture.nativeElement.querySelectorAll(
        'article h3',
      ) as NodeListOf<HTMLElement>,
    ).map((heading) => heading.textContent?.trim());
    expect(headings).toEqual([
      '1. Inspect the saved query',
      '2. Run the Check',
    ]);
    expect(queryLink?.getAttribute('href')).toContain(
      '/query/demodb%2Fchinook-customer-inventory',
    );
    expect(queryLink?.getAttribute('href')).toContain(
      'id=demodb%2Fchinook-customer-inventory',
    );
    expect(checkLink?.getAttribute('href')).toContain(
      '/checks/chinook-customer-coverage',
    );
  });

  it('offers retry after a catalog read fails', async () => {
    catalog.list
      .mockReturnValueOnce(throwError(() => new Error('network down')))
      .mockReturnValueOnce(of([]));
    const fixture = TestBed.createComponent(PublicScenariosPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Please try again.');

    (fixture.componentInstance as unknown as { retry: () => void }).retry();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(catalog.list).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('No public Scenarios');
  });

  it('shows an explicit missing state for an absent cold detail link', async () => {
    params.next(convertToParamMap({ scenarioId: 'missing-scenario' }));
    catalog.get.mockReturnValue(
      throwError(() => new PublicScenarioNotFoundError('missing-scenario')),
    );
    const fixture = TestBed.createComponent(PublicScenariosPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Scenario missing-scenario was not found',
    );
    expect(fixture.nativeElement.querySelector('main h1')?.textContent).toBe(
      'Scenario',
    );
  });
});
