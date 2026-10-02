import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetsDirOnDisk, repoRoot } from './testing/repo-root';
import { demoBundle, demoBundleVersion, demoSourceRuntime, HERO_QUERY_ID, queryDefinition, savedQuery } from './demo-project';

const toolPin = JSON.parse(readFileSync(`${repoRoot()}/tools/demo-bundle/pin.json`, 'utf8')) as { demoProjects: { commit: string; project: string } };

describe('demo project bundle', () => {
  it('is built from the pinned commit', () => {
    expect(demoBundle.pin.commit).toBe(toolPin.demoProjects.commit);
    expect(demoBundle.pin.project).toBe(toolPin.demoProjects.project);
  });

  it('loads the saved hero query with its three sources and the declared result columns', () => {
    const query = savedQuery(HERO_QUERY_ID);
    expect(query.id).toBe('chinook-sales-per-capita');
    expect(query.federation.tables.map((table) => `${table.database}.${table.name}`)).toEqual(['chinook.Invoice', 'geo.country_aliases', 'geo.population_wb']);
    expect(query.recordsets[0].columns.map((column) => column.name)).toEqual(['country', 'totalSales', 'population', 'populationYear', 'salesPerMillion']);
    expect(query.dtql).toContain('groupBy');
    expect(() => savedQuery('nope')).toThrow('no saved query nope');
  });

  it('carries the project\'s Chinook schema and the Country mapping for Invoice.BillingCountry', () => {
    expect(Object.keys(demoBundle.schema.chinook)).toHaveLength(11);
    expect(demoBundle.schema.chinook['Invoice']).toEqual(expect.arrayContaining(['InvoiceId', 'BillingCountry', 'Total']));
    expect(demoBundle.entities.Country.fields.find((field) => field.id === 'Name')?.mappings).toContainEqual({ source: 'chinook', collection: 'Invoice', column: 'BillingCountry' });
  });

  it('keeps the attribution the data licences require', () => {
    const byId = Object.fromEntries(demoBundle.attribution.map((entry) => [entry.id, entry]));
    expect(byId['world-bank'].license).toBe('CC BY 4.0');
    expect(byId['world-bank'].text).toContain('The World Bank does not endorse');
    expect(byId['chinook'].license).toBe('MIT');
    expect(byId['geonames'].license).toBe('CC BY 4.0');
  });

  it('lists data files whose hashes match the files published with the app', () => {
    for (const source of demoBundle.data) {
      const text = readFileSync(`${assetsDirOnDisk()}/${source.file}`, 'utf8');
      expect(createHash('sha256').update(text).digest('hex')).toBe(source.sha256);
    }
    expect(demoBundle.data.map((source) => [source.id, source.rows])).toEqual([['chinook.Invoice', 412], ['geo.country_aliases', 24], ['geo.population_wb', 216]]);
  });

  it('points the query at the configured data source', () => {
    const ovdb = demoSourceRuntime({ kind: 'ovdb', baseUrl: 'http://127.0.0.1:50501' }, 'https://datatug.app');
    expect(queryDefinition(HERO_QUERY_ID, ovdb).federation?.ovdbBaseUrl).toBe('http://127.0.0.1:50501');
    expect(ovdb.staticSource).toBeUndefined();
    const hosted = demoSourceRuntime({ kind: 'static' }, 'https://datatug.app');
    expect(hosted.baseUrl).toBe('https://datatug.app/assets/demo-data/ovdb');
    expect(hosted.staticSource).toEqual({ baseUrl: hosted.baseUrl, version: demoBundleVersion() });
    expect(queryDefinition(HERO_QUERY_ID, hosted).federation?.ovdbBaseUrl).toBe(hosted.baseUrl);
  });
});
