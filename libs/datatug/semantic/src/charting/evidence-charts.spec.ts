import {
  canonicalRecordsetJSON,
  recordsetFingerprint,
  resolveRowEvidence,
  verifyRowEvidence,
} from './evidence-integrity';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import fingerprintJSON from './testdata/recordset-fingerprints.json?raw';
const fingerprints = JSON.parse(fingerprintJSON) as {
  cases: {
    name: string;
    recordset: unknown;
    canonicalJSON: string;
    sha256: string;
  }[];
};
import legacy from '../contract/fixtures/result_live.json';
import { decodeResult } from '../contract/decoders';
import type { Result, TypedValue } from '../contract/types';
import { decodeEvidenceArtifactRef, decodeRowEvidence } from './row-evidence';
import type { RowEvidenceSelector } from './row-evidence';
import { decodeEvidenceResultJSON } from './evidence-json';
import {
  decodeEvidenceChartSpec,
  prepareEvidenceChart,
} from './evidence-charts';
import type {
  EvidenceChartSpec,
  HeldEvidenceIdentity,
} from './evidence-charts';
const text = (value: string): TypedValue => ({ type: 'string', value });
const num = (value: number): TypedValue => ({ type: 'number', value });
const nil: TypedValue = { type: 'null', value: null };
const execution = {
  storeId: 'firestore',
  projectId: 'project',
  executionId: 'retained-run',
};
const scope = {
  storeId: 'firestore',
  spaceID: 'space',
  projectId: 'project',
  environment: 'demo',
};
const source = { id: 'shipping-working-copy', generation: 'g1' };
const identity: HeldEvidenceIdentity = {
  execution,
  scope,
  source,
  complete: true,
  hasMore: false,
};
const timeline: EvidenceChartSpec = {
  type: 'timeline',
  selectionId: 'events',
  timeline: {
    laneColumn: 'lane',
    eventColumn: 'event',
    sequenceColumn: 'seq',
    timeColumn: 'at',
    clockDomainColumn: 'clock',
    precisionColumn: 'precision',
    statusColumn: 'status',
    evidenceRefColumn: 'evidence',
  },
};
const heatmap: EvidenceChartSpec = {
  type: 'heatmap',
  selectionId: 'states',
  heatmap: {
    rowColumn: 'lane',
    columnColumn: 'event',
    statusColumn: 'status',
    evidenceRefColumn: 'evidence',
  },
};
const timing: EvidenceChartSpec = {
  type: 'timing-bars',
  selectionId: 'durations',
  timing: {
    rowKeyColumn: 'key',
    labelColumn: 'event',
    startTimeColumn: 'at',
    endTimeColumn: 'end',
    startClockDomainColumn: 'clock',
    endClockDomainColumn: 'clock',
    startPrecisionColumn: 'precision',
    endPrecisionColumn: 'precision',
    startEvidenceRefColumn: 'evidence',
    endEvidenceRefColumn: 'end_evidence',
    startIdentityColumn: 'start_id',
    endIdentityColumn: 'end_id',
  },
};
function fixture(): Result {
  const entries: Record<string, TypedValue> = {
    key: text('row-1'),
    lane: text('Order A'),
    event: text('Assignment'),
    seq: num(1),
    at: text('2018-05-20T10:05:00Z'),
    end: text('2018-05-20T10:05:02Z'),
    clock: text('fixture-clock'),
    precision: num(1000),
    status: text('pass'),
    evidence: nil,
    end_evidence: nil,
    start_id: text('observed-start'),
    end_id: text('observed-end'),
  };
  const recordset = {
    columns: Object.entries(entries).map(([name, v]) => ({
      name,
      type: v.type === 'null' ? 'string' : v.type,
    })),
    rows: [Object.values(entries)],
  };
  return {
    recordset,
    execution,
    truncated: false,
    limitations: [],
    bindingsApplied: [],
    provenance: {
      source: source.id,
      mode: 'live',
      observedAt: '2026-10-21T12:00:00Z',
      executionProfile: 'opaque-privileged',
    },
    rowEvidence: {
      version: 1,
      execution,
      recordsetFingerprint: createHash('sha256')
        .update(canonicalRecordsetJSON(recordset))
        .digest('hex'),
      scope,
      source,
      rowKeyColumn: 'key',
      rows: [
        {
          rowKey: text('row-1') as { type: 'string'; value: string },
          slots: {
            evidence: {
              state: 'available',
              refs: [{ kind: 'execution', execution }],
            },
            end_evidence: {
              state: 'available',
              refs: [{ kind: 'execution', execution }],
            },
          },
        },
      ],
    },
  };
}
function withCell(name: string, value: TypedValue): Result {
  const r = fixture();
  const rows = [
    r.recordset.rows[0].map((v, i) =>
      r.recordset.columns[i].name === name ? value : v,
    ),
  ];
  const recordset = { ...r.recordset, rows };
  return {
    ...r,
    recordset,
    rowEvidence: {
      ...metadata(r),
      recordsetFingerprint: createHash('sha256')
        .update(canonicalRecordsetJSON(recordset))
        .digest('hex'),
    },
  };
}
function metadata(r: Result) {
  if (!r.rowEvidence) throw new Error('Test requires evidence');
  return r.rowEvidence;
}
function selector(r: Result): RowEvidenceSelector {
  const e = metadata(r);
  return {
    execution: e.execution,
    scope: e.scope,
    source: e.source,
    recordsetFingerprint: e.recordsetFingerprint,
    rowKeyColumn: e.rowKeyColumn,
    rowKey: e.rows[0].rowKey,
    slotColumn: 'evidence',
  };
}

