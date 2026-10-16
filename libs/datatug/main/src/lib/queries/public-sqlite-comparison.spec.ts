import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PUBLIC_CHINOOK_COMPARISON_TARGETS,
  PublicSqliteComparisonSession,
  admitPublicSqliteComparisonFixtures,
  compareSessionObservations,
  type ComparisonContextSnapshot,
  type ComparisonWorkerObservation,
  type ComparisonSideObservation,
  type RecordsetComparerModule,
} from './public-sqlite-comparison';
import { readComparisonFixture, executePinnedSql } from './public-sqlite-query.worker';

import { PUBLIC_CHINOOK_BUNDLED_CANDIDATE, PUBLIC_CHINOOK_BUNDLED_FIXTURE } from './public-sqlite-source-identity';

const context: ComparisonContextSnapshot = {
  projectRef: 'github.com/datatug/datatug-demo-project:main',
  pageMemoryScope: 'public-github:github.com/datatug/datatug-demo-project:main',
  accessClassification: 'public',
  agentSecurityContextId: 'sctx-42',
  accessGeneration: 3,
  draftRevision: 9,
  authoredSourceFingerprint: 'source-v9',
  relationshipFingerprint: 'invoice-customer-v1',
  typedBindingsFingerprint: 'CustomerId=integer:1',
};

function observation(
  targetIndex: number,
  executionId: string,
): ComparisonWorkerObservation {
  const target = PUBLIC_CHINOOK_COMPARISON_TARGETS[targetIndex];
  if (!target) throw new Error('Expected a pinned target.');
  return {
    kind: 'browser-session',
    targetId: target.id,
    fixtureSha256: target.sha256,
    schemaSha256: target.schemaSha256,
    schemaFingerprint: 'verified-invoice-customer-profile',
    columns: Object.freeze([
      { name: 'InvoiceId', type: 'integer' },
      { name: 'InvoiceDate', type: 'string' },
    ]),
    executionId,
    observedAt: '2026-10-11T12:00:00.000Z',
    rowCount: 1,
    rows: [[1001, '2026-01-02']],
    resultComplete: true,
  };
}

function completeComparisonPair() {
  const session = new PublicSqliteComparisonSession();
  const initial = session.begin(context);
  const baselineToken = session.startSide('chinook-baseline');
  const candidateToken = session.startSide('chinook-candidate');
  session.completeSide(baselineToken, observation(0, 'baseline'));
  session.completeSide(candidateToken, observation(1, 'candidate'));
  const snapshot = session.snapshot();
  const baseline = snapshot?.sides[0]?.observation;
  const candidate = snapshot?.sides[1]?.observation;
  if (!baseline || !candidate) throw new Error('Expected a complete session pair.');
  return { initial, baseline, candidate };
}

function loadCoreResponse(columns: readonly { name: string; type: string }[]) {
  const response = JSON.stringify({
    abi: 'recordsetcompare/1',
    ok: true,
    diff: {
      columns,
      key: ['InvoiceId'],
      added: [],
      removed: [],
      changed: [],
      summary: { added: 0, removed: 0, changed: 0, unchanged: 1, columnsOnlyOnOneSide: [] },
      policyLimited: false,
      truncated: false,
    },
  });
  return vi.fn(async () => ({
    RECORDSET_COMPARE_ABI: 'recordsetcompare/1',
    createRecordsetComparer: () => ({ compareJSON: async () => response }),
  } as unknown as RecordsetComparerModule));
}

