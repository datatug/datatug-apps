import { describe, expect, it, vi } from 'vitest';
import { decodeSourceRights, type SourceRight } from '@sneat/datatug-semantic';
import fixtures from '@sneat/datatug-semantic/fixtures/source-rights.json';
import {
  FederatedSourceRights,
  preflightSourceRights,
} from './federated-source-rights';

const rights = decodeSourceRights(fixtures.multiSource.sourceRights);
const planned = rights.map((right) => ({
  database: right.source.databaseId ?? '',
  name: right.source.recordset ?? '',
}));
const inventories = () =>
  new Map(
    ['fx', 'music'].map((db) => [
      db,
      rights.filter((right) => right.source.databaseId === db),
    ]),
  );
const response = (body: unknown) => new Response(JSON.stringify(body));

describe('frozen source terms before browser federation output', () => {
  it('freezes every planned lookup, preserves unused inputs and rejects changed later-page evidence', () => {
    const mutable = structuredClone(rights);
    const session = new FederatedSourceRights(
      planned,
      new Map([
        ['fx', mutable.filter((right) => right.source.databaseId === 'fx')],
        [
          'music',
          mutable.filter((right) => right.source.databaseId === 'music'),
        ],
      ]),
    );
    const rate = rights.find(
      (right) => right.source.recordset === 'Rates',
    ) as SourceRight;
    session.accept({ database: 'fx', name: 'Rates' }, fixtures.structured);
    expect(session.evidence().sourceRights).toHaveLength(3);
    expect(session.evidence().usedSourceIds).toEqual([rate.sourceId]);
    mutable[0] = {
      ...mutable[0],
      declaration: { text: 'Edited selected declaration' },
    };
    expect(session.evidence().sourceRights).toEqual(rights);
    expect(() =>
      session.accept(
        { database: 'fx', name: 'Rates' },
        {
          sourceRights: [{ ...rate, declaration: { text: 'Later terms' } }],
          usedSourceIds: [rate.sourceId],
        },
      ),
    ).toThrow(/changed/);
    expect(() =>
      session.accept(
        { database: 'fx', name: 'Rates' },
        {
          ...fixtures.structured,
          usedSourceIds: ['ovdb:unknown-server/fx/Rates'],
        },
      ),
    ).toThrow(/usage evidence/);
    expect(() => session.accept({ database: 'fx', name: 'Rates' }, {})).toThrow(
      /missing/,
    );
    expect(() =>
      session.accept(
        { database: 'fx', name: 'Rates' },
        { sourceRights: [rate] },
      ),
    ).toThrow(/usage evidence/);
  });
  it('supports legacy absence and authorized undeclared identities without inventing a licence', () => {
    const targets = [
      { database: 'music', name: 'Album' },
      { database: 'unlicensed', name: 'Notes' },
    ];
    const session = new FederatedSourceRights(
      targets,
      new Map([['music', decodeSourceRights(fixtures.legacy.sourceRights)]]),
    );
    session.accept(targets[0], fixtures.legacy);
    session.accept(targets[1], {
      usedSourceIds: ['ovdb:fixture-server/unlicensed/Notes'],
    });
    expect(session.evidence()).toEqual(fixtures.mixedDeclaredUndeclared);
    expect(() =>
      session.accept(targets[1], {
        usedSourceIds: ['ovdb:unknown-server/unlicensed/Notes'],
      }),
    ).toThrow(/identity changed/);
    expect(() =>
      session.accept(targets[1], {
        usedSourceIds: ['ovdb:fixture-server/private/Notes'],
      }),
    ).toThrow(/Unknown/);
    expect(() =>
      session.accept(targets[1], {
        sourceRights: fixtures.structured.sourceRights,
      }),
    ).toThrow(/late/);
    const legacy = new FederatedSourceRights(targets, new Map());
    legacy.accept(targets[0], {});
    expect(legacy.evidence()).toEqual({});
  });
  it('fails closed when configured structured evidence is missing, changed or outside the plan', () => {
    const expected = decodeSourceRights(fixtures.structured.sourceRights);
    expect(
      () => new FederatedSourceRights(planned, new Map(), expected),
    ).toThrow(/Expected structured/);
    expect(
      () =>
        new FederatedSourceRights(planned, inventories(), [
          { ...expected[0], declaration: { text: 'Other expected terms' } },
        ]),
    ).toThrow(/Expected structured/);
    expect(
      () => new FederatedSourceRights([], inventories(), expected),
    ).toThrow(/Unplanned expected/);
    expect(
      new FederatedSourceRights(planned, inventories(), expected).evidence()
        .sourceRights,
    ).toEqual(rights);
  });
  it('retains Go-owned escaping for a used undeclared source', () => {
    const source = fixtures.specialCharacterIdentity;
    const target = {
      database: source.source.databaseId,
      name: source.source.recordset,
    };
    const session = new FederatedSourceRights([target], new Map());
    session.accept(target, { usedSourceIds: [source.sourceId] });
    expect(session.evidence().usedSourceIds).toEqual([source.sourceId]);
  });
  it('preflights unique planned databases only, charges discovery bytes and never reads a terms link', async () => {
    const network = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer fixture-only',
      );
      const database = String(url).split('/').at(-1);
      return response({ sourceRights: inventories().get(database ?? '') });
    });
    const charge = vi.fn();
    const session = await preflightSourceRights(
      'https://ovdb.example.test',
      planned,
      network,
      { Authorization: 'Bearer fixture-only' },
      undefined,
      charge,
    );
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls.map(([url]) => String(url))).toEqual([
      'https://ovdb.example.test/v1/databases/fx',
      'https://ovdb.example.test/v1/databases/music',
    ]);
    expect(
      charge.mock.calls.reduce((total, [bytes]) => total + bytes, 0),
    ).toBeGreaterThan(0);
    expect(session.evidence().sourceRights).toEqual(rights);
    expect(session.evidence().usedSourceIds).toEqual([]);
  });
  it('rejects redirects, cross-database evidence, oversized discovery and cancellation before output', async () => {
    const target = [{ database: 'fx', name: 'Rates' }];
    const go = (
      fetcher: typeof fetch,
      signal?: AbortSignal,
      expected?: readonly SourceRight[],
    ) =>
      preflightSourceRights(
        'https://ovdb.example.test',
        target,
        fetcher,
        {},
        signal,
        undefined,
        expected,
      );
    const redirected = response({});
    Object.defineProperty(redirected, 'redirected', { value: true });
    await expect(go(async () => redirected)).rejects.toThrow(/unavailable/);
    await expect(go(async () => response(fixtures.legacy))).rejects.toThrow(
      /identity differs/,
    );
    await expect(
      go(async () => response({ pad: 'x'.repeat(1048576) })),
    ).rejects.toThrow(/byte limit/);
    await expect(
      go(
        async () => response({}),
        undefined,
        decodeSourceRights(fixtures.structured.sourceRights),
      ),
    ).rejects.toThrow(/Expected structured/);
    const controller = new AbortController();
    const cancelled = vi.fn();
    const pending = go(
      async () =>
        new Response(
          new ReadableStream({
            start() {
              controller.abort(new Error('fixture cancelled'));
            },
            cancel: cancelled,
          }),
        ),
      controller.signal,
    );
    await expect(pending).rejects.toThrow(/fixture cancelled/);
    expect(cancelled).toHaveBeenCalled();
  });
});
