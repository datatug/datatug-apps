// Where an investigation is kept: a second instance of the chat's storage service over a database of its own
// (design `demo-as-github-project.md` 6.6, task G-A3a).
//
// Rollback-safe by construction (6.6 rules 1 and 4). `datatug-chat-sessions` is not touched by anything in this file:
// its definition (`CHAT_SESSION_DATABASE`, version 2, five collections) is exactly what `main` has always had, so an older
// build, or this build with no investigation, opens it and lists exactly the chats it had. Everything an
// investigation stores (its session, its turns, its rows and its trace steps) goes into `datatug-investigations`,
// which no older build has heard of and so can never be broken by. An investigation is never written to the chat
// database, and never drawn from it.
//
// Storage that is missing, refusing or foreign means "no investigation storage" (`sessions()` answers `undefined`),
// never a failed start: nothing here runs before someone asks for the sessions.
//
// The database is opened at version 1 only (the adapter of `@dalgo/indexeddb` opens at a fixed version). Changing it
// later follows rule 3 of 6.6, as for any existing database.

import { Injectable, InjectionToken, Injector, inject } from '@angular/core';
import type { Database } from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import {
  CHAT_RECORD_SET_SOURCE_CHECK,
  CHAT_SESSION_DATABASE,
  ChatSessionService,
  type ChatRecordSetSourceCheck,
} from '../chat-session.service';

export const INVESTIGATION_DATABASE_NAME = 'datatug-investigations';
export const INVESTIGATION_DATABASE_VERSION = 1;
/** The chat's collections, and the trace steps that only an investigation has. */
export const INVESTIGATION_COLLECTIONS = [
  'ChatSessions',
  'ChatTurns',
  'ChatQueries',
  'ChatRecordSets',
  'ChatBookmarks',
  'ChatTraceSteps',
] as const;

/** The investigation database over `factory` (the browser's `indexedDB` when none is given). Opens nothing yet. */
export function createInvestigationDatabase(factory?: IDBFactory): Database {
  return new IndexedDbDatabase({
    name: INVESTIGATION_DATABASE_NAME,
    version: INVESTIGATION_DATABASE_VERSION,
    collections: [...INVESTIGATION_COLLECTIONS],
    ...(factory ? { factory } : {}),
  });
}

/** `undefined` when the browser will not even hand out IndexedDB (some blocked-storage modes throw on access). */
export const INVESTIGATION_DATABASE = new InjectionToken<Database | undefined>(
  'Investigation database',
  {
    providedIn: 'root',
    factory: () => {
      try {
        return createInvestigationDatabase();
      } catch {
        return undefined;
      }
    },
  },
);

/** An investigation's RecordSets come from the sources of its own project, whatever the project declares. */
export const investigationSourceCheck: ChatRecordSetSourceCheck = (scope, source) =>
  source.startsWith(`${scope}/`);

/** The chat's storage service, a second instance of it, over `database`. Nothing is opened yet. */
export function createInvestigationSessions(
  database: Database,
  parent: Injector,
): ChatSessionService {
  return Injector.create({
    parent,
    providers: [
      { provide: CHAT_SESSION_DATABASE, useValue: database },
      { provide: CHAT_RECORD_SET_SOURCE_CHECK, useValue: investigationSourceCheck },
      ChatSessionService,
    ],
  }).get(ChatSessionService);
}

/**
 * The investigation sessions, when this browser can keep them. The first call opens the database and checks it has
 * every collection this build needs (an unknown newer version, another application's database of that name, a blocked,
 * full or missing IndexedDB all fail that check); the answer holds for the rest of the visit.
 */
@Injectable({ providedIn: 'root' })
export class InvestigationStorage {
  private readonly injector = inject(Injector);
  private readonly database = inject(INVESTIGATION_DATABASE);
  private available?: Promise<ChatSessionService | undefined>;

  sessions(): Promise<ChatSessionService | undefined> {
    return (this.available ??= this.open());
  }

  private async open(): Promise<ChatSessionService | undefined> {
    const database = this.database;
    if (!database) {
      return undefined;
    }
    try {
      // A transaction over every collection: it fails when the database cannot be opened at this version or lacks one.
      await database.getMany([]);
      return createInvestigationSessions(database, this.injector);
    } catch {
      return undefined;
    }
  }
}
