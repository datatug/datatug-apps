import { describe, expect, it } from 'vitest';
import { demoSqliteCatalog, demoSqliteDatasetIds } from '../queries/demo-sqlite-catalog';
import {
  DEMO_POSTGRESQL_BASE_URL,
  DEMO_POSTGRESQL_LABEL,
  demoPostgresqlCatalog,
  demoPostgresqlDatasetIds,
  findDemoPostgresqlEdition,
} from './demo-postgresql-catalog';
import { openDemoPostgresql } from './demo-postgresql-connection';
import {
  fakeCloudFetch,
  postgresDescriptor,
} from './demo-postgresql.spec-helper';
import registryJson from './fixtures/databases.json';
import activationJson from './fixtures/postgresql-api.json';

// Vendored, byte for byte, from github.com/demo-db/websites@25946a8 (config/…). The drift check against the live
// files is `pnpm check:demo-postgresql-catalog --online`.
const registry = registryJson as { databases: { id: string }[] };
const activation = activationJson as {
  format: string;
  publicApiVerified: boolean;
  copies: string;
};

describe('demoPostgresqlCatalog', () => {
  it('lists exactly the datasets DemoDB registers, each served by cloud.openvaultdb.com', () => {
    expect([...demoPostgresqlDatasetIds].sort()).toEqual(
      registry.databases.map((d) => d.id).sort(),
    );
    expect(demoPostgresqlDatasetIds).toEqual(demoSqliteDatasetIds);
    expect(demoPostgresqlDatasetIds.map((id) => demoPostgresqlCatalog[id].title)).toEqual(
      demoSqliteDatasetIds.map((id) => demoSqliteCatalog[id].title),
    );
    for (const id of demoPostgresqlDatasetIds) {
      const entry = demoPostgresqlCatalog[id];
      expect(entry.dataset).toBe(id);
      expect(entry.databaseId).toBe(`${id}-postgresql`);
      expect(entry.baseUrl).toBe('https://cloud.openvaultdb.com');
      expect(entry.descriptorUrl).toBe(
        `https://cloud.openvaultdb.com/v1/databases/${id}-postgresql`,
      );
      expect(entry.route).toBe(`/demo/ovdb/${id}-postgresql`);
      expect(entry.tableCount).toBeGreaterThan(0);
      expect(entry.sampleTable).toBeTruthy();
    }
  });

  it('matches the DemoDB activation switch: public, read-only, through the OpenVaultDB API', () => {
    expect(activation.format).toBe('demodb-postgresql-api/v1');
    expect(activation.publicApiVerified).toBe(true);
    expect(activation.copies).toContain(new URL(DEMO_POSTGRESQL_BASE_URL).host);
    expect(activation.copies).toContain('read-only');
    expect(DEMO_POSTGRESQL_LABEL).toBe(
      'Hosted PostgreSQL (read-only via OpenVaultDB)',
    );
  });

  it('names no credentials and no Neon host', () => {
    const text = JSON.stringify(demoPostgresqlCatalog).toLowerCase();
    expect(text).not.toMatch(/neon|postgres:\/\/|postgresql:\/\/|password|dsn/);
  });

  it('finds an edition by its route segment, case-insensitively', () => {
    expect(findDemoPostgresqlEdition('Chinook-PostgreSQL')).toBe(
      demoPostgresqlCatalog.chinook,
    );
    expect(findDemoPostgresqlEdition('chinook')).toBeUndefined();
    expect(findDemoPostgresqlEdition('')).toBeUndefined();
  });
});

describe('openDemoPostgresql', () => {
  it('reads the descriptor from the public server and returns a connection that offers no mutation', async () => {
    const { fetch, requests } = fakeCloudFetch();
    const connection = await openDemoPostgresql(demoPostgresqlCatalog.chinook, {
      fetch,
    });
    expect(connection).toMatchObject({
      id: 'chinook-postgresql',
      title: 'Chinook · Hosted PostgreSQL (read-only via OpenVaultDB)',
      baseUrl: 'https://cloud.openvaultdb.com',
      databaseId: 'chinook-postgresql',
    });
    expect(connection.descriptor).toEqual(postgresDescriptor);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET https://cloud.openvaultdb.com/v1/databases/chinook-postgresql',
    ]);
  });

  it('waits out a database that is still mounting', async () => {
    const { fetch, requests } = fakeCloudFetch({ statuses: [503, 503] });
    const connection = await openDemoPostgresql(demoPostgresqlCatalog.chinook, {
      fetch,
      delaysMs: [1, 1],
      sleep: async () => undefined,
    });
    expect(connection.descriptor.id).toBe('chinook-postgresql');
    expect(requests).toHaveLength(3);
  });

  it('uses the browser fetch by default', async () => {
    const real = globalThis.fetch;
    const { fetch } = fakeCloudFetch();
    globalThis.fetch = fetch;
    try {
      expect(
        (await openDemoPostgresql(demoPostgresqlCatalog.chinook)).databaseId,
      ).toBe('chinook-postgresql');
    } finally {
      globalThis.fetch = real;
    }
  });

  it('refuses a server that describes another database or another engine', async () => {
    for (const descriptor of [
      { ...postgresDescriptor, id: 'northwind-postgresql' },
      { ...postgresDescriptor, engine: 'sqlite' },
    ]) {
      const { fetch } = fakeCloudFetch({ descriptor });
      await expect(
        openDemoPostgresql(demoPostgresqlCatalog.chinook, { fetch }),
      ).rejects.toThrow(
        'did not describe the PostgreSQL database chinook-postgresql',
      );
    }
  });
});
