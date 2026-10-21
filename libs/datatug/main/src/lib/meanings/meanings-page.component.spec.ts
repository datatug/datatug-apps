import { By } from '@angular/platform-browser';
import type { IProjectRef } from '../core/project-context';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  RouterLink,
} from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MeaningsPageComponent } from './meanings-page.component';
import { ProjectMeaningsService } from './project-meanings.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import type { ProjectMeaningsCatalog } from './project-meanings-contract';

const ref = { storeId: 'firestore', spaceID: 's1', projectId: 'p1' };
const catalog: ProjectMeaningsCatalog = {
  version: 1,
  scope: { storage: 'firestore', spaceID: 's1', project: 'p1' },
  revision: 'r1',
  writable: true,
  referencesComplete: true,
  entities: [
    {
      documentId: 'project',
      conceptId: 'customer',
      name: 'Customer',
      description: 'A buyer',
      origin: 'project',
      resources: [],
      fields: [
        {
          documentId: 'project',
          conceptId: 'customer-id',
          name: 'Customer ID',
          description: 'Buyer identifier',
          resources: [],
        },
      ],
    },
  ],
};
describe('Meanings page route, mutation and zoneless lifecycle', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>,
    data: BehaviorSubject<{ meaningMode: string }>,
    project: BehaviorSubject<{ ref: IProjectRef }>;
  const service = { catalog: vi.fn(), change: vi.fn(), refForCatalog: vi.fn() };
  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({}));
    data = new BehaviorSubject({ meaningMode: 'list' });
    project = new BehaviorSubject<{ ref: IProjectRef }>({ ref });
    vi.resetAllMocks();
    service.catalog.mockReturnValue(of(catalog));
    service.change.mockReturnValue(of(catalog));
    service.refForCatalog.mockImplementation((value) => value);
    await TestBed.configureTestingModule({
      imports: [MeaningsPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: params,
            data,
            snapshot: { queryParamMap: params.value, data: data.value },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: project },
        },
        { provide: ProjectMeaningsService, useValue: service },
      ],
    }).compileComponents();
  });
  async function render() {
    const fixture = TestBed.createComponent(MeaningsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  it('keeps cross-repository field links and source provenance distinct on a cold URL with consistent gutters', async () => {
    const source = {
      repository: 'https://github.com/example/graph',
      revision: 'a'.repeat(40),
      path: 'main.meaning.yaml',
      kind: 'custom' as const,
    };
    const entity = {
      ...catalog.entities[0],
      documentId: 'meaning:parent',
      origin: 'external' as const,
      source,
      fields: [
        {
          ...catalog.entities[0].fields[0],
          documentId: 'meaning:child',
          source: { ...source, repository: 'https://github.com/example/child' },
          description: 'Exact imported field',
        },
      ],
    };
    service.catalog.mockReturnValue(
      of({ ...catalog, discoveryComplete: false, entities: [entity] }),
    );
    data.next({ meaningMode: 'field' });
    params.next(
      convertToParamMap({
        document: entity.documentId,
        concept: entity.conceptId,
        field: 'customer-id',
        fieldDocument: 'meaning:child',
      }),
    );
    const fixture = await render(),
      page = fixture.componentInstance;
    expect(page.field()?.description).toBe('Exact imported field');
    expect(fixture.nativeElement.innerHTML).toContain('Exact imported field');
    expect(
      fixture.nativeElement
        .querySelector('ion-content')
        .classList.contains('ion-padding'),
    ).toBe(true);
    expect(page.href('field', entity, entity.fields[0])).toContain(
      'fieldDocument=meaning%3Achild',
    );
    expect(page.sourceHref()).toBe(
      'https://github.com/example/child/blob/' +
        source.revision +
        '/main.meaning.yaml',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Delete field');
  });
  it('allows managed deletion despite incomplete optional repository discovery', async () => {
    service.catalog.mockReturnValue(
      of({ ...catalog, discoveryComplete: false }),
    );
    data.next({ meaningMode: 'entity' });
    params.next(
      convertToParamMap({ document: 'project', concept: 'customer' }),
    );
    const fixture = await render();
    expect(fixture.componentInstance.canDelete()).toBe(true);
  });
  it('renders entity fields after an asynchronous load with no manual change detection', async () => {
    const response = new Subject<ProjectMeaningsCatalog>();
    service.catalog.mockReturnValue(response);
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('Loading meanings');
    response.next({
      ...catalog,
      entities: [
        {
          ...catalog.entities[0],
          fields: [
            ...catalog.entities[0].fields,
            {
              documentId: 'meaning:external',
              conceptId: 'customer-name',
              name: 'Customer name',
              description:
                'Name from the explicitly linked external definition',
              resources: [],
            },
          ],
        },
      ],
    });
    await fixture.whenStable();
    const item = fixture.nativeElement.querySelector('ion-list > ion-item'),
      entityLink = item.querySelector('h2 > a'),
      columns = item.querySelector('p.identity'),
      fieldLinks = Array.from(
        columns.querySelectorAll('a'),
      ) as HTMLAnchorElement[];
    expect(entityLink.querySelector('strong').textContent).toBe('Customer');
    expect(columns.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Columns: Customer ID, Customer name',
    );
    expect(fieldLinks.map((link) => link.textContent.trim())).toEqual([
      'Customer ID',
      'Customer name',
    ]);
    const entityURL = new URL(
        entityLink.getAttribute('href'),
        'https://datatug.app',
      ),
      fieldURL = new URL(fieldLinks[0].href, 'https://datatug.app'),
      externalFieldURL = new URL(fieldLinks[1].href, 'https://datatug.app');
    expect(entityURL.pathname).toMatch(/\/meanings\/entity$/);
    expect(entityURL.searchParams.get('concept')).toBe('customer');
    expect(fieldURL.pathname).toMatch(/\/meanings\/field$/);
    expect(fieldURL.searchParams.get('field')).toBe('customer-id');
    expect(externalFieldURL.searchParams.get('fieldDocument')).toBe(
      'meaning:external',
    );
    expect(externalFieldURL.searchParams.get('field')).toBe('customer-name');
    expect(item.querySelector('a a')).toBeNull();
    expect(item.hasAttribute('href')).toBe(false);
  });
  it('loads a cold field URL and returns to its entity; folder query links retain their ID', async () => {
    data.next({ meaningMode: 'field' });
    params.next(
      convertToParamMap({
        document: 'project',
        concept: 'customer',
        field: 'customer-id',
      }),
    );
    const fixture = await render(),
      page = fixture.componentInstance;
    expect(fixture.nativeElement.innerHTML).toContain('Buyer identifier');
    expect(page.backHref()).toContain(
      '/meanings/entity?document=project&concept=customer',
    );
    const url = new URL(
      page.resourceHref({
        kind: 'query',
        id: 'sales/customers',
        title: 'Customers',
      }),
      'https://datatug.app',
    );
    expect(url.pathname).toContain('/query/sales%2Fcustomers');
    expect(url.searchParams.get('id')).toBe('sales/customers');
  });
  it.each([
    {
      storeId: 'localhost:8989',
      projectId: 'p1',
      projectApi: 'local' as const,
      branch: 'work',
    },
    {
      storeId: 'github.com',
      projectId: 'repo@owner@datatug',
      projectApi: 'cloud' as const,
      branch: 'work',
    },
  ])(
    'preserves explicit transport and branch in meaning/query/back links for %j',
    async (selected) => {
      project.next({ ref: selected });
      const fixture = await render(),
        page = fixture.componentInstance;
      for (const href of [
        page.href('entity', catalog.entities[0]),
        page.resourceHref({
          kind: 'query',
          id: 'sales/buyers',
          title: 'Buyers',
        }),
        page.resourceHref({ kind: 'board', id: 'sales-board', title: 'Sales' }),
        page.resourceHref({
          kind: 'database',
          id: 'orders',
          environment: 'dev',
          title: 'Orders',
        }),
        page.backHref(),
      ]) {
        const url = new URL(href, 'https://datatug.app');
        expect(url.searchParams.get('projectApi')).toBe(selected.projectApi);
        expect(url.searchParams.get('branch')).toBe('work');
      }
      const links = fixture.debugElement
        .queryAll(By.directive(RouterLink))
        .map((element) => element.injector.get(RouterLink).urlTree);
      expect(links.length).toBeGreaterThan(0);
      expect(
        links.every(
          (tree) =>
            tree?.queryParams['projectApi'] === selected.projectApi &&
            tree?.queryParams['branch'] === 'work',
        ),
      ).toBe(true);
    },
  );
  it('creates once while pending and navigates to returned detail with replacement history', async () => {
    data.next({ meaningMode: 'new-entity' });
    const fixture = await render(),
      page = fixture.componentInstance;
    const response = new Subject<ProjectMeaningsCatalog>();
    service.change.mockReturnValue(response);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    page.form.setValue({
      conceptId: 'customer',
      name: 'Customer',
      description: 'A buyer',
    });
    const saving = page.save();
    await page.save();
    expect(service.change).toHaveBeenCalledOnce();
    expect(page.pending()).toBe(true);
    response.next(catalog);
    response.complete();
    await saving;
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(
        '/meanings/entity?document=project&concept=customer',
      ),
      { replaceUrl: true },
    );
  });
  it('retains form on provider failure and prevents referenced child or incomplete deletion', async () => {
    data.next({ meaningMode: 'new-entity' });
    const fixture = await render(),
      page = fixture.componentInstance;
    page.form.setValue({
      conceptId: 'new-customer',
      name: 'New customer',
      description: 'A buyer',
    });
    service.change.mockReturnValue(
      throwError(() => new Error('stale revision')),
    );
    await page.save();
    expect(page.form.getRawValue().name).toBe('New customer');
    expect(page.error()).toContain('could not be saved');
    data.next({ meaningMode: 'entity' });
    params.next(
      convertToParamMap({ document: 'project', concept: 'customer' }),
    );
    await fixture.whenStable();
    page.catalog.set({
      ...catalog,
      entities: [
        {
          ...catalog.entities[0],
          fields: [
            {
              ...catalog.entities[0].fields[0],
              resources: [{ kind: 'query', id: 'q1', title: 'Referenced' }],
            },
          ],
        },
      ],
    });
    page.confirmDelete.set(true);
    await page.deleteSelected();
    expect(service.change).toHaveBeenCalledTimes(1);
    page.catalog.set({ ...catalog, referencesComplete: false });
    expect(page.canDelete()).toBe(false);
    page.catalog.set({ ...catalog, writable: false });
    expect(page.canDelete()).toBe(false);
  });
  it.each(['project', 'route'])(
    'does not navigate on a late mutation after a %s switch before effects flush',
    async (change) => {
      data.next({ meaningMode: 'new-entity' });
      const fixture = await render(),
        page = fixture.componentInstance;
      const response = new Subject<ProjectMeaningsCatalog>();
      service.change.mockReturnValue(response);
      const navigate = vi
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);
      page.form.setValue({
        conceptId: 'customer',
        name: 'Customer',
        description: 'A buyer',
      });
      const saving = page.save();
      if (change === 'project')
        project.next({ ref: { ...ref, projectId: 'other' } });
      else
        params.next(
          convertToParamMap({ document: 'other', concept: 'customer' }),
        );
      response.next(catalog);
      response.complete();
      await saving;
      expect(navigate).not.toHaveBeenCalled();
    },
  );
  it('cancels a stale catalog read when project changes and shows the current empty state', async () => {
    const old = new Subject<ProjectMeaningsCatalog>();
    service.catalog
      .mockReturnValueOnce(old)
      .mockReturnValue(of({ ...catalog, entities: [] }));
    const fixture = await render();
    project.next({ ref: { ...ref, projectId: 'other' } });
    await fixture.whenStable();
    old.next(catalog);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('No meanings');
    expect(fixture.nativeElement.textContent).not.toContain('Buyer identifier');
  });
});
