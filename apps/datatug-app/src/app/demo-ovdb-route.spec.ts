import { UrlSegment, UrlSegmentGroup } from '@angular/router';
import { checkoutOrRoot, demoOvdbMatcher, routes } from './datatug-app-routes';
import { handoffUrlMatcher } from './demo-handoff-path';

const segments = (path: string) =>
  path
    .split('/')
    .filter(Boolean)
    .map((part) => new UrlSegment(part, {}));
const group = () => new UrlSegmentGroup([], {});
const params = (path: string) => {
  const match = demoOvdbMatcher(segments(path), group());
  return match
    ? Object.fromEntries(
        Object.entries(match.posParams ?? {}).map(([key, value]) => [
          key,
          value.path,
        ]),
      )
    : null;
};

describe('demoOvdbMatcher', () => {
  it('matches the database list, a database and a table, case-insensitively', () => {
    expect(params('demo/ovdb')).toEqual({});
    expect(params('demo/ovdb/chinook-postgresql')).toEqual({
      database: 'chinook-postgresql',
    });
    expect(params('Demo/OVDB/Chinook-PostgreSQL')).toEqual({
      database: 'Chinook-PostgreSQL',
    });
    expect(params('demo/ovdb/chinook-postgresql/table/Album')).toEqual({
      database: 'chinook-postgresql',
      table: 'Album',
    });
    expect(params('demo/ovdb/chinook-postgresql/TABLE/Album')).toEqual({
      database: 'chinook-postgresql',
      table: 'Album',
    });
    // Unknown ids still reach the page, which explains and lists the databases.
    expect(params('demo/ovdb/nope')).toEqual({ database: 'nope' });
  });

  it('leaves every other address alone', () => {
    expect(params('demo')).toBeNull();
    expect(params('demo/sqlite/chinook')).toBeNull();
    expect(params('demo/ovdb/chinook-postgresql/view/Album')).toBeNull();
    expect(params('demo/ovdb/chinook-postgresql/table')).toBeNull();
    expect(params('demo/ovdb/chinook-postgresql/table/Album/extra')).toBeNull();
  });

  it('is not a demo hand-off address', () => {
    expect(
      handoffUrlMatcher(segments('demo/ovdb/chinook-postgresql'), group()),
    ).toBeNull();
  });

  it('is registered for the DataTug profile only, lazily, before the hand-off and feature routes', () => {
    const index = routes.findIndex(
      (route) => route.matcher === demoOvdbMatcher,
    );
    const handoff = routes.findIndex(
      (route) => route.matcher === handoffUrlMatcher,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(handoff);
    expect(routes[index].canMatch).toEqual([checkoutOrRoot]);
    expect(routes[index].loadComponent).toBeTypeOf('function');
  });
});
