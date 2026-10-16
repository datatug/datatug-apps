import { describe, expect, it } from 'vitest';
import {
  DEMODB_OVDB_BASE_URL,
  LEGACY_DEMODB_OVDB_BASE_URL,
  currentDemoDbOvdbUrl,
  demoDbOvdbDatabaseUrl,
  isDemoDbOvdbDatabaseUrl,
} from './demodb-ovdb';

describe('DemoDB OVDB host', () => {
  it('serves the API from its own host', () => {
    expect(DEMODB_OVDB_BASE_URL).toBe('https://ovdb.demodb.dev');
    expect(demoDbOvdbDatabaseUrl('chinook')).toBe('https://ovdb.demodb.dev/v1/databases/chinook');
  });

  it('moves URLs under the legacy base to the same path on the current host, and nothing else', () => {
    expect(currentDemoDbOvdbUrl(LEGACY_DEMODB_OVDB_BASE_URL)).toBe(DEMODB_OVDB_BASE_URL);
    expect(currentDemoDbOvdbUrl('https://demodb.dev/ovdb/v1/databases/northwind/dtql'))
      .toBe('https://ovdb.demodb.dev/v1/databases/northwind/dtql');
    expect(currentDemoDbOvdbUrl('https://ovdb.demodb.dev/v1/databases/pubs')).toBe('https://ovdb.demodb.dev/v1/databases/pubs');
    // Look-alikes are not the legacy base.
    expect(currentDemoDbOvdbUrl('https://demodb.dev/ovdbx')).toBe('https://demodb.dev/ovdbx');
    expect(currentDemoDbOvdbUrl('https://demodb.dev.evil.example/ovdb')).toBe('https://demodb.dev.evil.example/ovdb');
    expect(currentDemoDbOvdbUrl('https://cloud.openvaultdb.com')).toBe('https://cloud.openvaultdb.com');
  });

  it('recognises a published dataset source on either base', () => {
    expect(isDemoDbOvdbDatabaseUrl('https://ovdb.demodb.dev/v1/databases/chinook', 'chinook')).toBe(true);
    expect(isDemoDbOvdbDatabaseUrl('https://demodb.dev/ovdb/v1/databases/chinook', 'chinook')).toBe(true);
    expect(isDemoDbOvdbDatabaseUrl('https://ovdb.demodb.dev/v1/databases/pubs', 'chinook')).toBe(false);
    expect(isDemoDbOvdbDatabaseUrl(undefined, 'chinook')).toBe(false);
  });
});
