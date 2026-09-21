import { Injectable } from '@angular/core';
import {
  executeJoinedDTQLQuery, isJoinedDTQLQuery, key, parseDTQL,
  type DTQLSchema, type ParsedDTQLQuery,
} from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { CHINOOK_SCHEMA } from './chat.types';

interface Fixture {
  readonly version: string;
  readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}
const fixtureVersion = 'chinook-sqlite-6334395117e2478a2712e083be614721341c26c9-all-11-v2';
const tableKeys = {
  Artist: 'ArtistId',
  Album: 'AlbumId',
  Track: 'TrackId',
  Genre: 'GenreId',
  MediaType: 'MediaTypeId',
  Playlist: 'PlaylistId',
  PlaylistTrack: 'PlaylistId:TrackId',
  Customer: 'CustomerId',
  Employee: 'EmployeeId',
  Invoice: 'InvoiceId',
  InvoiceLine: 'InvoiceLineId',
} as const;

@Injectable({ providedIn: 'root' })
export class ChinookChatDataService {
  private database?: IndexedDbDatabase;
  private scope?: string;
  private databaseName?: string;

  async ensureSeed(storeId: string, projectId: string): Promise<void> {
    const scope = `${storeId}:${projectId}`;
    if (this.scope !== scope) {
      await this.database?.close();
      this.scope = scope;
      this.database = undefined;
      this.databaseName = undefined;
    }
    if (projectId !== 'datatug-demo-project') {
      throw new Error('This local Chat trial has Chinook data only for datatug-demo-project.');
    }
    const databaseName = 'chinook';
    if (this.databaseName !== databaseName) {
      await this.database?.close();
      if (scope !== this.scope) return;
      this.database = new IndexedDbDatabase({
        name: databaseName,
        version: 2,
        collections: [
          ...Object.keys(tableKeys).map((table) => ({ name: `main.${table}`, storeName: table })),
          { name: 'main._meta', storeName: '_meta' },
        ],
      });
      this.databaseName = databaseName;
    }
    const database = this.requireDatabase();
    const seeded = await database.get<{ version?: unknown }>(key('main._meta', 'chinook-version'));
    if (seeded.exists && seeded.data.version === fixtureVersion) return;
    const response = await fetch('assets/chinook-full.json');
    if (!response.ok) throw new Error('The local Chinook seed fixture is unavailable.');
    const fixture = await response.json() as Fixture;
    if (fixture.version !== fixtureVersion) throw new Error('The local Chinook seed fixture version is unexpected.');
    for (const table of Object.keys(tableKeys)) {
      if (!Array.isArray(fixture.tables?.[table])) throw new Error(`The local Chinook fixture is missing ${table}.`);
    }
    await database.runReadwriteTransaction(async (transaction) => {
      for (const [table, primaryKey] of Object.entries(tableKeys)) {
        for (const record of fixture.tables[table]) {
          const id = primaryKey === 'PlaylistId:TrackId'
            ? `${record['PlaylistId']}:${record['TrackId']}`
            : Number(record[primaryKey]);
          await transaction.set(key(`main.${table}`, id), record);
        }
      }
      await transaction.set(key('main._meta', 'chinook-version'), { version: fixtureVersion });
    });
  }

  async query(scope: string, dtql: string): Promise<{ rows: readonly Record<string, unknown>[]; query: ParsedDTQLQuery<Record<string, unknown>> }> {
    if (scope !== this.scope) throw new Error('The project changed before this result could be queried.');
    const query = parseDTQL(dtql, CHINOOK_SCHEMA as unknown as DTQLSchema, { maxLimit: 1000 });
    const database = this.requireDatabase();
    const page = isJoinedDTQLQuery(query)
      ? await executeJoinedDTQLQuery(database, query, {
        schema: CHINOOK_SCHEMA,
        resolveSource: (relation) => {
          const schema = relation.schema || 'main';
          if (!CHINOOK_SCHEMA.tables.some((table) => table.schema === schema && table.name === relation.name)) {
            throw new Error(`The JOIN source ${schema}.${relation.name} is unavailable.`);
          }
          return { kind: 'collection', name: `${schema}.${relation.name}` };
        },
      })
      : await database.query(query);
    if (scope !== this.scope) throw new Error('The project changed before this result could be shown.');
    return { rows: page.records.map((record) => record.data as Record<string, unknown>), query };
  }

  private requireDatabase(): IndexedDbDatabase {
    if (!this.database) throw new Error('The local database is not ready.');
    return this.database;
  }
}