describe('published Core v0.63 fingerprint compatibility', () => {
  it('pins all seven fixture bytes from Core v0.63.0', () => {
    expect(fingerprints.cases).toHaveLength(7);
    expect(createHash('sha256').update(fingerprintJSON).digest('hex')).toBe(
      '78edaad4da898c8e019ab7e3dbb4a1d80d6156de1ce1922c9f7ebc32c123e376',
    );
  });
  it.each(fingerprints.cases)(
    '$name preserves actual canonical bytes and digest',
    async (c) => {
      const recordset = c.recordset as unknown as Result['recordset'];
      expect(canonicalRecordsetJSON(recordset)).toBe(c.canonicalJSON);
      expect(await recordsetFingerprint(recordset)).toBe(c.sha256);
      expect(createHash('sha256').update(c.canonicalJSON).digest('hex')).toBe(
        c.sha256,
      );
    },
  );
  it('does not silently admit malformed rows or nonfinite numbers', () => {
    expect(() =>
      canonicalRecordsetJSON({
        columns: [{ name: 'a', type: 'number' }],
        rows: [[]],
      }),
    ).toThrow();
    expect(() =>
      canonicalRecordsetJSON({
        columns: [{ name: 'a', type: 'number' }],
        rows: [[num(Infinity)]],
      }),
    ).toThrow();
  });
});
describe('exact held row evidence', () => {
  it('preserves ordinary Result decoding and NULL business evidence', async () => {
    expect(decodeResult(legacy)).not.toHaveProperty('rowEvidence');
    const r = await decodeEvidenceResultJSON(JSON.stringify(fixture()));
    expect(r.recordset.rows[0][9]).toEqual(nil);
    expect(decodeRowEvidence(r.rowEvidence, r)).toEqual(r.rowEvidence);
  });
  it('resolves detached refs only after digest verification and never creates missing evidence', async () => {
    const r = fixture();
    const s = selector(r);
    const selected = await resolveRowEvidence(r, s);
    if (!selected?.refs) throw new Error('Expected refs');
    expect(selected).not.toBe(metadata(r).rows[0].slots['evidence']);
    expect(selected.refs[0]).not.toBe(
      metadata(r).rows[0].slots['evidence'].refs?.[0],
    );
    expect(
      await resolveRowEvidence(r, { ...s, slotColumn: 'missing' }),
    ).toBeUndefined();
    expect(
      await resolveRowEvidence({ ...r, rowEvidence: undefined }, s),
    ).toBeUndefined();
    for (const changed of [
      { ...s, source: { ...source, generation: 'g2' } },
      { ...s, scope: { ...scope, spaceID: 'foreign' } },
      { ...s, execution: { ...execution, executionId: 'other' } },
      { ...s, recordsetFingerprint: 'wrong' },
    ])
      await expect(resolveRowEvidence(r, changed)).rejects.toThrow();
    const forged = {
      ...r,
      rowEvidence: { ...metadata(r), recordsetFingerprint: 'a'.repeat(64) },
    };
    expect(decodeResult(forged).rowEvidence).toBeDefined(); // structural only
    await expect(
      resolveRowEvidence(forged, {
        ...s,
        recordsetFingerprint: 'a'.repeat(64),
      }),
    ).rejects.toThrow(/fingerprint/);
    await expect(
      decodeEvidenceResultJSON(JSON.stringify(forged)),
    ).rejects.toThrow(/fingerprint/);
  });
  it.each([
    ['version', (r: Result) => ({ ...r.rowEvidence, version: 2 })],
    [
      'execution',
      (r: Result) => ({
        ...r.rowEvidence,
        execution: { ...execution, executionId: 'wrong' },
      }),
    ],
    [
      'scope',
      (r: Result) => ({
        ...r.rowEvidence,
        scope: { ...scope, projectId: 'wrong' },
      }),
    ],
    [
      'hosted space',
      (r: Result) => ({
        ...r.rowEvidence,
        scope: { ...scope, spaceID: undefined },
      }),
    ],
    [
      'fingerprint',
      (r: Result) => ({ ...r.rowEvidence, recordsetFingerprint: 'wrong' }),
    ],
    [
      'unknown field',
      (r: Result) => ({ ...r.rowEvidence, sql: 'SELECT secret' }),
    ],
    [
      'unknown row',
      (r: Result) => ({
        ...r.rowEvidence,
        rows: [{ ...metadata(r).rows[0], rowKey: text('other') }],
      }),
    ],
    [
      'duplicate row',
      (r: Result) => ({
        ...r.rowEvidence,
        rows: [metadata(r).rows[0], metadata(r).rows[0]],
      }),
    ],
    [
      'wrong key type',
      (r: Result) => ({
        ...r.rowEvidence,
        rows: [{ ...metadata(r).rows[0], rowKey: num(1) }],
      }),
    ],
    [
      'wrong slot',
      (r: Result) => ({
        ...r.rowEvidence,
        rows: [
          {
            rowKey: text('row-1'),
            slots: { unknown: { state: 'unavailable' } },
          },
        ],
      }),
    ],
    [
      'missing execution ref',
      (r: Result) => ({
        ...r.rowEvidence,
        rows: [
          {
            rowKey: text('row-1'),
            slots: { evidence: { state: 'available', refs: [] } },
          },
        ],
      }),
    ],
    [
      'unavailable refs',
      (r: Result) => ({
        ...r.rowEvidence,
        rows: [
          {
            rowKey: text('row-1'),
            slots: {
              evidence: {
                state: 'unavailable',
                refs: [{ kind: 'execution', execution }],
              },
            },
          },
        ],
      }),
    ],
    [
      'invalid ref',
      (r: Result) => ({
        ...r.rowEvidence,
        rows: [
          {
            rowKey: text('row-1'),
            slots: {
              evidence: {
                state: 'available',
                refs: [{ kind: 'url', id: 'https://example.test' }],
              },
            },
          },
        ],
      }),
    ],
  ] as const)('rejects malformed %s before presentation', (_name, change) => {
    const r = fixture();
    expect(() => decodeResult({ ...r, rowEvidence: change(r) })).toThrow();
  });
  it('rejects present null, duplicates in raw JSON and escaped duplicate names', async () => {
    expect(() => decodeResult({ ...fixture(), rowEvidence: null })).toThrow();
    const raw = JSON.stringify(fixture());
    for (const malformed of [
      raw.replace('"version":1', '"version":1,"version":1'),
      raw.replace('"version":1', '"version":1,"\\u0076ersion":1'),
      raw + '{}',
    ])
      await expect(decodeEvidenceResultJSON(malformed)).rejects.toThrow();
  });
  it('preserves typed integer keys beyond Number precision and distinguishes string keys', () => {
    const r = withCell('key', { type: 'integer', value: '9007199254740993' });
    const evidence = {
      ...metadata(r),
      rows: [
        {
          ...metadata(r).rows[0],
          rowKey: { type: 'integer' as const, value: '9007199254740993' },
        },
      ],
    };
    expect(decodeRowEvidence(evidence, r).rows[0].rowKey).toEqual({
      type: 'integer',
      value: '9007199254740993',
    });
    expect(() =>
      decodeRowEvidence(
        {
          ...evidence,
          rows: [{ ...evidence.rows[0], rowKey: text('9007199254740993') }],
        },
        r,
      ),
    ).toThrow();
  });
  it('validates closed structured ref arms and refuses unsafe numeric versions', () => {
    for (const ref of [
      { kind: 'project', project: { storeId: 's', projectId: 'p' } },
      {
        kind: 'query',
        artifact: {
          storeId: 's',
          projectId: 'p',
          id: 'q',
          folder: 'shipping/queries',
        },
      },
      { kind: 'compare', comparison: { left: execution, right: execution } },
      {
        kind: 'check-run',
        checkRun: {
          storeId: 's',
          projectId: 'p',
          environment: 'demo',
          checkId: 'c',
          checkVersion: 1,
          runId: 'run',
        },
      },
    ])
      expect(decodeEvidenceArtifactRef(ref)).toEqual(ref);
    for (const ref of [
      { kind: 'event', id: 'bad/path' },
      {
        kind: 'query',
        artifact: { storeId: 's', projectId: 'p', id: 'q', folder: '../x' },
      },
      { kind: 'execution', execution, id: 'wrong' },
      {
        kind: 'check-run',
        checkRun: {
          storeId: 's',
          projectId: 'p',
          environment: 'demo',
          checkId: 'c',
          checkVersion: 9007199254740992,
          runId: 'run',
        },
      },
    ])
      expect(() => decodeEvidenceArtifactRef(ref)).toThrow();
  });
});
describe('three prepared chart kinds from exact held values', () => {
  it('refuses unavailable cryptography and snapshots expected held context across digest await', async () => {
    const r = fixture();
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalRecordsetJSON(r.recordset)),
    );
    const expected = {
      ...identity,
      scope: { ...scope },
      source: { ...source },
    };
    let release: ((v: ArrayBuffer) => void) | undefined;
    const spy = vi
      .spyOn(globalThis.crypto.subtle, 'digest')
      .mockImplementationOnce(
        () =>
          new Promise<ArrayBuffer>((resolve) => {
            release = resolve;
          }),
      );
    try {
      const pending = prepareEvidenceChart(timeline, r, expected);
      expected.source.generation = 'changed-during-await';
      expected.scope.environment = 'changed';
      if (!release) throw new Error('Digest did not start');
      release(digest);
      const prepared = await pending;
      expect(prepared.source.generation).toBe('g1');
      expect(prepared.scope.environment).toBe('demo');
    } finally {
      spy.mockRestore();
    }
    const unavailable = vi
      .spyOn(globalThis.crypto.subtle, 'digest')
      .mockRejectedValueOnce(new Error('crypto unavailable'));
    try {
      await expect(prepareEvidenceChart(timeline, r, identity)).rejects.toThrow(
        'crypto unavailable',
      );
    } finally {
      unavailable.mockRestore();
    }
  });
  it('prepares point-only timeline and exact same-row selector', async () => {
    const prepared = await prepareEvidenceChart(timeline, fixture(), identity);
    expect(prepared.rows[0].time).toBe(Date.parse('2018-05-20T10:05:00Z'));
    expect(prepared.rows[0]).not.toHaveProperty('durationMs');
    expect(prepared.rows[0].inspections[0].selector).toEqual(
      selector(fixture()),
    );
    expect(
      (await prepareEvidenceChart(timeline, withCell('at', nil), identity))
        .rows[0].time,
    ).toBeUndefined();
  });
  it('prepares measured bars and preserves both endpoint observation identities', async () => {
    const row = (await prepareEvidenceChart(timing, fixture(), identity))
      .rows[0];
    expect(row.durationMs).toBe(2000);
    expect(row.precisionMs).toBe(1000);
    expect(
      row.inspections.map((i) => [i.observationId, i.selector.slotColumn]),
    ).toEqual([
      ['observed-start', 'evidence'],
      ['observed-end', 'end_evidence'],
    ]);
    expect(
      (
        await prepareEvidenceChart(
          timing,
          withCell('end', text('2018-05-20T10:05:00Z')),
          identity,
        )
      ).rows[0].durationMs,
    ).toBe(0);
  });
  it.each([
    ['at', nil],
    ['end', nil],
    ['end', text('2018-05-20T10:04:59Z')],
    ['end', text('2018-05-20T10:05:00.0001Z')],
    ['start_id', nil],
    ['end_id', text('observed-start')],
    ['precision', num(0)],
    ['clock', nil],
  ] as const)(
    'does not invent measured duration for %s',
    async (column, value) => {
      const row = (
        await prepareEvidenceChart(timing, withCell(column, value), identity)
      ).rows[0];
      expect(row.durationMs).toBeUndefined();
      expect(row.inspections).toEqual([]);
    },
  );
  it('keeps timing unavailable without both slots; heatmap unknown without evidence', async () => {
    const r = fixture();
    const missing = {
      ...r,
      rowEvidence: {
        ...metadata(r),
        rows: [
          {
            ...metadata(r).rows[0],
            slots: { evidence: metadata(r).rows[0].slots['evidence'] },
          },
        ],
      },
    };
    expect(
      (await prepareEvidenceChart(timing, missing, identity)).rows[0]
        .durationMs,
    ).toBeUndefined();
    expect(
      (
        await prepareEvidenceChart(
          heatmap,
          { ...r, rowEvidence: undefined },
          identity,
        )
      ).rows[0].status,
    ).toBe('unknown');
    expect(
      (await prepareEvidenceChart(heatmap, r, identity)).rows[0].status,
    ).toBe('pass');
  });
  it('rejects mismatched scope/generation/retention, partial pages, duplicate cells and sequence', async () => {
    for (const changed of [
      { ...identity, complete: false },
      { ...identity, hasMore: true },
      { ...identity, source: { ...source, generation: 'g2' } },
      { ...identity, scope: { ...scope, environment: 'other' } },
      { ...identity, execution: { ...execution, executionId: 'other' } },
    ])
      await expect(
        prepareEvidenceChart(timeline, fixture(), changed),
      ).rejects.toThrow();
    const r = fixture();
    const duplicated = {
      ...r,
      rowEvidence: undefined,
      recordset: {
        ...r.recordset,
        rows: [r.recordset.rows[0], r.recordset.rows[0]],
      },
    };
    await expect(
      prepareEvidenceChart(heatmap, duplicated, identity),
    ).rejects.toThrow(/Duplicate heatmap/);
    await expect(
      prepareEvidenceChart(timeline, duplicated, identity),
    ).rejects.toThrow(/Duplicate timeline/);
    await expect(
      prepareEvidenceChart(
        heatmap,
        withCell('status', text('green')),
        identity,
      ),
    ).rejects.toThrow();
    await expect(
      prepareEvidenceChart(timeline, withCell('event', num(3)), identity),
    ).rejects.toThrow(/type/);
    await expect(
      prepareEvidenceChart(
        timeline,
        {
          ...r,
          rowEvidence: { ...metadata(r), recordsetFingerprint: 'a'.repeat(64) },
        },
        identity,
      ),
    ).rejects.toThrow(/fingerprint/);
  });
  it('rejects mixed variants/unknown mappings and permits shared clock/precision', () => {
    expect(decodeEvidenceChartSpec(timing)).toEqual(timing);
    for (const spec of [
      { ...timing, timeline: {} },
      { ...timing, timing: { ...timing.timing, sql: 'select 1' } },
      { ...timeline, timeline: { ...timeline.timeline, eventColumn: 'lane' } },
      { ...timeline, valueColumn: null },
    ])
      expect(() => decodeEvidenceChartSpec(spec)).toThrow();
  });
});

