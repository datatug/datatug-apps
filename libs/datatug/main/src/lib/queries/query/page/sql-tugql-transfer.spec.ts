import { describe, expect, it } from 'vitest';
import { parseTugQL } from '@dalgo/core';
import { type IQueryDef, QueryType } from '../../../models/definition/query-def';
import { transferSqlToTugql } from './sql-tugql-transfer';

const sql = (text: string, parameters?: IQueryDef['parameters']): IQueryDef => ({
  id: 'transfer-fixture', title: 'Transfer fixture', type: QueryType.SQL,
  connectionId: 'chinook-sqlite', request: { queryType: QueryType.SQL, text },
  ...(parameters ? { parameters } : {}),
} as IQueryDef);

describe('read-only SQL to TugQL view', () => {
  it('transfers a complete single-source SQLite query without changing its SQL definition', () => {
    const definition = sql('SELECT i.InvoiceId AS id, i.CustomerId FROM main.Invoice AS i WHERE i.CustomerId = @CustomerId ORDER BY i.InvoiceId LIMIT 100;', [
      { id: 'CustomerId', type: 'integer', isRequired: true },
    ]);
    const original = structuredClone(definition);
    const result = transferSqlToTugql(definition);
    expect(result.supported).toBe(true);
    if (result.supported) {
      expect(result.source).toContain('FROM main.Invoice AS i');
      expect(result.source).toContain('@CustomerId INTEGER REQUIRED');
      expect(result.source).toContain('SELECT (\n  i.InvoiceId AS id\n  i.CustomerId\n)');
      expect(parseTugQL(result.source).diagnostics).toEqual([]);
    }
    expect(definition).toEqual(original);
  });

  it('preserves an unqualified source exactly in its read-only representation', () => {
    const definition = sql('SELECT AlbumId, Title FROM Album ORDER BY AlbumId LIMIT 10');
    const result = transferSqlToTugql(definition);
    expect(result).toMatchObject({ supported: true, sourceCount: 1 });
    if (result.supported) {
      expect(result.source).toContain('FROM Album\n');
      expect(result.source).not.toContain('FROM main.Album');
      expect(result.source).toContain('SELECT (\n  AlbumId\n  Title\n)');
    }
  });

  it.each([
    ['SELECT DISTINCT AlbumId FROM main.Album', /DISTINCT/u],
    ['SELECT IFNULL(Title, \'\') FROM main.Album', /functions|Quoted/u],
    ['SELECT (SELECT COUNT(1) FROM Album) FROM main.Artist', /scalar subqueries/u],
    ['SELECT AlbumId FROM main.Album JOIN Artist ON Album.ArtistId = Artist.ArtistId', /JOIN/u],
    ['SELECT AlbumId FROM main.Album; DELETE FROM Album', /Multiple SQL statements/u],
    ['SELECT AlbumId FROM main.Album WHERE ArtistId = @ArtistId', /declared integer/u],
    ['SELECT other.AlbumId FROM main.Album', /outside the declared/u],
    ['SELECT AlbumId FROM main.Album -- comment', /comments/u],
    ['SELECT AlbumId FROM main.Album LIMIT', /LIMIT needs/u],
  ])('refuses an incomplete or semantically unverified SQL transfer: %s', (source, reason) => {
    expect(transferSqlToTugql(sql(source))).toMatchObject({ supported: false, reason: expect.stringMatching(reason) });
  });
});
