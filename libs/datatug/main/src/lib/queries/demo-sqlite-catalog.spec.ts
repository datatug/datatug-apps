import { describe, expect, it } from 'vitest';
import {
  demoSqliteCatalog,
  demoSqliteDatasetIds,
  demoSqliteStorageBytes,
  findDemoSqliteDataset,
  formatMegabytes,
  isLargeDemoSqliteDataset,
} from './demo-sqlite-catalog';

describe('demoSqliteCatalog', () => {
  it('pins every DemoDB dataset to its plain decoded file URL', () => {
    expect(Object.keys(demoSqliteCatalog).sort()).toEqual([...demoSqliteDatasetIds].sort());
    for (const id of demoSqliteDatasetIds) {
      const entry = demoSqliteCatalog[id];
      expect(entry.dataset).toBe(id);
      expect(entry.url).toBe(`https://${id}.demodb.dev/data/${id}.sqlite`);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isSafeInteger(entry.bytes) && entry.bytes > 0).toBe(true);
      // SQLite files are whole pages.
      expect(entry.bytes % 512).toBe(0);
      expect(entry.transferBytes > 0 && entry.transferBytes <= entry.bytes).toBe(true);
      expect(entry.storagePolicy).toBe('working-and-pristine');
      expect(entry.title.length).toBeGreaterThan(0);
      expect(Object.keys(entry).sort()).toEqual(
        ['bytes', 'dataset', 'sha256', 'storagePolicy', 'title', 'transferBytes', 'url'],
      );
    }
    expect(new Set(demoSqliteDatasetIds.map((id) => demoSqliteCatalog[id].sha256)).size)
      .toBe(demoSqliteDatasetIds.length);
  });

  it('keeps the pins verified against the live files on 2026-10-14', () => {
    expect(demoSqliteCatalog.sakila).toMatchObject({
      sha256: '9bebeee50fecb1fee115c206a4f380f2f6d1f009e7796b18b8a8cfba7c810454',
      bytes: 4915200,
    });
    expect(demoSqliteCatalog.adventureworks).toMatchObject({
      sha256: '6a105e1982becfe003fc7a307d7cad9d738390cedd79d166c2167fd817168109',
      bytes: 126820352,
      transferBytes: 35367459,
    });
  });

  it('finds datasets case-insensitively and nothing else', () => {
    expect(findDemoSqliteDataset('Chinook')?.dataset).toBe('chinook');
    expect(findDemoSqliteDataset(' SAKILA ')?.dataset).toBe('sakila');
    expect(findDemoSqliteDataset('constructor')).toBeUndefined();
    expect(findDemoSqliteDataset('__proto__')).toBeUndefined();
    expect(findDemoSqliteDataset('')).toBeUndefined();
    expect(findDemoSqliteDataset(undefined)).toBeUndefined();
  });

  it('marks only AdventureWorks as large and sizes storage by policy', () => {
    expect(demoSqliteDatasetIds.filter((id) => isLargeDemoSqliteDataset(demoSqliteCatalog[id])))
      .toEqual(['adventureworks']);
    expect(demoSqliteStorageBytes(demoSqliteCatalog.adventureworks)).toBe(253640704);
    expect(demoSqliteStorageBytes({ ...demoSqliteCatalog.adventureworks, storagePolicy: 'single-copy' }))
      .toBe(126820352);
    expect(formatMegabytes(253640704)).toBe('253.6 MB');
  });
});