describe('public integrity entry points cannot bypass Core structural validation', () => {
  const asResult = (value: unknown) => value as Result;
  const asRecordset = (value: unknown) => value as Result['recordset'];
  it('rejects unknown column types and malformed non-key cells before public hashing or matching-ref resolution', async () => {
    const r = fixture();
    for (const malformed of [
      {
        ...r.recordset,
        columns: r.recordset.columns.map((c, i) =>
          i === 1 ? { ...c, type: 'NOT_A_CORE_TYPE' } : c,
        ),
      },
      {
        ...r.recordset,
        columns: r.recordset.columns.map((c, i) =>
          i === 1 ? { ...c, name: '' } : c,
        ),
      },
      {
        ...r.recordset,
        rows: [
          r.recordset.rows[0].map((v, i) =>
            i === 1 ? { type: 'boolean', value: 'not boolean' } : v,
          ),
        ],
      },
      {
        ...r.recordset,
        rows: [
          r.recordset.rows[0].map((v, i) => (i === 1 ? { type: 'null' } : v)),
        ],
      },
      { ...r.recordset, rows: [r.recordset.rows[0].slice(1)] },
    ]) {
      // Compute the attacker's matching digest independently of public validation.
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(malformed))
        .digest('hex');
      const forged = asResult({
        ...r,
        recordset: malformed,
        rowEvidence: { ...metadata(r), recordsetFingerprint: fingerprint },
      });
      expect(() => canonicalRecordsetJSON(asRecordset(malformed))).toThrow();
      await expect(
        recordsetFingerprint(asRecordset(malformed)),
      ).rejects.toThrow();
      await expect(
        verifyRowEvidence(forged.rowEvidence, forged),
      ).rejects.toThrow();
      await expect(
        resolveRowEvidence(forged, {
          ...selector(r),
          recordsetFingerprint: fingerprint,
        }),
      ).rejects.toThrow();
    }
  });
  it.each([
    'provenance',
    'limitations',
    'bindingsApplied',
    'truncated',
    'recordset',
  ])(
    'requires full Result.%s even with a valid digest and even without metadata',
    async (field) => {
      const r = fixture();
      const malformed: Record<string, unknown> = { ...r };
      delete malformed[field];
      await expect(
        verifyRowEvidence(metadata(r), asResult(malformed)),
      ).rejects.toThrow();
      await expect(
        resolveRowEvidence(asResult(malformed), selector(r)),
      ).rejects.toThrow();
      delete malformed['rowEvidence'];
      await expect(
        resolveRowEvidence(asResult(malformed), selector(r)),
      ).rejects.toThrow();
    },
  );
  it('rejects invalid provenance, limitations, bindings and unretained execution identities through the same Result decoder', async () => {
    const r = fixture();
    for (const malformed of [
      { ...r, provenance: { ...r.provenance, source: '' } },
      { ...r, provenance: { ...r.provenance, observedAt: 'not a timestamp' } },
      {
        ...r,
        provenance: { ...r.provenance, observedAt: '2018-02-31T10:05:00Z' },
      },
      {
        ...r,
        provenance: { ...r.provenance, mode: 'snapshot', snapshotId: '' },
      },
      {
        ...r,
        limitations: [{ policy: '', rowsFiltered: false, hiddenColumns: [] }],
      },
      {
        ...r,
        bindingsApplied: [
          {
            parameterId: 'p',
            value: text('x'),
            origin: 'manual',
            originEvidence: 'server-default',
          },
        ],
      },
      {
        ...r,
        execution: { ...execution, executionId: 'bad/path' },
        rowEvidence: undefined,
      },
    ])
      await expect(
        resolveRowEvidence(asResult(malformed), selector(r)),
      ).rejects.toThrow();
  });
});

