#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [sqlitePath, outputPath] = process.argv.slice(2);
if (!sqlitePath || !outputPath) {
  throw new Error('Usage: generate-chinook-chat-schema.mjs <Chinook_Sqlite.sqlite> <output.json>');
}

const expectedSha256 = 'f82efedb6c5c40734609e168bc5be5616a2eca6b90ed0048451a8674625e03a3';
const actualSha256 = createHash('sha256').update(readFileSync(sqlitePath)).digest('hex');
if (actualSha256 !== expectedSha256) throw new Error(`Unexpected Chinook SQLite SHA-256: ${actualSha256}`);

const sqliteJson = (sql) => JSON.parse(execFileSync('sqlite3', ['-json', sqlitePath, sql], { encoding: 'utf8' }) || '[]');
const tables = sqliteJson("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .map((row) => row.name);
const foreignKeys = [];
for (const table of tables) {
  const groups = new Map();
  for (const row of sqliteJson(`PRAGMA foreign_key_list("${table.replaceAll('"', '""')}")`)) {
    const group = groups.get(row.id) || [];
    group.push(row);
    groups.set(row.id, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.seq - b.seq);
    const target = group[0].table;
    if (!tables.includes(target) || group.some((row) => row.table !== target || !row.from || !row.to)) {
      throw new Error(`Invalid foreign key in ${table}`);
    }
    const sourceFields = group.map((row) => row.from);
    const targetFields = group.map((row) => row.to);
    foreignKeys.push({
      id: `main.${table}(${sourceFields.join(',')})>main.${target}(${targetFields.join(',')})`,
      source: { schema: 'main', table, fields: sourceFields },
      target: { schema: 'main', table: target, fields: targetFields },
    });
  }
}
foreignKeys.sort((a, b) => a.id.localeCompare(b.id));
if (tables.length !== 11 || foreignKeys.length !== 11 || new Set(foreignKeys.map((fk) => fk.id)).size !== foreignKeys.length) {
  throw new Error(`Unexpected Chinook schema: ${tables.length} tables, ${foreignKeys.length} foreign keys`);
}
const version = `sha256:${createHash('sha256').update(JSON.stringify(foreignKeys)).digest('hex')}`;
const manifest = {
  version,
  source: {
    repository: 'https://github.com/datatug/chinook-database',
    revision: '6334395117e2478a2712e083be614721341c26c9',
    sha256: actualSha256,
  },
  foreignKeys,
};
mkdirSync(dirname(resolve(outputPath)), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
