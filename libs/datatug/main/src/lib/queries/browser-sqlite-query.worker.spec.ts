import initSqlJs from 'sql.js';
import { countSqlitePlaceholders } from './sql-bindings';
import { executeBrowserSqlite } from './browser-sqlite-query.worker';

describe('browser SQLite worker input boundary', () => {
  it('counts placeholders only in executable SQL text', () => {
    expect(countSqlitePlaceholders("select '?' as value, :declared -- ?\n /* @ignored */ where id = ?")).toBe(2);
  });

  it('rejects declared or undeclared placeholders when their value count differs', async () => {
    await expect(executeBrowserSqlite({
      sql: 'select :undeclared', fixture: new Uint8Array([1]), bindings: [],
    })).rejects.toThrow(/placeholder count/u);
    await expect(executeBrowserSqlite({
      sql: 'select ?', fixture: new Uint8Array([1]), bindings: [],
    })).rejects.toThrow(/placeholder count/u);
  });

  it('executes the same bounded engine against two unrelated SQLite schemas', async () => {
    const SQL = await initSqlJs();
    const first = new SQL.Database();
    first.run('CREATE TABLE NorthwindOrders (OrderId INTEGER, CustomerCode TEXT)');
    first.run("INSERT INTO NorthwindOrders VALUES (42, 'ALFKI')");
    const firstFixture = first.export();
    first.close();

    const second = new SQL.Database();
    second.run('CREATE TABLE RegistryItems (ItemKey TEXT, Enabled INTEGER)');
    second.run("INSERT INTO RegistryItems VALUES ('asset-A', 1)");
    const secondFixture = second.export();
    second.close();

    await expect(executeBrowserSqlite({
      sql: 'SELECT CustomerCode FROM NorthwindOrders WHERE OrderId = ?',
      fixture: firstFixture,
      bindings: [42],
    }, async () => SQL)).resolves.toEqual({ columns: ['CustomerCode'], rows: [['ALFKI']] });
    await expect(executeBrowserSqlite({
      sql: 'SELECT ItemKey FROM RegistryItems WHERE Enabled = ?',
      fixture: secondFixture,
      bindings: [1],
    }, async () => SQL)).resolves.toEqual({ columns: ['ItemKey'], rows: [['asset-A']] });
    await expect(executeBrowserSqlite({
      sql: '-- reviewed read\n/* edition */ SELECT ItemKey FROM RegistryItems',
      fixture: secondFixture,
      bindings: [],
    }, async () => SQL)).resolves.toEqual({ columns: ['ItemKey'], rows: [['asset-A']] });
  });

  it('returns exact SQLite int64 values while retaining REAL numbers', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE Figures (MaxId INTEGER, Ratio REAL)');
    db.run('INSERT INTO Figures VALUES (9223372036854775807, 1.25)');
    const fixture = db.export();
    db.close();
    await expect(executeBrowserSqlite({
      sql: 'SELECT MaxId, Ratio FROM Figures', fixture, bindings: [],
    }, async () => SQL)).resolves.toEqual({
      columns: ['MaxId', 'Ratio'], rows: [[9223372036854775807n, 1.25]],
    });
  });

  it('enforces read-only, statement, row, column, scalar and result-byte limits', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE Lots (id INTEGER)');
    db.run('WITH RECURSIVE nums(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM nums WHERE x<1001) INSERT INTO Lots SELECT x FROM nums');
    const fixture = db.export();
    db.close();
    const run = (sql: string) => executeBrowserSqlite({ sql, fixture, bindings: [] }, async () => SQL);
    await expect(run('DELETE FROM Lots')).rejects.toThrow(/read-only SELECT/u);
    await expect(run('SELECT 1; SELECT 2')).rejects.toThrow(/one read-only SELECT statement/u);
    await expect(run('SELECT id FROM Lots')).rejects.toThrow(/1,000-row/u);
    await expect(run(`SELECT ${Array.from({ length: 41 }, (_, index) => `1 AS c${index}`).join(', ')}`))
      .rejects.toThrow(/1 to 40 columns/u);
    await expect(run("SELECT x'00' AS blob")).rejects.toThrow(/Blob or non-finite/u);
    await expect(run('SELECT hex(zeroblob(524289)) AS big')).rejects.toThrow(/1 MiB browser result/u);
  });
});
