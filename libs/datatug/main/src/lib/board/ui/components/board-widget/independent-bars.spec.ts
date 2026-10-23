import rightsWire from '@sneat/datatug-semantic/fixtures/client-only-source-rights.json';
import { runFederatedQuery } from '../../../../queries/federated-query-executor';
import { consumeOvdbOrdinaryQuery } from '../../../../queries/ovdb-ordinary-execution';
import { FederatedSourceRights } from '../../../../queries/federated-source-rights';
import {
  QueryType,
  type IQueryDef,
} from '../../../../models/definition/query-def';
import { describe, expect, it } from 'vitest';
import type { BarChartSpec } from '@datatug/board-models';
import {
  decodeSourceRightsEvidence,
  type ServerChartRecordset,
} from '@sneat/datatug-semantic';
import {
  admitIndependentSource,
  prepareIndependentBars,
  type IndependentBarSource,
} from './independent-bars';

const rightsFor = (database: string, collection: string) =>
  decodeSourceRightsEvidence({
    sourceRights: [
      {
        ...rightsWire.structured.sourceRights[0],
        sourceId: `ovdb:fixture-server/${database}/${collection}`,
        source: {
          serverId: 'fixture-server',
          databaseId: database,
          recordset: collection,
        },
      },
    ],
    usedSourceIds: [`ovdb:fixture-server/${database}/${collection}`],
  });
