import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { describe, expect, it } from 'vitest';

import {
  CHAT_SESSION_DATABASE,
  ChatSessionService,
} from '../../../chat/chat-session.service';
import {
  createLazyGithubFileStore,
  NO_GITHUB_FILE_STORE,
} from './github-file-store-api';
import {
  GITHUB_FILE_STORE_DB,
  GITHUB_FILE_STORE_LIMITS,
  GITHUB_FILE_STORE_VERSION,
  openGithubFileStore,
  planGithubFileEviction,
  type IGithubCachedCommit,
  type IGithubFileStoreLimits,
} from './github-file-store';

const MB = 1024 * 1024;
const commit = (
  repo: string,
  n: number,
  bytes: number,
  used: number,
): IGithubCachedCommit => ({
  key: `${repo}@${n}`,
  repo,
  bytes,
  used,
});
const LIMITS: IGithubFileStoreLimits = {
  maxBytes: 100,
  maxRepos: 3,
  maxCommitsPerRepo: 2,
  maxResolved: 3,
};

describe('the bounds of the cache (design 3.6): 20 MB and 20 repos, two commits per repo, least recently used first', () => {
  it('has the numbers of the design', () => {
    expect(GITHUB_FILE_STORE_LIMITS).toMatchObject({
      maxBytes: 20 * MB,
      maxRepos: 20,
      maxCommitsPerRepo: 2,
    });
  });

  describe('planGithubFileEviction', () => {
    const plan = (
      commits: IGithubCachedCommit[],
      key: string,
      bytes: number,
      limits = LIMITS,
    ) =>
      planGithubFileEviction(
        commits,
        { key, repo: key.split('@')[0] },
        bytes,
        limits,
      );

    it('keeps everything while it fits', () => {
      expect(
        plan([commit('o/a', 1, 10, 1), commit('o/b', 1, 10, 2)], 'o/a@1', 5),
      ).toEqual({ fits: true, evict: [] });
    });

    it("a third commit of a repo evicts that repo's least recently used commit, not another repo's", () => {
      const commits = [
        commit('o/a', 1, 10, 5),
        commit('o/a', 2, 10, 3),
        commit('o/b', 1, 10, 1),
      ];
      expect(plan(commits, 'o/a@3', 5)).toEqual({
        fits: true,
        evict: ['o/a@2'],
      });
    });

    it('a new file of a commit that is already one of the two does not evict', () => {
      const commits = [commit('o/a', 1, 10, 5), commit('o/a', 2, 10, 3)];
      expect(plan(commits, 'o/a@2', 5)).toEqual({ fits: true, evict: [] });
    });

    it('a fourth repo evicts the repo used longest ago, with all its commits', () => {
      const commits = [
        commit('o/a', 1, 10, 9),
        commit('o/b', 1, 10, 1),
        commit('o/b', 2, 10, 2),
        commit('o/c', 1, 10, 5),
      ];
      const result = plan(commits, 'o/d@1', 5);
      expect(result.fits).toBe(true);
      expect([...result.evict].sort()).toEqual(['o/b@1', 'o/b@2']);
    });

    it('over the byte limit evicts least recently used commits until it fits, and never the current commit', () => {
      const commits = [
        commit('o/a', 1, 40, 1),
        commit('o/b', 1, 40, 2),
        commit('o/c', 1, 10, 3),
      ];
      const result = plan(commits, 'o/c@1', 40); // 90 + 40 > 100 -> drop o/a (used 1), 50 + 40 <= 100
      expect(result).toEqual({ fits: true, evict: ['o/a@1'] });
    });

    it('a file that cannot fit even alone is not kept and nothing is evicted for it', () => {
      expect(plan([commit('o/a', 1, 40, 1)], 'o/b@1', 101)).toEqual({
        fits: false,
        evict: [],
      });
      // Nor one that cannot fit next to what its own commit already holds.
      expect(
        plan([commit('o/a', 1, 60, 1), commit('o/b', 1, 30, 0)], 'o/a@1', 41),
      ).toEqual({ fits: false, evict: [] });
    });
  });

  describe('over IndexedDB', () => {
    const open = (limits = LIMITS, time = { t: 1 }) => ({
      time,
      store: openGithubFileStore(new IDBFactory(), () => time.t, limits),
    });
    const A1 = 'o/a@' + 'a'.repeat(40);
    const A2 = 'o/a@' + 'b'.repeat(40);
    const A3 = 'o/a@' + 'c'.repeat(40);

    it('keeps a file and its absence, per commit and path, and a file is written once', async () => {
      const { store } = open();
      expect(await store.getFile(A1, 'x/y.json')).toBeUndefined();
      await store.putFile(A1, 'x/y.json', { text: '{"a":1}', bytes: 7 });
      await store.putFile(A1, 'gone.json', { text: null, bytes: 0 });
      await store.putFile(A1, 'x/y.json', { text: 'changed', bytes: 7 }); // a commit's files never change
      expect(await store.getFile(A1, 'x/y.json')).toEqual({
        text: '{"a":1}',
        bytes: 7,
      });
      expect(await store.getFile(A1, 'gone.json')).toEqual({
        text: null,
        bytes: 0,
      });
      expect(await store.getFile(A2, 'x/y.json')).toBeUndefined();
    });

    it('survives a reload: a new store over the same database sees it', async () => {
      const factory = new IDBFactory();
      await openGithubFileStore(factory, () => 1).putFile(A1, 'f', {
        text: 'kept',
        bytes: 4,
      });
      expect(
        await openGithubFileStore(factory, () => 2).getFile(A1, 'f'),
      ).toEqual({ text: 'kept', bytes: 4 });
    });

    it('evicts the least recently used commit of a repo when a third arrives, files and all', async () => {
      const { store, time } = open();
      time.t = 1;
      await store.putFile(A1, 'f', { text: '1', bytes: 1 });
      await store.putFile(A1, '#tree', { text: '[]', bytes: 2 });
      time.t = 2;
      await store.putFile(A2, 'f', { text: '2', bytes: 1 });
      time.t = 3;
      await store.putFile(A3, 'f', { text: '3', bytes: 1 });
      expect(await store.getFile(A1, 'f')).toBeUndefined();
      expect(await store.getFile(A1, '#tree')).toBeUndefined();
      expect(await store.getFile(A2, 'f')).toBeDefined();
      expect(await store.getFile(A3, 'f')).toBeDefined();
    });

    it('a commit that was read is not the least recently used', async () => {
      const { store, time } = open();
      time.t = 1;
      await store.putFile(A1, 'f', { text: '1', bytes: 1 });
      time.t = 2;
      await store.putFile(A2, 'f', { text: '2', bytes: 1 });
      time.t = 3;
      expect(await store.getFile(A1, 'f')).toBeDefined(); // A1 is now the more recent
      time.t = 4;
      await store.putFile(A3, 'f', { text: '3', bytes: 1 });
      expect(await store.getFile(A1, 'f')).toBeDefined();
      expect(await store.getFile(A2, 'f')).toBeUndefined();
    });

    it('does not evict a neighbouring commit whose key starts the same', async () => {
      const { store } = open({ ...LIMITS, maxCommitsPerRepo: 1 });
      await store.putFile('o/a@abc', 'f', { text: 'abc', bytes: 1 });
      await store.putFile('o/a@abcd', 'f', { text: 'abcd', bytes: 1 }); // evicts o/a@abc, only
      expect(await store.getFile('o/a@abc', 'f')).toBeUndefined();
      expect(await store.getFile('o/a@abcd', 'f')).toBeDefined();
    });

    it('evicts the repo used longest ago when more than the allowed repos are kept', async () => {
      const { store, time } = open();
      for (const [i, repo] of ['o/r1', 'o/r2', 'o/r3', 'o/r4'].entries()) {
        time.t = i + 1;
        await store.putFile(`${repo}@s`, 'f', { text: repo, bytes: 1 });
      }
      expect(await store.getFile('o/r1@s', 'f')).toBeUndefined();
      for (const repo of ['o/r2', 'o/r3', 'o/r4']) {
        expect(await store.getFile(`${repo}@s`, 'f')).toBeDefined();
      }
    });

    it('stays under the byte limit, dropping whole commits, least recently used first', async () => {
      const { store, time } = open();
      time.t = 1;
      await store.putFile('o/a@s', 'f', { text: 'x'.repeat(60), bytes: 60 });
      time.t = 2;
      await store.putFile('o/b@s', 'f', { text: 'y'.repeat(30), bytes: 30 });
      time.t = 3;
      await store.putFile('o/c@s', 'f', { text: 'z'.repeat(30), bytes: 30 });
      expect(await store.getFile('o/a@s', 'f')).toBeUndefined();
      expect(await store.getFile('o/b@s', 'f')).toBeDefined();
      expect(await store.getFile('o/c@s', 'f')).toBeDefined();
      // A file bigger than the whole cache is simply not kept.
      await store.putFile('o/d@s', 'big', { text: 'q', bytes: 101 });
      expect(await store.getFile('o/d@s', 'big')).toBeUndefined();
    });

    it('remembers the commit a ref resolved to, and forgets the oldest answers beyond its bound', async () => {
      const { store } = open();
      expect(await store.getResolved('o/a@HEAD')).toBeUndefined();
      for (let i = 1; i <= 5; i++) {
        await store.putResolved(`o/r${i}@HEAD`, { sha: `sha${i}`, at: i });
      }
      expect(await store.getResolved('o/r5@HEAD')).toEqual({
        sha: 'sha5',
        at: 5,
      });
      expect(await store.getResolved('o/r3@HEAD')).toEqual({
        sha: 'sha3',
        at: 3,
      });
      expect(await store.getResolved('o/r2@HEAD')).toBeUndefined();
      expect(await store.getResolved('o/r1@HEAD')).toBeUndefined();
    });

    it('is no cache, not an error, when IndexedDB is missing, refuses, or is a database it cannot use', async () => {
      expect(openGithubFileStore(undefined, () => 1)).toBe(
        NO_GITHUB_FILE_STORE,
      );

      const refusing = openGithubFileStore(
        {
          open() {
            throw new Error('SecurityError');
          },
        } as unknown as IDBFactory,
        () => 1,
      );
      await refusing.putFile(A1, 'f', { text: 'x', bytes: 1 });
      expect(await refusing.getFile(A1, 'f')).toBeUndefined();
      expect(await refusing.getResolved('o/a@HEAD')).toBeUndefined();

      // A database of that name made by something else, without the stores this build needs.
      const factory = new IDBFactory();
      await new Promise<void>((resolve, reject) => {
        const req = factory.open(GITHUB_FILE_STORE_DB, 7);
        req.onupgradeneeded = () => req.result.createObjectStore('unrelated');
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
      const foreign = openGithubFileStore(factory, () => 1);
      await foreign.putFile(A1, 'f', { text: 'x', bytes: 1 });
      expect(await foreign.getFile(A1, 'f')).toBeUndefined();
    });

    it('a store that fails to load is no store (the lazy loader)', async () => {
      const lazy = createLazyGithubFileStore(() =>
        Promise.reject(new Error('chunk failed to load')),
      );
      await lazy.putFile(A1, 'f', { text: 'x', bytes: 1 });
      expect(await lazy.getFile(A1, 'f')).toBeUndefined();
      expect(await lazy.getResolved('k')).toBeUndefined();
    });
  });

  describe('rollback-safe (design 6.6): a database of its own, never a new version of an existing one', () => {
    const databaseNames = async (factory: IDBFactory) =>
      (await factory.databases()).map((d) => `${d.name}@${d.version}`).sort();

    it('forward: the cache runs next to the chat database and leaves it exactly as it was', async () => {
      // The chat database, made by the chat's own storage service, with a chat in it.
      TestBed.resetTestingModule();
      const chat = TestBed.inject(ChatSessionService);
      const session = await chat.create('store:rollback');
      const before = await databaseNames(indexedDB);
      expect(before).toContain('datatug-chat-sessions@2');

      // The new build reads a project and fills the cache.
      const cache = openGithubFileStore(indexedDB, () => 1);
      await cache.putFile('o/r@' + 'f'.repeat(40), 'datatug-project.json', {
        text: '{}',
        bytes: 2,
      });
      await cache.putResolved('o/r@HEAD', { sha: 'f'.repeat(40), at: 1 });

      // Only a database was added; the chat database is still at version 2, untouched.
      const after = await databaseNames(indexedDB);
      expect(after).toEqual(
        [
          ...before,
          `${GITHUB_FILE_STORE_DB}@${GITHUB_FILE_STORE_VERSION}`,
        ].sort(),
      );
      expect(after).toContain('datatug-chat-sessions@2');

      // Back: `main`'s build of the chat (the same definition, version 2, no knowledge of the cache) opens it and
      // lists exactly the chats it had.
      const olderBuild = new IndexedDbDatabase({
        name: 'datatug-chat-sessions',
        version: 2,
        collections: [
          'ChatSessions',
          'ChatTurns',
          'ChatQueries',
          'ChatRecordSets',
          'ChatBookmarks',
        ],
      });
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [{ provide: CHAT_SESSION_DATABASE, useValue: olderBuild }],
      });
      const listed =
        await TestBed.inject(ChatSessionService).list('store:rollback');
      expect(listed.map((s) => s.id)).toEqual([session.id]);
      // And a plain open at version 2 is not refused.
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('datatug-chat-sessions', 2);
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    });

    it('back: a build rolled back to this one finds a cache database a later build raised to version 2, and keeps using it', async () => {
      const factory = new IDBFactory();
      await new Promise<void>((resolve, reject) => {
        const req = factory.open(GITHUB_FILE_STORE_DB, 2);
        req.onupgradeneeded = () => {
          for (const name of [
            'files',
            'commits',
            'resolved',
            'added-by-a-later-build',
          ]) {
            req.result.createObjectStore(name, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
      const store = openGithubFileStore(factory, () => 1);
      await store.putFile('o/r@s', 'f', { text: 'kept', bytes: 4 });
      expect(await store.getFile('o/r@s', 'f')).toEqual({
        text: 'kept',
        bytes: 4,
      });
      expect(await databaseNames(factory)).toEqual([
        `${GITHUB_FILE_STORE_DB}@2`,
      ]);
    });

    it("does not hold up a later build's upgrade of the database (it closes on a version change)", async () => {
      const factory = new IDBFactory();
      const store = openGithubFileStore(factory, () => 1);
      await store.putFile('o/r@s', 'f', { text: 'x', bytes: 1 });
      await new Promise<void>((resolve, reject) => {
        const req = factory.open(GITHUB_FILE_STORE_DB, 2);
        req.onupgradeneeded = () =>
          req.result.createObjectStore('later', { keyPath: 'key' });
        req.onblocked = () =>
          reject(new Error('the upgrade was blocked by this build'));
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    });
  });
});
