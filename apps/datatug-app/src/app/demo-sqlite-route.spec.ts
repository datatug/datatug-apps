import { UrlSegment, UrlSegmentGroup } from '@angular/router';
import { checkoutOrRoot, demoSqliteMatcher, routes } from './datatug-app-routes';
import { handoffUrlMatcher } from './demo-handoff-path';

const segments = (path: string) => path.split('/').filter(Boolean).map((part) => new UrlSegment(part, {}));
const group = () => new UrlSegmentGroup([], {});
const params = (path: string) => {
  const match = demoSqliteMatcher(segments(path), group());
  return match ? Object.fromEntries(Object.entries(match.posParams ?? {}).map(([key, value]) => [key, value.path])) : null;
};

describe('demoSqliteMatcher', () => {
  it('matches the dataset list, a dataset and a table, case-insensitively', () => {
    expect(params('demo/sqlite')).toEqual({});
    expect(params('demo/sqlite/chinook')).toEqual({ dataset: 'chinook' });
    expect(params('Demo/SQLite/Chinook')).toEqual({ dataset: 'Chinook' });
    expect(params('demo/sqlite/chinook/table/Album')).toEqual({ dataset: 'chinook', table: 'Album' });
    expect(params('demo/sqlite/chinook/TABLE/Album')).toEqual({ dataset: 'chinook', table: 'Album' });
    // Unknown ids still reach the page, which explains and lists the datasets.
    expect(params('demo/sqlite/nope')).toEqual({ dataset: 'nope' });
  });

  it('leaves every other address alone', () => {
    expect(params('demo')).toBeNull();
    expect(params('demo/postgres/chinook')).toBeNull();
    expect(params('demo/sqlite/chinook/view/Album')).toBeNull();
    expect(params('demo/sqlite/chinook/table')).toBeNull();
    expect(params('demo/sqlite/chinook/table/Album/extra')).toBeNull();
  });

  it('is not a demo hand-off address', () => {
    expect(handoffUrlMatcher(segments('demo/sqlite/chinook'), group())).toBeNull();
  });

  it('is registered for the DataTug profile only, lazily, before the hand-off and feature routes', () => {
    const index = routes.findIndex((route) => route.matcher === demoSqliteMatcher);
    const handoff = routes.findIndex((route) => route.matcher === handoffUrlMatcher);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(handoff);
    expect(routes[index].canMatch).toEqual([checkoutOrRoot]);
    expect(routes[index].loadComponent).toBeTypeOf('function');
  });
});