describe('Core v0.63 binding and early-calendar parity through public evidence APIs', () => {
  it.each(['selection', 'context'] as const)(
    'refuses noncanonical %s fact provenance despite matching recordset hash',
    async (origin) => {
      const r = fixture();
      for (const factId of [
        ' padded ',
        '\tfact',
        'fact\n',
        '\u0085fact',
        'fact\u00a0',
        '',
      ]) {
        const malformed = {
          ...r,
          bindingsApplied: [
            {
              parameterId: 'parameter',
              value: text('selected'),
              origin,
              originEvidence: 'client-reported' as const,
              factId,
            },
          ],
        };
        expect(() => decodeResult(malformed)).toThrow();
        await expect(
          verifyRowEvidence(metadata(r), malformed),
        ).rejects.toThrow();
        await expect(
          resolveRowEvidence(malformed, selector(r)),
        ).rejects.toThrow();
      }
      const canonical = {
        ...r,
        bindingsApplied: [
          {
            parameterId: 'parameter',
            value: text('selected'),
            origin,
            originEvidence: 'client-reported' as const,
            factId: 'fact-1',
          },
        ],
      };
      expect((await resolveRowEvidence(canonical, selector(r)))?.state).toBe(
        'available',
      );
    },
  );
  it.each([
    '0000-02-29',
    '0001-01-01',
    '0004-02-29',
    '0099-12-31',
    '0100-02-28',
    '1900-02-28',
    '2000-02-29',
  ])(
    'preserves Core-valid %s through canonical bytes/hash and available-ref resolution',
    async (value) => {
      const recordset = {
        columns: [{ name: 'date', type: 'date' }],
        rows: [[{ type: 'date' as const, value }]],
      };
      const canonical = JSON.stringify(recordset);
      expect(canonicalRecordsetJSON(recordset)).toBe(canonical);
      expect(await recordsetFingerprint(recordset)).toBe(
        createHash('sha256').update(canonical).digest('hex'),
      );
      const r = fixture();
      const actual = {
        ...r.recordset,
        columns: r.recordset.columns.map((c) =>
          c.name === 'event' ? { ...c, type: 'date' } : c,
        ),
        rows: [
          r.recordset.rows[0].map((v, i) =>
            r.recordset.columns[i].name === 'event'
              ? { type: 'date' as const, value }
              : v,
          ),
        ],
      };
      const withDate = {
        ...r,
        recordset: actual,
        rowEvidence: {
          ...metadata(r),
          recordsetFingerprint: createHash('sha256')
            .update(JSON.stringify(actual))
            .digest('hex'),
        },
      };
      expect(
        (
          await resolveRowEvidence(withDate, {
            ...selector(r),
            recordsetFingerprint: withDate.rowEvidence.recordsetFingerprint,
          })
        )?.state,
      ).toBe('available');
    },
  );
  it.each([
    '0000-02-30',
    '0001-02-29',
    '0099-02-29',
    '0100-02-29',
    '1900-02-29',
    '2001-02-29',
  ])(
    'still refuses invalid leap/calendar date %s before public hashing',
    async (value) => {
      const recordset = {
        columns: [{ name: 'date', type: 'date' }],
        rows: [[{ type: 'date' as const, value }]],
      };
      expect(() => canonicalRecordsetJSON(recordset)).toThrow();
      await expect(recordsetFingerprint(recordset)).rejects.toThrow();
    },
  );
});
