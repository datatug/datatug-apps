import { Injectable } from '@angular/core';
import { key, parseDTQL, type DTQLSchema } from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { CHINOOK_SCHEMA } from './chat.types';

interface Fixture {
  readonly version: string;
  readonly customers: readonly Record<string, unknown>[];
  readonly invoices: readonly Record<string, unknown>[];
  readonly tracks: readonly Record<string, unknown>[];
}
const fixtureVersion = 'chinook-sqlite-6334395117e2478a2712e083be614721341c26c9';

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
    const databaseName = `datatug-chat:${encodeURIComponent(scope)}:${encodeURIComponent(fixtureVersion)}`;
    if (this.databaseName !== databaseName) {
      await this.database?.close();
      if (scope !== this.scope) return;
      this.database = new IndexedDbDatabase({ name: databaseName });
      this.databaseName = databaseName;
    }
    const database = this.requireDatabase();
    const seeded = await database.get<{ version?: unknown }>(key('_chatMeta', 'chinook-version'));
    if (seeded.exists && seeded.data.version === fixtureVersion) return;
    const response = await fetch('assets/chinook-phase1.json');
    if (!response.ok) throw new Error('The local Chinook seed fixture is unavailable.');
    const fixture = await response.json() as Fixture;
    if (fixture.version !== fixtureVersion) throw new Error('The local Chinook seed fixture version is unexpected.');
    await database.runReadwriteTransaction(async (transaction) => {
      for (const customer of fixture.customers) await transaction.set(key('main.Customer', Number(customer['CustomerId'])), customer);
      for (const invoice of fixture.invoices) await transaction.set(key('main.Invoice', Number(invoice['InvoiceId'])), invoice);
      for (const track of fixture.tracks) await transaction.set(key('main.Track', Number(track['TrackId'])), track);
      await transaction.set(key('_chatMeta', 'chinook-version'), { version: fixtureVersion });
    });
  }

  async query(scope: string, dtql: string): Promise<readonly Record<string, unknown>[]> {
    if (scope !== this.scope) throw new Error('The project changed before this result could be queried.');
    const query = parseDTQL(dtql, CHINOOK_SCHEMA as unknown as DTQLSchema, { maxLimit: 1000 });
    const page = await this.requireDatabase().query(query);
    if (scope !== this.scope) throw new Error('The project changed before this result could be shown.');
    return page.records.map((record) => record.data as Record<string, unknown>);
  }

  private requireDatabase(): IndexedDbDatabase {
    if (!this.database) throw new Error('The local database is not ready.');
    return this.database;
  }
}
