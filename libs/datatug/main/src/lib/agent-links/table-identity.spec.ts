import { convertToParamMap, ActivatedRouteSnapshot } from '@angular/router';
import { getStoreUrl } from '@sneat/api';
import { buildAgentUrl } from '../services/repo/agent-url';
import {
  isAgentStoreId,
  parseDatatugStoreRef,
  storeIdToDisplayLabel,
} from '../nav/nav-models';
import { linkTableRef } from './link-route';
import { qualifiedTableName, tableIdentity } from './table-identity';

describe('tableIdentity (REQ:table-identity)', () => {
  it('takes the schema query as authoritative and the segment as the whole name', () => {
    expect(tableIdentity('Album', '')).toEqual({ schema: '', name: 'Album' });
    expect(tableIdentity('a.b', '')).toEqual({ schema: '', name: 'a.b' });
    expect(tableIdentity('orders', 'public')).toEqual({ schema: 'public', name: 'orders' });
    expect(tableIdentity('x.y', 'sales')).toEqual({ schema: 'sales', name: 'x.y' });
  });

  it('keeps the dotted reading only when there is no schema parameter', () => {
    expect(tableIdentity('main.Album', null)).toEqual({ schema: 'main', name: 'Album' });
    expect(tableIdentity('main.a.b', undefined)).toEqual({ schema: 'main', name: 'a.b' });
    // A bare name used to become schema "Album" with no name.
    expect(tableIdentity('Album', null)).toEqual({ schema: '', name: 'Album' });
  });

  it('names the table for exec/select', () => {
    expect(qualifiedTableName({ schema: '', name: 'a.b' })).toBe('a.b');
    expect(qualifiedTableName({ schema: 'dbo', name: 'T' })).toBe('T');
    expect(qualifiedTableName({ schema: 'main', name: 'Album' })).toBe('main.Album');
  });
});

describe('http-127.0.0.1:<port> as an agent store id', () => {
  const storeId = 'http-127.0.0.1:8989';
  it('is an agent at http://127.0.0.1:<port>', () => {
    expect(isAgentStoreId(storeId)).toBe(true);
    expect(parseDatatugStoreRef(storeId)).toEqual({ type: 'agent', url: 'http://127.0.0.1:8989' });
    expect(storeIdToDisplayLabel(storeId)).toBe('http://127.0.0.1:8989');
    expect(getStoreUrl(storeId)).toBe('http://127.0.0.1:8989');
    expect(buildAgentUrl(storeId, '/records/schema')).toBe(
      'http://127.0.0.1:8989/datatug/records/schema',
    );
  });
});

describe('linkTableRef', () => {
  function snapshot(
    chain: Record<string, string>[],
    query: Record<string, string>,
  ): ActivatedRouteSnapshot {
    const pathFromRoot = chain.map(
      (params) => ({ paramMap: convertToParamMap(params) }) as ActivatedRouteSnapshot,
    );
    return {
      pathFromRoot,
      paramMap: pathFromRoot[pathFromRoot.length - 1].paramMap,
      queryParamMap: convertToParamMap(query),
    } as ActivatedRouteSnapshot;
  }

  it('reads the ids from every level of the route and the schema from the query', () => {
    expect(
      linkTableRef(
        snapshot(
          [
            { storeId: 'http-127.0.0.1:8989' },
            { projectId: 'demo' },
            { environmentId: 'local' },
            { dbCatalogId: 'chinook' },
            { tableType: 'Album' },
          ],
          { schema: '' },
        ),
      ),
    ).toEqual({
      storeId: 'http-127.0.0.1:8989',
      project: 'demo',
      env: 'local',
      source: 'chinook',
      table: { schema: '', name: 'Album' },
    });
  });

  it('is undefined when a part is missing', () => {
    expect(linkTableRef(snapshot([{ storeId: 's' }, { tableType: 'Album' }], {}))).toBeUndefined();
  });
});
