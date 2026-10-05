import { graphFixtureMetadataTransport } from './native-graph.spec-helper';
import { graphFixturePlan, graphFixtureTransport } from './native-graph.spec-helper';
import { afterEach, describe, expect, it, vi } from 'vitest';
import profile from './native-graph-profile.json';
import fixture from './native-graph-fixture.json';
import { BoundedRunBudget } from './bounded-run-budget';
import {
  assertFiniteGraphJoin,
  assertNativeGraphPlan,
  assertHistoricalNativeGraphPlan,
  graphStorageOverhead,
  executeFiniteGraphJoin,
  finiteGraphJoin,
  graphStableIdentity,
  NativeGraphExecution,
  NativeGraphLedger,
  nativeProjection,
  nativeGraphRunResponse,
  type NativeGraphPlan,
} from './native-graph-executor';
import { parseNativeGraphEnvelope, NATIVE_GRAPH_ORIGINAL_DECISION } from './native-graph-contract';
import type { BoundedRecord } from './bounded-federation';
import type { NativeStageId } from './native-graph-contract';
import { RUNTIME_PIN_HEADERS } from './runtime-read-pins';
import { JsonNumberToken } from './strict-json';

const budgets: BoundedRunBudget[] = [];
const budget = (): BoundedRunBudget => {
  const b = new BoundedRunBudget(5 * 1024 * 1024, 10000);
  budgets.push(b);
  return b;
};
afterEach(() => {
  for (const b of budgets.splice(0)) b.close();
});
const records = (rows: readonly Record<string, unknown>[]): BoundedRecord[] =>
  rows.map((data, i) => ({ key: String(i), data }));