describe('public SQLite comparison admission', () => {
  it('admits exactly the reviewed baseline and synthetic candidate descriptors', () => {
    expect(
      admitPublicSqliteComparisonFixtures({
        comparisonFixtures: PUBLIC_CHINOOK_COMPARISON_TARGETS,
      }),
    ).toEqual(PUBLIC_CHINOOK_COMPARISON_TARGETS);
    expect(() =>
      admitPublicSqliteComparisonFixtures({
        comparisonFixtures: [PUBLIC_CHINOOK_COMPARISON_TARGETS[0]],
      }),
    ).toThrow();
    expect(() =>
      admitPublicSqliteComparisonFixtures({
        comparisonFixtures: [
          PUBLIC_CHINOOK_COMPARISON_TARGETS[0],
          {
            ...PUBLIC_CHINOOK_COMPARISON_TARGETS[1],
            url: 'https://attacker.example/fixture.sqlite',
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      admitPublicSqliteComparisonFixtures({
        comparisonFixtures: [
          PUBLIC_CHINOOK_COMPARISON_TARGETS[0],
          PUBLIC_CHINOOK_COMPARISON_TARGETS[1],
          PUBLIC_CHINOOK_COMPARISON_TARGETS[1],
        ],
      }),
    ).toThrow();
  });

  it('downloads the exact bundled baseline and candidate and preserves their real SQL differences', async () => {
    await initSqlJs();
    const mirrors = [
      PUBLIC_CHINOOK_BUNDLED_FIXTURE,
      PUBLIC_CHINOOK_BUNDLED_CANDIDATE,
    ];
    const fetchMock = vi.fn(async (url: string) => {
      const mirror = mirrors.find((entry) => entry.url === url);
      if (!mirror) throw new Error('Unexpected fixture URL');
      const bytes = readFileSync(
        resolve(process.cwd(), 'apps/datatug-app/src', mirror.url.slice(1)),
      );
      return new Response(bytes, {
        headers: { 'content-length': String(bytes.length) },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const results = [];
      for (const target of PUBLIC_CHINOOK_COMPARISON_TARGETS) {
        const fixture = await readComparisonFixture(target);
        results.push(
          await executePinnedSql(
            'SELECT InvoiceId, InvoiceDate FROM Invoice WHERE CustomerId = 1 ORDER BY InvoiceId LIMIT 100',
            fixture,
          ),
        );
      }
      expect(results[0]?.rows.map((row) => row[0])).toEqual([
        98, 121, 143, 195, 316, 327, 382,
      ]);
      expect(results[1]?.rows.map((row) => row[0])).toEqual([
        97, 98, 143, 195, 316, 327, 382,
      ]);
      expect(results[0]?.rows[0]?.[1]).toBe('2022-03-11 00:00:00');
      expect(results[1]?.rows[1]?.[1]).toBe('2022-03-12 00:00:00');
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(
        mirrors.map((mirror) => mirror.url),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses changed target identity before fetching and bounds streamed bytes', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const target = PUBLIC_CHINOOK_COMPARISON_TARGETS[1];
      if (!target) throw new Error('Expected a candidate fixture pin.');
      await expect(
        readComparisonFixture({ ...target, url: 'https://other.example/file' }),
      ).rejects.toThrow('differs from its browser pin');
      expect(fetchMock).not.toHaveBeenCalled();

      await expect(readComparisonFixture(target)).rejects.toThrow(
        'size differs from its pin',
      );
      expect(fetchMock).toHaveBeenCalledWith(
        PUBLIC_CHINOOK_BUNDLED_CANDIDATE.url,
        expect.objectContaining({
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('public SQLite comparison session', () => {
  it('keeps sides independent and rejects stale attempts after retry', () => {
    const session = new PublicSqliteComparisonSession();
    session.begin(context);
    const baseline = session.startSide('chinook-baseline');
    const candidate = session.startSide('chinook-candidate');
    expect(session.completeSide(baseline, observation(0, 'baseline-1'))).toBe(true);
    expect(session.snapshot()?.sides.map((side) => side.status)).toEqual([
      'complete',
      'running',
    ]);
    expect(session.failSide(candidate, 'network failure')).toBe(true);
    const retry = session.startSide('chinook-candidate');
    expect(session.completeSide(candidate, observation(1, 'late-candidate'))).toBe(
      false,
    );
    expect(session.completeSide(retry, observation(1, 'candidate-2'))).toBe(true);
    expect(session.snapshot()?.sides.map((side) => side.status)).toEqual([
      'complete',
      'complete',
    ]);
  });

  it('aborts both workers on context invalidation and rejects late commits', () => {
    const session = new PublicSqliteComparisonSession();
    session.begin(context);
    const baseline = session.startSide('chinook-baseline');
    const candidate = session.startSide('chinook-candidate');
    session.invalidate('principal changed');
    expect(baseline.signal.aborted).toBe(true);
    expect(candidate.signal.aborted).toBe(true);
    expect(session.completeSide(baseline, observation(0, 'late'))).toBe(false);
    expect(session.snapshot()).toMatchObject({
      invalidated: true,
      invalidationReason: 'principal changed',
    });
  });

  it('requires complete target-bound observations with exact row counts', () => {
    const session = new PublicSqliteComparisonSession();
    session.begin(context);
    const token = session.startSide('chinook-baseline');
    expect(
      session.completeSide(token, {
        ...observation(0, 'bad-count'),
        rowCount: 2,
      }),
    ).toBe(false);
    expect(session.snapshot()?.sides[0]?.status).toBe('failed');
  });

  it('rejects duplicate keys and unsupported numeric projections', () => {
    const session = new PublicSqliteComparisonSession();
    session.begin(context);
    const token = session.startSide('chinook-baseline');
    expect(
      session.completeSide(token, {
        ...observation(0, 'duplicate-keys'),
        rows: [[1001, 'first'], [1001, 'second']],
        rowCount: 2,
      }),
    ).toBe(false);
    const retry = session.startSide('chinook-baseline');
    expect(
      session.completeSide(retry, {
        ...observation(0, 'unsafe-cell'),
        rows: [[1002, 1.25]],
      }),
    ).toBe(false);
  });

  it.each([
    ['draft revision', (side: ComparisonSideObservation) => ({ ...side, draftRevision: side.draftRevision + 1 })],
    ['typed binding', (side: ComparisonSideObservation) => ({ ...side, typedBindingsFingerprint: 'CustomerId=integer:2' })],
    ['page-memory scope', (side: ComparisonSideObservation) => ({ ...side, pageMemoryScope: 'public-github:other-project' })],
    ['access classification', (side: ComparisonSideObservation) => ({
      ...side,
      accessClassification: 'private',
    } as unknown as ComparisonSideObservation)],
    ['agent security context', (side: ComparisonSideObservation) => ({
      ...side,
      agentSecurityContextId: 'other-context',
    })],
    ['fixture digest', (side: ComparisonSideObservation) => ({ ...side, fixtureSha256: 'f'.repeat(64) })],
    ['schema digest', (side: ComparisonSideObservation) => ({ ...side, schemaSha256: 'e'.repeat(64) })],
  ] as const)(
    'refuses a mismatched %s pair before loading Core',
    async (_label, mutateCandidate) => {
      const session = new PublicSqliteComparisonSession();
      const initial = session.begin(context);
      const baselineToken = session.startSide('chinook-baseline');
      const candidateToken = session.startSide('chinook-candidate');
      expect(session.completeSide(baselineToken, observation(0, 'baseline'))).toBe(true);
      expect(session.completeSide(candidateToken, observation(1, 'candidate'))).toBe(true);
      const paired = session.snapshot();
      const baseline = paired?.sides[0]?.observation;
      const candidate = paired?.sides[1]?.observation;
      if (!baseline || !candidate) throw new Error('Expected a complete session pair.');
      const loadCore = vi.fn<(_url: string) => Promise<RecordsetComparerModule>>();

      await expect(compareSessionObservations(
        baseline,
        mutateCandidate(candidate),
        initial.context,
        initial.generation,
        { wasmSHA256: 'a'.repeat(64), wasmBytes: 1024 },
        undefined,
        loadCore,
      )).rejects.toThrow();
      expect(loadCore).not.toHaveBeenCalled();
    },
  );

  it('accepts the released Core schema in its sorted column order while preserving the exact visible field set', async () => {
    const { initial, baseline, candidate } = completeComparisonPair();
    const loadCore = loadCoreResponse([
      { name: 'InvoiceDate', type: 'string' },
      { name: 'InvoiceId', type: 'integer' },
    ]);
    const result = await compareSessionObservations(
      baseline,
      candidate,
      initial.context,
      initial.generation,
      { wasmSHA256: 'a'.repeat(64), wasmBytes: 1024 },
      undefined,
      loadCore,
    );
    expect(result.diff.columns).toEqual([
      { name: 'InvoiceDate', type: 'string' },
      { name: 'InvoiceId', type: 'integer' },
    ]);
  });

  it.each([
    ['missing column', [{ name: 'InvoiceId', type: 'integer' }]],
    ['extra column', [
      { name: 'InvoiceDate', type: 'string' },
      { name: 'InvoiceId', type: 'integer' },
      { name: 'Unexpected', type: 'string' },
    ]],
    ['duplicate column', [
      { name: 'InvoiceDate', type: 'string' },
      { name: 'InvoiceDate', type: 'string' },
    ]],
    ['changed type', [
      { name: 'InvoiceDate', type: 'date' },
      { name: 'InvoiceId', type: 'integer' },
    ]],
  ] as const)('rejects Core output with a %s', async (_label, columns) => {
    const { initial, baseline, candidate } = completeComparisonPair();
    await expect(compareSessionObservations(
      baseline,
      candidate,
      initial.context,
      initial.generation,
      { wasmSHA256: 'a'.repeat(64), wasmBytes: 1024 },
      undefined,
      loadCoreResponse(columns),
    )).rejects.toThrow('shared visible schema');
  });

  it('passes cancellation through Core and rejects a result that arrives after abort', async () => {
    const session = new PublicSqliteComparisonSession();
    const initial = session.begin(context);
    const baselineToken = session.startSide('chinook-baseline');
    const candidateToken = session.startSide('chinook-candidate');
    expect(session.completeSide(baselineToken, observation(0, 'baseline'))).toBe(true);
    expect(session.completeSide(candidateToken, observation(1, 'candidate'))).toBe(true);
    const paired = session.snapshot();
    const baseline = paired?.sides[0]?.observation;
    const candidate = paired?.sides[1]?.observation;
    if (!baseline || !candidate) throw new Error('Expected a complete session pair.');
    let finishCore!: (response: string) => void;
    const coreCall = vi.fn((_input: string, options?: { signal?: AbortSignal }) => {
      expect(options?.signal).toBeDefined();
      return new Promise<string>((resolve) => { finishCore = resolve; });
    });
    const loadCore = vi.fn(async () => ({
      RECORDSET_COMPARE_ABI: 'recordsetcompare/1',
      createRecordsetComparer: () => ({ compareJSON: coreCall }),
    } as unknown as RecordsetComparerModule));
    const controller = new AbortController();
    const comparing = compareSessionObservations(
      baseline,
      candidate,
      initial.context,
      initial.generation,
      { wasmSHA256: 'a'.repeat(64), wasmBytes: 1024 },
      controller.signal,
      loadCore,
    );
    await vi.waitFor(() => expect(coreCall).toHaveBeenCalledOnce());
    expect(coreCall.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    controller.abort();
    finishCore(JSON.stringify({
      abi: 'recordsetcompare/1',
      ok: true,
      diff: {
        columns: [{ name: 'InvoiceId', type: 'integer' }, { name: 'InvoiceDate', type: 'string' }],
        key: ['InvoiceId'], added: [], removed: [], changed: [],
        summary: { added: 0, removed: 0, changed: 0, unchanged: 1, columnsOnlyOnOneSide: [] },
        policyLimited: false, truncated: false,
      },
    }));
    await expect(comparing).rejects.toMatchObject({ name: 'AbortError' });
  });
});
