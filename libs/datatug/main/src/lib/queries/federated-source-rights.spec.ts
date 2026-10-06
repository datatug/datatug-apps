import { describe, expect, it, vi } from 'vitest';
import { decodeSourceRights, type SourceRight } from '@sneat/datatug-semantic';
import fixtures from '@sneat/datatug-semantic/fixtures/client-only-source-rights.json';
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
      undefined,
      'fixture-server',
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
      undefined,
      'fixture-server',
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
    ).toThrow(/Unknown/);
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
      () =>
        new FederatedSourceRights(
          planned,
          new Map(),
          expected,
          'fixture-server',
        ),
    ).toThrow(/Expected structured/);
    expect(
      () =>
        new FederatedSourceRights(
          planned,
          inventories(),
          [{ ...expected[0], declaration: { text: 'Other expected terms' } }],
          'fixture-server',
        ),
    ).toThrow(/Expected structured/);
    expect(
      () =>
        new FederatedSourceRights(
          [],
          inventories(),
          expected,
          'fixture-server',
        ),
    ).toThrow(/Unplanned expected/);
    expect(
      new FederatedSourceRights(
        planned,
        inventories(),
        expected,
        'fixture-server',
      ).evidence().sourceRights,
    ).toEqual(rights);
  });
  it('retains Go-owned escaping for a used undeclared source', () => {
    const source = fixtures.specialCharacterIdentity;
    const target = {
      database: source.source.databaseId,
      name: source.source.recordset,
    };
    const session = new FederatedSourceRights(
      [target],
      new Map(),
      undefined,
      'fixture-server',
    );
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
      undefined,
      'fixture-server',
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
        'fixture-server',
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
  it('rejects a first undeclared wrong-server response and any new evidence without admitted identity', () => {
    const target = { database: 'fx', name: 'Rates' };
    const session = new FederatedSourceRights(
      [target],
      new Map(),
      undefined,
      'fixture-server',
    );
    expect(() =>
      session.accept(target, { usedSourceIds: ['ovdb:other-server/fx/Rates'] }),
    ).toThrow(/Unknown/);
    const legacy = new FederatedSourceRights([target], new Map());
    for (const evidence of [
      fixtures.structured,
      { usedSourceIds: ['ovdb:fixture-server/fx/Rates'] },
      { sourceRights: [], usedSourceIds: [] },
    ])
      expect(() => legacy.accept(target, evidence)).toThrow(
        /requires the admitted server identity/,
      );
    expect(
      () =>
        new FederatedSourceRights(
          [target],
          new Map(),
          decodeSourceRights(fixtures.structured.sourceRights),
        ),
    ).toThrow(/admitted server identity/);
  });
  it('rejects an extra structured server and preserves distinct planned source identities', async () => {
    const target = { database: 'fx', name: 'Rates' };
    const original = rights.find(
      (right) => right.source.recordset === 'Rates',
    ) as SourceRight;
    const other = {
      ...original,
      sourceId: 'ovdb:other-server/fx/Rates',
      source: { ...original.source, serverId: 'other-server' },
      declaredAt: { serverId: 'other-server' },
    };
    expect(
      () =>
        new FederatedSourceRights(
          [target],
          new Map([['fx', [original, other]]]),
          [original],
          'fixture-server',
        ),
    ).toThrow(/admitted server identity/);
    await expect(
      preflightSourceRights(
        'https://ovdb.example.test',
        [target],
        async () => response({ sourceRights: [original, other] }),
        {},
        undefined,
        undefined,
        [original],
        'fixture-server',
      ),
    ).rejects.toThrow(/identity differs/);
    expect(
      new FederatedSourceRights(
        planned,
        inventories(),
        undefined,
        'fixture-server',
      ).evidence().sourceRights,
    ).toEqual(rights);
  });
  it('preserves a legacy server with no discovery endpoint, while expected sessions fail closed on missing discovery', async () => {
    const network = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 405 }),
    );
    const legacy = await preflightSourceRights(
      'https://ovdb.example.test',
      planned,
      network,
      {},
    );
    expect(network).not.toHaveBeenCalled();
    legacy.accept(planned[0], {});
    expect(legacy.evidence()).toEqual({});
    await expect(
      preflightSourceRights(
        'https://ovdb.example.test',
        planned,
        network,
        {},
        undefined,
        undefined,
        decodeSourceRights(fixtures.structured.sourceRights),
        'fixture-server',
      ),
    ).rejects.toThrow(/unavailable/);
  });
});