const plan = graphFixturePlan;
const transport = graphFixtureTransport;
const sample = fixture.multiplicity;
describe('finite W1 native graph', () => {
  it('requires both current decision tuples and refuses old execution while retaining locally readable old plans', async () => {
    const current = plan(); expect(() => assertNativeGraphPlan(current)).not.toThrow();
    for (const missing of current.references.filter((ref) => [profile.decision.document.sha256, NATIVE_GRAPH_ORIGINAL_DECISION.sha256].includes(ref.sha256))) {
      const changed = { ...current, references: current.references.filter((ref) => ref !== missing) };
      expect(() => assertNativeGraphPlan(changed)).toThrow(/decision lineage/);
    }
    const { default: originalProfile } = await import('./native-graph-historical-profile.json');
    const old = { ...current, envelope: { ...current.envelope, graphs: [originalProfile] }, references: [NATIVE_GRAPH_ORIGINAL_DECISION] } as NativeGraphPlan;
    expect(() => assertHistoricalNativeGraphPlan(old)).not.toThrow();
    expect(() => assertNativeGraphPlan(old)).toThrow(/decision pin/);
    expect(graphStableIdentity(old)).not.toBe(graphStableIdentity(current));
    const forged = { ...old, references: current.references };
    expect(() => assertNativeGraphPlan(forged)).toThrow(/decision pin/);
  });
  it('counts exact row wrappers and keys with an independent UTF8 serialization oracle', () => {
    const primary = [[{ type: 'string', value: 'é🦊' }]], related = [{ id: 'locations', recordset: { columns: [], rows: Array.from({ length: 12 }, (_, i) => [{ type: 'string', value: `escaped\\${i}` }]) } }];
    const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    let extra = encoded(1);
    related.forEach((set) => set.recordset.rows.forEach((row, index) => { extra += encoded({ set: set.id, index, rows: row }) - encoded(row) + encoded([set.id, index]); }));
    expect(graphStorageOverhead({ recordset: { columns: [], rows: primary }, relatedRecordsets: related } as never)).toBe(extra);
  });
  it('holds old and new row/cache/storage/metadata copies until commit and never refunds candidate work on rollback', () => {
    const ledger = new NativeGraphLedger(budget(), 0, {}, 0), encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const old = { rows: ['é🦊'] }, oldTransfer = { rows: ['old'] }, next = { rows: ['next'] }, transfer = { rows: ['wire'] }, cache = { page: 'native-cache' };
    ledger.output(old, 1, 0); ledger.output(oldTransfer, 1, 0, 'transfer'); ledger.reserveOutputMetadata(110); ledger.reserveOutputStorage(22); ledger.commitOutput();
    ledger.retain('page', cache); ledger.reserve(2, 9);
    ledger.output(next, 1, 0); ledger.output(transfer, 1, 0, 'transfer'); ledger.reserveOutputMetadata(120); ledger.reserveOutputStorage(24);
    const expected = encoded(old) + encoded(oldTransfer) * 2 + 110 + 22 + encoded(cache) + encoded(next) + encoded(transfer) * 2 + 240 + 48;
    expect(() => ledger.assertBytes(5242880 - expected)).not.toThrow(); expect(() => ledger.assertBytes(5242880 - expected + 1)).toThrow(/output byte bound/);
    ledger.rollbackOutput();
    const retained = encoded(old) + encoded(oldTransfer) * 2 + 110 + 22 + encoded(cache);
    expect(() => ledger.assertBytes(5242880 - retained)).not.toThrow(); expect(ledger.candidates).toBe(9); expect(ledger.intermediate).toBe(2);
    ledger.reserveOutputMetadata(130); ledger.commitOutputMetadata();
    expect(() => ledger.assertBytes(5242880 - retained - 20)).not.toThrow(); expect(() => ledger.assertBytes(5242880 - retained - 19)).toThrow();
  });
  it('preserves P1 native types and precision, and never normalizes P2', () => {
    for (const raw of [true, '4369596', 0, -1, 1.5, Infinity])
      expect(
        nativeProjection('ror-positive-int-geonames-decimal/1', [raw]).key,
      ).toBeUndefined();
    expect(
      nativeProjection('ror-positive-int-geonames-decimal/1', [
        new JsonNumberToken('9007199254740992'),
      ]).status,
    ).toBe('unsupported-precision');
    expect(
      nativeProjection('ror-positive-int-geonames-decimal/1', [
        new JsonNumberToken('4369596'),
      ]).key,
    ).toBe('4369596');
    for (const [country, region, expected] of [
      ['MC', '00', 'MC.00'],
      ['VN', 'x84', 'VN.x84'],
      ['US', '01', 'US.01'],
      ['US', ' 01 ', 'US. 01 '],
    ])
      expect(
        nativeProjection('geonames-country-admin1/1', [country, region]).key,
      ).toBe(expected);
    expect(
      nativeProjection('geonames-country-admin1/1', ['US', '']).status,
    ).toBe('empty');
    expect(
      nativeProjection('geonames-country-admin1/1', ['us', '01']).status,
    ).toBe('invalid');
    expect(
      nativeProjection('geonames-country-admin1/1', ['US', 'A.B']).status,
    ).toBe('invalid');
  });
  it('executes pinned DALgo on native relations: two affiliations, two locations and38 aliases become4 and76 occurrences', async () => {
    const p = plan(),
      http = transport(p, sample);
    const execution = new NativeGraphExecution(
      p,
      records(sample.affiliations),
      budget(),
      http,
      'https://runtime.example', graphFixtureMetadataTransport,
    );
    const result = await execution.run();
    expect(result.affiliations).toHaveLength(2);
    expect(result.locations).toHaveLength(4);
    expect(result.aliases).toHaveLength(76);
    expect(result.ledger.intermediate).toBe(180);
    expect(result.ledger.candidates).toBe(48);
    expect(result.ledger.outputRows).toBe(82);
    expect(new Set(result.locations.map((l) => l.token)).size).toBe(4);
    expect(new Set(result.aliases.map((a) => a.token)).size).toBe(76);
    expect(http).toHaveBeenCalledTimes(6);
    expect(result.relatedRecordsets.map((r) => r.id)).toEqual([
      'locations',
      'aliases',
    ]);
  });
  it('fits1000 duplicate affiliation references without repeated downstream joins', async () => {
    const p = plan(false),
      input = fixture.ordinary;
    const affiliations = Array.from({ length: 1000 }, (_, i) => ({
      key: 'u' + i,
      data: { ror_id: 'https://ror.org/000025p04' },
    }));
    const execution = new NativeGraphExecution(
      p,
      affiliations,
      budget(),
      transport(p, input),
      'https://runtime.example', graphFixtureMetadataTransport,
    );
    const result = await execution.run();
    expect(result.affiliations).toHaveLength(1000);
    expect(result.locations).toHaveLength(1000);
    expect(result.aliases).toHaveLength(0);
    expect(result.ledger.intermediate).toBe(3011);
    expect(result.ledger.candidates).toBe(1004);
    expect(result.ledger.outputRows).toBe(2000);
    expect(
      nativeGraphRunResponse(
        execution,
        result,
        'thousand-fixture',
        'Explicit capacity fixture',
      ).totalRows,
    ).toBe(1000);
    execution.commitOutput();
  });
  it('retains invalid/null/empty affiliations without querying their values', async () => {
    const p = plan(false),
      http = transport(p, {});
    const execution = new NativeGraphExecution(
      p,
      records([{ ror_id: null }, { ror_id: '' }, { ror_id: 'wrong' }, {}]),
      budget(),
      http,
      'https://runtime.example', graphFixtureMetadataTransport,
    );
    const result = await execution.run();
    expect(result.affiliations.map((r) => r.status)).toEqual([
      'null',
      'empty',
      'invalid',
      'missing',
    ]);
    expect(http).not.toHaveBeenCalled();
  });
  it('keeps singleton partial reads unresolved and does not cascade a continuation', async () => {
    const p = plan(),
      http = transport(p, sample),
      execution = new NativeGraphExecution(
        p,
        records(sample.affiliations),
        budget(),
        http,
        'https://runtime.example', graphFixtureMetadataTransport,
      );
    const partial = await execution.run(1);
    execution.commitOutput();
    expect(partial.affiliations.every((r) => r.status === 'incomplete')).toBe(
      true,
    );
    expect(partial.locations).toHaveLength(0);
    expect(http).toHaveBeenCalledTimes(1);
    const finished = await execution.continueStage('organizations', {
      limit: 1,
      offset: 1,
    });
    expect(finished.affiliations.every((r) => r.status === 'matched')).toBe(
      true,
    );
    expect(http).toHaveBeenCalledTimes(2);
    expect(finished.locations).toHaveLength(0);
  });
  it('holds matched place/country while independently displaying missing admin1 and exact00', async () => {
    const input = structuredClone(sample);
    input.places[0].country_code = 'MC';
    input.places[0].admin1_code = '00';
    input.places[1].country_code = 'VN';
    input.places[1].admin1_code = 'x84';
    input.countries = [
      { iso: 'MC', country: 'Monaco' },
      { iso: 'VN', country: 'Vietnam' },
    ] as typeof input.countries;
    input.admin1 = [{ code: 'MC.00', name: 'Monaco' }] as typeof input.admin1;
    const p = plan(false),
      result = await new NativeGraphExecution(
        p,
        records(input.affiliations),
        budget(),
        transport(p, input),
        'https://runtime.example', graphFixtureMetadataTransport,
      ).run();
    expect(
      result.locations.filter((l) => l.admin1Status === 'matched'),
    ).toHaveLength(2);
    expect(
      result.locations.filter((l) => l.admin1Status === 'unmatched'),
    ).toHaveLength(2);
    expect(
      result.locations.every(
        (l) => l.placeStatus === 'matched' && l.countryStatus === 'matched',
      ),
    ).toBe(true);
  });
  it('classifies observed duplicate singleton keys as ambiguous and rejects duplicate child grains', async () => {
    const input = structuredClone(sample);
    input.places.push({ ...input.places[0] });
    const p = plan(false),
      result = await new NativeGraphExecution(
        p,
        records(input.affiliations),
        budget(),
        transport(p, input),
        'https://runtime.example', graphFixtureMetadataTransport,
      ).run();
    expect(
      result.locations.filter((l) => l.placeStatus === 'ambiguous'),
    ).toHaveLength(2);
    const duplicate = structuredClone(sample);
    duplicate.locations.push({ ...duplicate.locations[0] });
    await expect(
      new NativeGraphExecution(
        p,
        records(duplicate.affiliations),
        budget(),
        transport(p, duplicate),
        'https://runtime.example', graphFixtureMetadataTransport,
      ).run(),
    ).rejects.toThrow('Duplicate native child identity');
  });
  it('refuses changed runtime pins and unknown graph fields before accepting rows', async () => {
    const p = plan(),
      http = transport(p, sample);
    p.envelope.graphs[0].edges[0] = {
      ...p.envelope.graphs[0].edges[0],
      projection: 'arbitrary',
    } as never;
    expect(
      () =>
        new NativeGraphExecution(
          p,
          records(sample.affiliations),
          budget(),
          http,
          'https://runtime.example', graphFixtureMetadataTransport,
        ),
    ).toThrow();
    expect(http).not.toHaveBeenCalled();
    const fresh = plan(),
      bad = vi.fn<typeof fetch>(
        async () =>
          new Response('{"records":[]}', {
            headers: { 'OVDB-Provider-Revision': 'e'.repeat(40) },
          }),
      );
    await expect(
      new NativeGraphExecution(
        fresh,
        records(sample.affiliations),
        budget(),
        bad,
        'https://runtime.example', graphFixtureMetadataTransport,
      ).run(),
    ).rejects.toThrow('pins');
  });
  it('predebits repeated engine work with no refund and refuses unapproved join shapes', async () => {
    const b = budget(),
      ledger = new NativeGraphLedger(b, 0, {}),
      left = [{ token: 'l', lookup: 'x' }],
      right = [{ token: 'r', lookup: 'x' }];
    await executeFiniteGraphJoin(left, right, ledger);
    await executeFiniteGraphJoin(left, right, ledger);
    expect(ledger.candidates).toBe(2);
    expect(ledger.intermediate).toBe(2);
    const shape = finiteGraphJoin('left', 'right');
    shape.from.joins[0].hints = { algorithms: ['nestedLoop'] };
    expect(() => assertFiniteGraphJoin(shape)).toThrow('flat hash');
    ledger.reserve(0, 99998);
    await expect(executeFiniteGraphJoin(left, right, ledger)).rejects.toThrow(
      'allowance',
    );
    expect(ledger.candidates).toBe(100000);
  });
  it('charges zero candidates for unmatched left placeholders and blocks expired continuation without transport', async () => {
    const b = budget(),
      ledger = new NativeGraphLedger(b, 0, {});
    const result = await executeFiniteGraphJoin(
      [{ token: 'l', lookup: 'x' }],
      [],
      ledger,
    );
    expect(result).toEqual([{ parent: 'l', child: null }]);
    expect(ledger.candidates).toBe(0);
    expect(ledger.intermediate).toBe(1);
    const p = plan(false),
      http = transport(p, sample),
      execution = new NativeGraphExecution(
        p,
        records(sample.affiliations),
        b,
        http,
        'https://runtime.example', graphFixtureMetadataTransport,
      );
    await execution.run();
    const calls = http.mock.calls.length;
    execution.close();
    await expect(
      execution.continueStage('aliases', { limit: 10, offset: 0 }),
    ).rejects.toThrow();
    expect(http.mock.calls.length).toBe(calls);
  });
  it('stops child allocation at the shared cap while retaining all held affiliation parents', async () => {
    const p = plan(true),
      input = structuredClone(fixture.ordinary);
    input.aliases = Array.from({ length: 38 }, (_, i) => ({
      alternate_name_id: 'a' + i,
      geonameid: input.places[0].geonameid,
      name: 'alias' + i,
    })) as typeof input.aliases;
    const affiliations = Array.from({ length: 1000 }, (_, i) => ({
      key: 'u' + i,
      data: { ror_id: 'https://ror.org/000025p04' },
    }));
    const http = transport(p, input),
      execution = new NativeGraphExecution(
        p,
        affiliations,
        budget(),
        http,
        'https://runtime.example', graphFixtureMetadataTransport,
      );
    const stopped = await execution.run();
    expect(stopped.stopped).toContain('bound');
    expect(stopped.affiliations).toHaveLength(1000);
    expect(
      stopped.affiliations.every(
        (row) => row.status === 'matched' && row.locations === 'incomplete',
      ),
    ).toBe(true);
    expect(stopped.locations).toHaveLength(0);
    expect(stopped.aliases).toHaveLength(0);
    expect(stopped.ledger.intermediate).toBeLessThanOrEqual(5000);
    expect(stopped.stageActions).toEqual([]);
    const calls = http.mock.calls.length;
    await expect(
      execution.continueStage('aliases', { limit: 1, offset: 38 }),
    ).rejects.toThrow('unavailable');
    expect(http.mock.calls.length).toBe(calls);
  });
  it('retains a fractional numeric wire token as an invalid location instead of rounding it into a join key', async () => {
    const p = plan(false),
      ordinary = transport(p, fixture.ordinary);
    const http = vi.fn<typeof fetch>(async (url, init) => {
      const response = await ordinary(url, init),
        query = JSON.parse(String(init?.body));
      if (query.from.name !== 'locations') return response;
      const text = await response.text();
      return new Response(
        text.replace(/"geonames_id":\d+/, '"geonames_id":4369596.0000000001'),
        { headers: response.headers },
      );
    });
    const result = await new NativeGraphExecution(
      p,
      records([{ ror_id: 'https://ror.org/000025p04' }]),
      budget(),
      http,
      'https://runtime.example', graphFixtureMetadataTransport,
    ).run();
    expect(result.locations).toHaveLength(1);
    expect(result.locations[0].placeStatus).toBe('invalid');
    expect(result.relatedRecordsets[0].recordset.rows[0][4]).toEqual({
      type: 'decimal',
      value: '4369596.0000000001',
    });
    expect(result.edges['location-place'].invalid).toBe(1);
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('retains old output rows until an atomic commit, and rollback refunds no execution work', () => {
    const ledger = new NativeGraphLedger(budget(), 0, {});
    ledger.output({ rows: 'old' }, 3000, 0);
    ledger.commitOutput();
    expect(ledger.retainedOutput).toBe(3000);
    expect(() => ledger.output({ rows: 'too many' }, 2001, 0)).toThrow(
      'live output',
    );
    ledger.reserve(2, 3);
    ledger.output({ rows: 'new' }, 2000, 0);
    ledger.rollbackOutput();
    expect(ledger.retainedOutput).toBe(3000);
    expect(ledger.intermediate).toBe(2);
    expect(ledger.candidates).toBe(3);
    ledger.output({ rows: 'replacement' }, 2000, 0);
    ledger.commitOutput();
    expect(ledger.retainedOutput).toBe(2000);
  });
  it('preholds exact fallback metadata before source work and rejects page acceptance when its descriptor cannot fit', async () => {
    const p = plan(false),
      http = transport(p, sample);
    const execution = new NativeGraphExecution(
      p,
      records(sample.affiliations),
      budget(),
      http,
      'https://runtime.example', graphFixtureMetadataTransport,
    );
    expect(() =>
      execution.prepareOutputMetadata(() => 5 * 1024 * 1024),
    ).toThrow('byte bound');
    expect(http).not.toHaveBeenCalled();
    const bounded = new NativeGraphExecution(
      p,
      records(sample.affiliations),
      budget(),
      http,
      'https://runtime.example', graphFixtureMetadataTransport,
    );
    bounded.prepareOutputMetadata(
      (response) =>
        Object.keys(response.nativeGraph.coverage).length
          ? 5 * 1024 * 1024
          : 2048,
      'fixture',
      'Explicit fixture',
    );
    const stopped = await bounded.run();
    expect(stopped.affiliations).toHaveLength(2);
    expect(stopped.locations).toHaveLength(0);
    expect(stopped.coverage).toEqual({});
    expect(stopped.affiliations.every((r) => r.status === 'incomplete')).toBe(
      true,
    );
    expect(stopped.ledger.networkBytes).toBeGreaterThan(0);
    expect(http).toHaveBeenCalledTimes(1);
    nativeGraphRunResponse(bounded, stopped, 'fixture', 'Explicit fixture');
    bounded.commitOutput();
    expect(bounded.ledger.retainedOutput).toBe(2);
  });
  it('saved plan identity includes every graph/operator/stage/native/runtime pin and request option', () => {
    const p = plan();
    const identity = graphStableIdentity(p),
      copy = structuredClone(p);
    copy.stages.admin1.runtime.manifestSha256 = 'e'.repeat(64);
    expect(graphStableIdentity(copy)).not.toBe(identity);
    copy.stages.admin1.runtime.manifestSha256 =
      p.stages.admin1.runtime.manifestSha256;
    copy.aliases = false;
    expect(graphStableIdentity(copy)).not.toBe(identity);
  });
});

describe('fresh combined review closure and retained identity controls', () => {
  it('refuses missing canonical indexes and stage dependencies before ordinary I/O', () => {
    for (const missing of ['directory', 'models', 'meanings'] as const) {
      const changed = structuredClone(plan());
      delete (changed.canonical as Partial<NativeGraphPlan['canonical']>)[missing];
      const http = vi.fn();
      expect(() => new NativeGraphExecution(changed, records(sample.affiliations), budget(), http, 'https://runtime.example', graphFixtureMetadataTransport)).toThrow(/canonical indexes/);
      expect(http).not.toHaveBeenCalled();
    }
    const changed = plan();
    const missing = changed.stages.organizations.publisherManifest;
    const incomplete = { ...changed, references: changed.references.filter((ref) => graphStableIdentity(ref) !== graphStableIdentity(missing)) };
    expect(() => new NativeGraphExecution(incomplete, records(sample.affiliations), budget(), vi.fn(), 'https://runtime.example', graphFixtureMetadataTransport)).toThrow(/stage dependency/);
  });
  it('binds original attachment bytes and the entire inherited closure before any ordinary read', async () => {
    const original = plan(), core = original.references.find((ref) => ref.repository === 'https://github.com/meaninggraph/core');
    if (!core) throw new Error('The full fixture must include the inherited core dependency.');
    const wrongAttachment = { ...original.attachment, sha256: 'f'.repeat(64) };
    const cases = [
      { ...original, references: original.references.filter((ref) => ref !== core) },
      { ...original, references: [...original.references, { ...core, path: 'unrelated.json' }] },
      { ...original, attachment: wrongAttachment, references: original.references.map((ref) => graphStableIdentity(ref) === graphStableIdentity(original.attachment) ? wrongAttachment : ref) },
      { ...original, envelope: { ...original.envelope, legacy: undefined } },
    ];
    for (const changed of cases) {
      const http = vi.fn(), metadata = vi.fn(graphFixtureMetadataTransport);
      const execution = new NativeGraphExecution(changed as NativeGraphPlan, records(sample.affiliations), budget(), http, 'https://runtime.example', metadata);
      await expect(execution.run()).rejects.toThrow(/closure|checksum|attachment/);
      expect(http).not.toHaveBeenCalled();
      expect(metadata.mock.calls.length).toBeLessThanOrEqual(96);
    }
  });
  it('does not accept a serialized current saved plan as main-thread verification after a Worker boundary', async () => {
    const { verifyNativeGraphPlan, assertLocallyVerifiedNativeGraphPlan } = await import('./native-graph-executor');
    const original = plan(), clone = structuredClone(original);
    await verifyNativeGraphPlan(original, graphFixtureMetadataTransport, AbortSignal.timeout(10000));
    expect(() => assertLocallyVerifiedNativeGraphPlan(original)).not.toThrow();
    expect(() => assertLocallyVerifiedNativeGraphPlan(clone)).toThrow(/locally verified/);
    Object.freeze(clone);
    await verifyNativeGraphPlan(clone, graphFixtureMetadataTransport, AbortSignal.timeout(10000));
    expect(() => assertLocallyVerifiedNativeGraphPlan(clone)).not.toThrow();
    expect(Object.isFrozen(clone)).toBe(true);
    expect(Object.isFrozen(clone.stages.locations.nativeSnapshot)).toBe(true);
  });
  it.each([false, true])('binds receiving verification to an immutable candidate before metadata awaits (shallow frozen outer: %s)', async (shallowFrozen) => {
    const { verifyNativeGraphPlan, assertLocallyVerifiedNativeGraphPlan } = await import('./native-graph-executor');
    const candidate = plan(), initialIdentity = graphStableIdentity(candidate);
    if (shallowFrozen) Object.freeze(candidate);
    let reads = 0;
    const http: typeof fetch = async (url, init) => {
      // Yield like a real metadata fetch before the interleaved caller edit.
      await Promise.resolve();
      reads++;
      if (reads === 4) {
        expect(Reflect.set(candidate.canonical, 'directory', candidate.canonical.models)).toBe(false);
        expect(Reflect.set(candidate.attachment, 'sha256', 'f'.repeat(64))).toBe(false);
        expect(Reflect.set(candidate.references[0], 'sha256', 'f'.repeat(64))).toBe(false);
        expect(Reflect.set(candidate.stages.places.runtime, 'servingSha256', 'f'.repeat(64))).toBe(false);
        expect(Reflect.set(candidate.envelope.graphs[0].edges[0], 'projection', 'unknown')).toBe(false);
      }
      return graphFixtureMetadataTransport(url, init);
    };
    const pending = verifyNativeGraphPlan(candidate, http, AbortSignal.timeout(10000));
    // These assertions run before the first fetch can resume, not after marking.
    expect(Object.isFrozen(candidate.canonical)).toBe(true);
    expect(Object.isFrozen(candidate.stages.places.runtime)).toBe(true);
    await pending;
    expect(reads).toBe(49);
    expect(graphStableIdentity(candidate)).toBe(initialIdentity);
    expect(() => assertLocallyVerifiedNativeGraphPlan(candidate)).not.toThrow();
    const receivingClone = structuredClone(candidate);
    expect(() => assertLocallyVerifiedNativeGraphPlan(receivingClone)).toThrow(/locally verified/);
    await verifyNativeGraphPlan(receivingClone, graphFixtureMetadataTransport, AbortSignal.timeout(10000));
    expect(graphStableIdentity(receivingClone)).toBe(initialIdentity);
    expect(() => assertLocallyVerifiedNativeGraphPlan(receivingClone)).not.toThrow();
  });
  it('capacity fallback retains no full native payload identity strings and fits the unchanged byte allowance', async () => {
    const large = structuredClone(sample), p = plan();
    (large.locations[0] as Record<string, unknown>)['reviewPadding'] = 'x'.repeat(1400000);
    (large.places[0] as Record<string, unknown>)['reviewPadding'] = 'x'.repeat(1400000);
    const execution = new NativeGraphExecution(p, records(large.affiliations), budget(), transport(p, large), 'https://runtime.example', graphFixtureMetadataTransport);
    const result = await execution.run();
    const response = nativeGraphRunResponse(execution, result, 'review-capacity', 'review');
    expect(result.stopped).toBeTruthy(); expect(response.truncated).toBe(true);
    const internals = execution as unknown as {
      rows: Map<string, unknown>; derived: Map<string, { input: readonly unknown[]; rows: unknown; identity?: string }>;
      joins: Map<string, { left: readonly unknown[]; right: readonly unknown[]; rows: unknown; identity?: string }>;
      ledger: { retention: Map<string, number>; assertBytes(extra: number): void };
    };
    const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    let measured = 0;
    for (const [stage, rows] of internals.rows) { measured += encoded(rows); expect(internals.ledger.retention.get('cache:' + stage)).toBeGreaterThanOrEqual(encoded(rows)); }
    for (const [name, memo] of internals.derived) {
      expect(memo.identity).toBeUndefined(); expect(Object.isFrozen(memo.input)).toBe(true);
      measured += encoded(memo.rows); expect(internals.ledger.retention.get('derived:' + name)).toBeGreaterThanOrEqual(encoded(memo.rows));
      expect(() => (memo.input as unknown[]).push({})).toThrow();
    }
    for (const [name, memo] of internals.joins) {
      expect(memo.identity).toBeUndefined(); measured += encoded({ left: memo.left, right: memo.right, rows: memo.rows });
      if (!['invalid-primary', 'location-output'].includes(name)) expect(internals.ledger.retention.get('join:' + name)).toBeGreaterThanOrEqual(encoded(memo));
    }
    expect(measured).toBeLessThan(5242880); expect(() => internals.ledger.assertBytes(0)).not.toThrow();
    const spent = { network: execution.budget.bytes, candidates: execution.ledger.candidates, intermediate: execution.ledger.intermediate };
    execution.rollbackOutput();
    expect({ network: execution.budget.bytes, candidates: execution.ledger.candidates, intermediate: execution.ledger.intermediate }).toEqual(spent);
    expect(() => internals.ledger.assertBytes(0)).not.toThrow();
  });
});
