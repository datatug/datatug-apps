import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  Params,
  NavigationExtras,
} from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject, of } from 'rxjs';
import { QueriesTabComponent } from '../queries/queries/queries-tab.component';
import { QueriesService } from '../queries/queries.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { QueryType } from '../models/definition/query-def';
it('combines type/text/all tag selections across nested folders and preserves URL context', async () => {
  const params = new BehaviorSubject(
    convertToParamMap({
      tag: ['ops', 'prod'],
      tab: 'shared',
      environment: 'dev',
    }),
  );
  const query = (id: string, tags: string[], type = QueryType.SQL) => ({
    id,
    title: id,
    tags,
    request: { queryType: type, text: '' },
  });
  const navigate = vi.fn((_commands: unknown[], options: NavigationExtras) => {
    const previous = params.value;
    const merged: Params = Object.fromEntries(
      previous.keys.map((key) => [key, previous.getAll(key)]),
    );
    Object.assign(merged, options.queryParams);
    params.next(convertToParamMap(merged));
    return Promise.resolve(true);
  });
  TestBed.configureTestingModule({
    imports: [QueriesTabComponent],
    providers: [
      { provide: ActivatedRoute, useValue: { queryParamMap: params } },
      { provide: Router, useValue: { navigate } },
      {
        provide: ErrorLogger,
        useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) },
      },
      {
        provide: QueriesService,
        useValue: {
          getQueriesFolder: () =>
            of({
              id: '~',
              folders: [
                {
                  id: 'nested',
                  folders: [
                    {
                      id: 'deep',
                      items: [
                        query('match', ['ops', 'prod']),
                        query('other', ['ops']),
                        query('http', ['ops', 'prod'], QueryType.HTTP),
                      ],
                    },
                  ],
                },
              ],
            }),
        },
      },
      {
        provide: DatatugNavContextService,
        useValue: {
          currentProject: of({ ref: { storeId: 'local', projectId: 'demo' } }),
        },
      },
      { provide: DatatugNavService, useValue: { goQuery: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(QueriesTabComponent, {
    set: { template: '', imports: [] },
  });
  const fixture = TestBed.createComponent(QueriesTabComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  const component = fixture.componentInstance;
  component.setQueryType('SQL');
  component.filter = 'match';
  component.applyFilter();
  expect(component.filteredItems?.map((item) => item.query.id)).toEqual([
    'match',
  ]);
  expect(component.filteredItems?.[0].folders).toEqual(['~', 'nested', 'deep']);
  component.cd('nested');
  component.cd('deep');
  expect(params.value.get('folder')).toBe('nested/deep');
  expect(component.currentFolder.path).toBe('~/nested/deep');
  expect(component.currentFolder.items?.map((item) => item.id)).toContain(
    'match',
  );
  expect(component.filteredItems?.map((item) => item.query.id)).toEqual([
    'match',
  ]);
  params.next(
    convertToParamMap({
      folder: 'nested',
      tag: ['ops', 'prod'],
      tab: 'shared',
      environment: 'dev',
    }),
  );
  await fixture.whenStable();
  expect(component.currentFolder.path).toBe('~/nested');
  expect(component.currentFolder.folders?.[0].id).toBe('deep');
  expect(component.filteredItems?.map((item) => item.query.id)).toEqual([
    'match',
  ]);
  component.cd('..');
  expect(params.value.getAll('tag')).toEqual(['ops', 'prod']);
  expect(params.value.get('tab')).toBe('shared');
  expect(params.value.get('environment')).toBe('dev');
  expect(navigate).toHaveBeenLastCalledWith(
    [],
    expect.objectContaining({ queryParamsHandling: 'merge' }),
  );
  component.clearFilter();
  expect(navigate).toHaveBeenLastCalledWith(
    [],
    expect.objectContaining({
      queryParams: { tag: null },
      queryParamsHandling: 'merge',
    }),
  );
});