const chart: BarChartSpec = {
  type: 'bar',
  categoryColumn: 'country',
  valueColumn: 'customers',
  unit: 'customer records',
};
function source(
  id: string,
  values: readonly [string, number | string][],
): IndependentBarSource {
  const result: ServerChartRecordset = {
    ...decodeSourceRightsEvidence(rightsWire.structured),
    runtime: 'server',
    complete: true,
    hasMore: false,
    truncated: false,
    limitations: [],
    bindingsApplied: [],
    provenance: {
      source: id,
      mode: 'live',
      observedAt: '2026-10-21T00:00:00Z',
      executionProfile: 'opaque-privileged',
    },
    recordset: {
      columns: [
        { name: 'country', type: 'string' },
        { name: 'customers', type: 'integer' },
      ],
      rows: values.map(([country, value]) => [
        { type: 'string', value: country },
        { type: 'integer', value: String(value) },
      ]),
    },
  };
  const snapshot = { queryId: id, identity: id, result };
  const admission = admitIndependentSource(
    snapshot,
    { id, request: { queryType: QueryType.DTQL } },
    false,
  );
  return { id, state: { loading: false, snapshot, admission } };
}
describe('independent source presentation', () => {
  it('keeps exact union, missing observations and each original row identity without fabricating a joined result', () => {
    const n = source('northwind', [
      ['UK', 7],
      ['Canada', 3],
      ['USA', 13],
    ]);
    const c = source('chinook', [
      ['United Kingdom', 3],
      ['Canada', 8],
      ['USA', 13],
    ]);
    const before = JSON.stringify([n, c]);
    expect(prepareIndependentBars(chart, [n, c])).toEqual({
      sources: ['northwind', 'chinook'],
      minimum: 0,
      maximum: 13,
      groups: [
        {
          category: 'Canada',
          observations: [
            { value: 3, sourceRow: 1 },
            { value: 8, sourceRow: 1 },
          ],
        },
        { category: 'UK', observations: [{ value: 7, sourceRow: 0 }, null] },
        {
          category: 'USA',
          observations: [
            { value: 13, sourceRow: 2 },
            { value: 13, sourceRow: 2 },
          ],
        },
        {
          category: 'United Kingdom',
          observations: [null, { value: 3, sourceRow: 0 }],
        },
      ],
    });
    expect(JSON.stringify([n, c])).toBe(before);
  });
  it('rejects incomplete, failed, malformed rights, duplicated categories, unsafe numeric forms and undeclared units', () => {
    const good = source('n', [['Canada', 3]]);
    expect(() =>
      prepareIndependentBars({ ...chart, unit: undefined }, [good]),
    ).toThrow(/unit/);
    expect(() =>
      prepareIndependentBars(chart, [
        { ...good, state: { ...good.state, loading: true } },
      ]),
    ).toThrow(/successful complete/);
    expect(() =>
      prepareIndependentBars(chart, [
        { ...good, state: { ...good.state, error: 'failed' } },
      ]),
    ).toThrow();
    expect(() =>
      prepareIndependentBars(chart, [
        source('n', [
          ['Canada', 3],
          ['Canada', 8],
        ]),
      ]),
    ).toThrow(/unique/);
    for (const value of [
      '3.1',
      '1e3',
      '0x10',
      '9007199254740993',
      Number.NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() =>
        prepareIndependentBars(chart, [source('n', [['Canada', value]])]),
      ).toThrow();
    const held = good.state.snapshot;
    if (!held) throw new Error('Missing test snapshot');
    const result = held.result;
    expect(() =>
      prepareIndependentBars(chart, [
        {
          ...good,
          state: {
            loading: false,
            snapshot: {
              ...held,
              result: { ...result, truncated: true },
            },
          },
        },
      ]),
    ).toThrow();
    expect(() =>
      prepareIndependentBars(chart, [
        {
          ...good,
          state: {
            loading: false,
            snapshot: {
              ...held,
              result: { ...result, sourceRights: [{}] } as never,
            },
          },
        },
      ]),
    ).toThrow();
  });
  it('preserves zero and signed counts as observations, never fills an absent category with zero', () => {
    const bars = prepareIndependentBars(chart, [
      source('n', [
        ['A', 0],
        ['B', -3],
      ]),
      source('c', [['B', 4]]),
    ]);
    expect(bars.minimum).toBe(-3);
    expect(bars.maximum).toBe(4);
    expect(bars.groups[0].observations).toEqual([
      { value: 0, sourceRow: 0 },
      null,
    ]);
  });
  it('admits the actual ordinary transport shape without inventing a server execution profile and refuses physical/query/context mismatch', async () => {
    const definition: IQueryDef = {
      id: 'customer-counts',
      request: { queryType: QueryType.DTQL },
      federation: {
        ovdbBaseUrl: 'https://cloud.openvaultdb.com',
        expectedServerIdentity: {
          baseUrl: 'https://cloud.openvaultdb.com',
          serverId: 'fixture-server',
        },
        tables: [
          { database: 'chinook', name: 'Customer', fields: ['Country'] },
        ],
      },
      recordsets: [
        {
          name: 'counts',
          columns: [
            { name: 'country', type: 'string' },
            { name: 'customers', type: 'integer' },
          ],
        },
      ],
    };
    const result = await consumeOvdbOrdinaryQuery(
      Response.json({
        ...rightsFor('chinook', 'Customer'),
        complete: true,
        columns: ['country', 'customers'],
        records: [{ data: { country: 'Canada', customers: 8 } }],
        execution: {
          route: 'database',
          rowsReturned: 1,
          sources: [{ database: 'chinook', collection: 'Customer' }],
        },
      }),
      definition,
      'https://cloud.openvaultdb.com',
      'chinook',
      new FederatedSourceRights(
        [{ database: 'chinook', name: 'Customer' }],
        new Map([['chinook', rightsFor('chinook', 'Customer').sourceRights]]),
        undefined,
        'fixture-server',
      ),
    );
    const snapshot = { queryId: 'demodb/customer-counts', result };
    const admission = admitIndependentSource(snapshot, definition, true);
    expect(admission.basis).toBe('ordinary-direct');
    expect(result.provenance).not.toHaveProperty('executionProfile');
    expect(result).not.toHaveProperty('runtime');
    expect(() =>
      admitIndependentSource(
        {
          ...snapshot,
          result: {
            ...result,
            sourceRights: undefined,
            usedSourceIds: undefined,
          },
        },
        definition,
        true,
      ),
    ).toThrow(/rights are unavailable/);
    expect(() =>
      admitIndependentSource(
        {
          ...snapshot,
          result: { ...result, limitations: ['restricted'] } as never,
        },
        definition,
        true,
      ),
    ).toThrow(/restrictions/);
    expect(
      prepareIndependentBars(chart, [
        { id: 'chinook', state: { loading: false, snapshot, admission } },
      ]).groups[0].observations[0]?.value,
    ).toBe(8);
    expect(() => admitIndependentSource(snapshot, definition, false)).toThrow(
      /ordinary public/,
    );
    expect(() =>
      admitIndependentSource(
        snapshot,
        { ...definition, id: 'different' },
        true,
      ),
    ).toThrow(/identity/);
    const federation = definition.federation;
    if (!federation) throw new Error('Missing fixture federation');
    expect(() =>
      admitIndependentSource(
        snapshot,
        {
          ...definition,
          federation: {
            ...federation,
            tables: [{ database: 'northwind', name: 'Customers', fields: [] }],
          },
        },
        true,
      ),
    ).toThrow(/physical source/);
    expect(() =>
      admitIndependentSource(
        {
          ...snapshot,
          result: {
            ...result,
            provenance: {
              ...result.provenance,
              source:
                'https://elsewhere.example/v1/databases/chinook (direct OVDB)',
            },
          },
        },
        definition,
        true,
      ),
    ).toThrow(/endpoint/);
    expect(() =>
      prepareIndependentBars(chart, [
        {
          id: 'forged',
          state: {
            loading: false,
            snapshot,
            admission: { snapshot, basis: 'ordinary-direct' },
          },
        },
      ]),
    ).toThrow(/not been admitted/);
  });

  it('uses the existing streaming executor terminal parser and preserves absent runtime/profile for full source comparison', async () => {
    const definition: IQueryDef = {
      id: 'stream-counts',
      request: {
        queryType: QueryType.DTQL,
        text: JSON.stringify({
          from: { database: 'chinook', name: 'Customer' },
          limit: 100,
        }),
      } as never,
      federation: {
        ovdbBaseUrl: 'https://cloud.openvaultdb.com',
        expectedServerIdentity: {
          baseUrl: 'https://cloud.openvaultdb.com',
          serverId: 'fixture-server',
        },
        tables: [
          { database: 'chinook', name: 'Customer', fields: ['Country'] },
        ],
      },
      recordsets: [
        {
          name: 'counts',
          columns: [
            { name: 'country', type: 'string' },
            { name: 'customers', type: 'integer' },
          ],
        },
      ],
    };
    const envelope = {
      records: [{ data: { country: 'Canada', customers: 8 } }],
      columns: ['country', 'customers'],
      complete: true,
      execution: {
        route: 'database',
        rowsReturned: 1,
        sources: [{ database: 'chinook', collection: 'Customer' }],
      },
      ...rightsFor('chinook', 'Customer'),
    };
    const execute = (body: unknown) =>
      runFederatedQuery(
        definition,
        undefined,
        '',
        undefined,
        undefined,
        'full',
        undefined,
        undefined,
        {
          fetch: async (input, init) =>
            String(input).endsWith('/chinook')
              ? Response.json({
                  id: 'chinook',
                  serverId: 'fixture-server',
                  ...rightsFor('chinook', 'Customer'),
                  capabilities: {
                    dtql: true,
                    dtqlStreaming: true,
                    dtqlStreamingErrors: true,
                  },
                })
              : Response.json(body, {
                  headers: {
                    'Content-Type':
                      new Headers(init?.headers).get('Accept') ||
                      'application/json',
                  },
                }),
        },
      );
    const result = await execute(envelope);
    expect(result.nativeStreamRead).toMatchObject({
      terminalComplete: true,
      observedRows: 1,
      endpoint: 'https://cloud.openvaultdb.com/v1/databases/chinook/dtql',
      plannedSources: [{ database: 'chinook', collection: 'Customer' }],
    });
    expect(result.provenance).not.toHaveProperty('executionProfile');
    expect(result).not.toHaveProperty('runtime');
    expect(result).not.toHaveProperty('ordinaryComplete');
    const snapshot = { queryId: 'demodb/stream-counts', result };
    const admission = admitIndependentSource(snapshot, definition, true);
    expect(admission.basis).toBe('stream-eof');
    expect(
      prepareIndependentBars(chart, [
        { id: 'chinook', state: { loading: false, snapshot, admission } },
      ]).groups[0].observations[0]?.value,
    ).toBe(8);
    await expect(execute({ ...envelope, complete: false })).rejects.toThrow(
      /complete/,
    );
    await expect(
      execute({
        ...envelope,
        execution: { ...envelope.execution, rowsReturned: 2 },
      }),
    ).rejects.toThrow(/count/);
    await expect(
      execute({
        ...envelope,
        execution: {
          ...envelope.execution,
          sources: [{ database: 'northwind', collection: 'Customers' }],
        },
      }),
    ).rejects.toThrow(/sources/);
    expect(() => admitIndependentSource(snapshot, definition, false)).toThrow(
      /public stream/,
    );
  });
});
