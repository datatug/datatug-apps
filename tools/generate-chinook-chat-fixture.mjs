#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [sqlitePath, outputPath] = process.argv.slice(2);
if (!sqlitePath || !outputPath) {
  throw new Error('Usage: generate-chinook-chat-fixture.mjs <Chinook_Sqlite.sqlite> <output.json>');
}

const sqliteJson = (sql) =>
  JSON.parse(execFileSync('sqlite3', ['-json', sqlitePath, sql], { encoding: 'utf8' }));

const expectedSha256 = 'f82efedb6c5c40734609e168bc5be5616a2eca6b90ed0048451a8674625e03a3';
const actualSha256 = createHash('sha256').update(readFileSync(sqlitePath)).digest('hex');
if (actualSha256 !== expectedSha256) {
  throw new Error(`Unexpected Chinook SQLite SHA-256: ${actualSha256}`);
}

const fixture = {
  version: 'chinook-sqlite-6334395117e2478a2712e083be614721341c26c9',
  source: {
    repository: 'https://github.com/datatug/chinook-database',
    revision: '6334395117e2478a2712e083be614721341c26c9',
    sha256: actualSha256,
    license: 'MIT',
  },
  customers: sqliteJson('SELECT * FROM Customer ORDER BY CustomerId'),
  invoices: sqliteJson('SELECT * FROM Invoice ORDER BY InvoiceId'),
  tracks: sqliteJson(`SELECT Track.*, Artist.Name AS ArtistName
    FROM Track
    LEFT JOIN Album ON Album.AlbumId = Track.AlbumId
    LEFT JOIN Artist ON Artist.ArtistId = Album.ArtistId
    ORDER BY Track.TrackId`),
};

mkdirSync(dirname(resolve(outputPath)), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixture)}\n`);
