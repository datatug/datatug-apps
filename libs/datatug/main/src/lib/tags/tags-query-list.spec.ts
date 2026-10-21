import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
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
  const navigate = vi.fn(() => Promise.resolve(true));
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
                  items: [
                    query('match', ['ops', 'prod']),
                    query('other', ['ops']),
                    query('http', ['ops', 'prod'], QueryType.HTTP),
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
  expect(component.filteredItems?.[0].folders).toEqual(['~', 'nested']);
  component.cd('nested');
  component.cd('..');
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
