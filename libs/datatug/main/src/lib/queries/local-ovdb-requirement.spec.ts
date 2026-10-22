import { describe, expect, it } from 'vitest';
import { localOvdbRequirement } from './local-ovdb-requirement';

const salesLookup = {
  federation: {
    ovdbBaseUrl: 'http://127.0.0.1:50501',
    tables: [
      { name: 'Invoice', database: 'orders', fields: ['id'] },
      { name: 'Country', database: 'countries', fields: ['id'] },
    ],
  },
};

describe('localOvdbRequirement', () => {
  it('names the local server, its databases and a starting command when a loopback run cannot connect', () => {
    expect(localOvdbRequirement(salesLookup, 'Failed to fetch', 'https://datatug.app')).toEqual({
      baseUrl: 'http://127.0.0.1:50501',
      databases: ['orders', 'countries'],
      command: 'ovdb serve --addr 127.0.0.1:50501 \\\n  --manifest <orders.ovdb.yaml> \\\n  --manifest <countries.ovdb.yaml> \\\n  --cors https://datatug.app',
    });
    expect(localOvdbRequirement(salesLookup, 'NetworkError when attempting to fetch resource.', 'https://datatug.app')).toBeDefined();
  });

  it('stays out of the way for hosted bases and for failures that are not connection failures', () => {
    expect(localOvdbRequirement({ federation: { ...salesLookup.federation, ovdbBaseUrl: 'https://ovdb.demodb.dev' } }, 'Failed to fetch', 'https://datatug.app')).toBeUndefined();
    expect(localOvdbRequirement(salesLookup, 'OVDB returned invalid database capabilities.', 'https://datatug.app')).toBeUndefined();
    expect(localOvdbRequirement({}, 'Failed to fetch', 'https://datatug.app')).toBeUndefined();
    expect(localOvdbRequirement(salesLookup, undefined, 'https://datatug.app')).toBeUndefined();
  });
});
