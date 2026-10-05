import { graphFixtureMetadataTransport } from './native-graph.spec-helper';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './native-graph-fixture.json';
import {
  graphFixturePlan,
  graphFixtureTransport,
} from './native-graph.spec-helper';
import { BoundedRunBudget } from './bounded-run-budget';
import {
  NativeGraphExecution,
  nativeGraphRunResponse,
  nativeProjection,
  assertNativeGraphPlan,
} from './native-graph-executor';
import { classifyP1Token } from './p1-wire-evidence';

const budgets: BoundedRunBudget[] = [];
afterEach(() => budgets.splice(0).forEach((b) => b.close()));
async function executeReference(raw: string | undefined, mixed = false) {
  const plan = graphFixturePlan(false),
    budget = new BoundedRunBudget(5 * 1024 * 1024, 10000);
  budgets.push(budget);
  const ordinary = graphFixtureTransport(plan, fixture.ordinary);
  const http = vi.fn<typeof fetch>(async (url, init) => {
    const response = await ordinary(url, init);
    const q = JSON.parse(String(init?.body));
    if (q.from.name !== 'locations') return response;
    const reference = raw === undefined ? '' : ',"geonames_id":' + raw;
    const rows = [
      '{"key":"bad","data":{"organization_id":"https://ror.org/000025p04","ordinal":0' +
        reference +
        '}}',
    ];
    if (mixed)
      rows.push(
        '{"key":"good","data":{"organization_id":"https://ror.org/000025p04","ordinal":1,"geonames_id":1609350}}',
      );
    return new Response('{"records":[' + rows.join(',') + ']}', {
      headers: response.headers,
    });
  });
  const execution = new NativeGraphExecution(
    plan,
    [{ key: 'affiliation', data: { ror_id: 'https://ror.org/000025p04' } }],
    budget,
    http,
    'https://runtime.example', graphFixtureMetadataTransport,
  );
  const result = await execution.run();
  return { result, http, execution };
}
describe('P1 actual strict ordinary-page wire boundary (synthetic pinned mounts, no admission)', () => {
  const invalid: readonly (readonly [string | undefined, string, string])[] = [
    ['1.0', 'invalid', 'representation-ambiguous'],
    ['1e0', 'invalid', 'representation-ambiguous'],
    ['1e3', 'invalid', 'representation-ambiguous'],
    ['10e-1', 'invalid', 'representation-ambiguous'],
    ['1E+03', 'invalid', 'representation-ambiguous'],
    ['1e0003', 'invalid', 'representation-ambiguous'],
    ['9007199254740991.0', 'invalid', 'representation-ambiguous'],
    ['9007199254740992', 'unsupported-precision', 'safe range'],
    ['9007199254740993', 'unsupported-precision', 'safe range'],
    ['9.007199254740992e15', 'unsupported-precision', 'safe range'],
    ['9007199254740992.0', 'unsupported-precision', 'safe range'],
    ['1.5', 'invalid', 'fractional'],
    ['1.0000000000000001', 'invalid', 'fractional'],
    ['9007199254740990.5', 'invalid', 'fractional'],
    ['1e-400', 'invalid', 'fractional'],
    ['-0', 'invalid', 'nonpositive'],
    ['0', 'invalid', 'nonpositive'],
    ['-1', 'invalid', 'nonpositive'],
    ['-1.0', 'invalid', 'nonpositive'],
    ['1e400', 'unsupported-precision', 'safe range'],
    ['-1e400', 'invalid', 'nonpositive'],
    ['0e400', 'invalid', 'nonpositive'],
    ['"1"', 'invalid', 'native-type'],
    ['true', 'invalid', 'native-type'],
    ['false', 'invalid', 'native-type'],
    ['{}', 'invalid', 'native-type'],
    ['[]', 'invalid', 'native-type'],
    ['{"nested":[-0,1e3,9007199254740993]}', 'invalid', 'native-type'],
    ['""', 'empty', 'empty-reference'],
    ['null', 'null', 'null-reference'],
    [undefined, 'missing', 'missing-field'],
  ];
  it.each(invalid)(
    'retains %s exactly as a local %s outcome without downstream I/O',
    async (raw, status, reason) => {
      const { result, http, execution } = await executeReference(raw);
      expect(result.affiliations).toHaveLength(1);
      expect(result.locations).toHaveLength(1);
      const location = result.locations[0];
      expect(location.placeStatus).toBe(status);
      expect(location.referenceEvidence.reason).toContain(reason);
      expect(location.referenceEvidence.token).toBe(raw ?? 'missing-field');
      expect(location.referenceEvidence.truncated).toBe(false);
      expect(location.placeKey).toBeUndefined();
      expect(http).toHaveBeenCalledTimes(2);
      const response = nativeGraphRunResponse(
        execution,
        result,
        'wire-fixture',
        'Synthetic reference control',
      );
      const transfer = structuredClone(JSON.parse(JSON.stringify(response)));
      expect(transfer.relatedRecordsets[0].recordset.rows[0][14].value).toBe(
        raw ?? 'missing-field',
      );
      expect(
        transfer.relatedRecordsets[0].recordset.rows[0][15].value,
      ).toContain(reason);
    },
  );
  it.each(['1', '1000', '9007199254740991'])(
    'projects canonical token %s only in the controlled native-provenance fixture',
    async (raw) => {
      const { result, http } = await executeReference(raw);
      expect(result.locations[0].placeKey).toBe(raw);
      expect(result.locations[0].referenceEvidence.token).toBe(raw);
      expect(
        http.mock.calls.some(([, init]) =>
          JSON.parse(String(init?.body)).where.right.values.includes(raw),
        ),
      ).toBe(true);
    },
  );
  it('keeps a valid sibling while refusing the ambiguous reference and preserves native order', async () => {
    const { result, http } = await executeReference('1e3', true);
    expect(result.locations.map((l) => l.placeStatus)).toEqual([
      'invalid',
      'matched',
    ]);
    expect(result.locations.map((l) => l.referenceEvidence.token)).toEqual([
      '1e3',
      '1609350',
    ]);
    const requested = http.mock.calls.flatMap(([, init]) => {
      const q = JSON.parse(String(init?.body));
      return q.from.name === 'allCountries' ? q.where.right.values : [];
    });
    expect(requested).not.toContain('1000');
  });
  it('classifies long exponents without large-integer allocation and never queries them', async () => {
    const token = '1e' + '9'.repeat(4100);
    const { result, http, execution } = await executeReference(token);
    expect(result.locations[0].placeStatus).toBe('unsupported-precision');
    expect(result.locations[0].referenceEvidence.truncated).toBe(false);
    expect(result.locations[0].referenceEvidence.token).toBe(token);
    expect(
      nativeGraphRunResponse(
        execution,
        result,
        'long-fixture',
        'Bounded evidence',
      ).truncated,
    ).toBe(false);
    expect(http).toHaveBeenCalledTimes(2);
    expect(classifyP1Token('1e99999999999999999999').status).toBe(
      'unsupported-precision',
    );
    expect(classifyP1Token('1e-99999999999999999999').status).toBe('invalid');
  });
  it.each(['01', '+1', 'NaN', 'Infinity', '{"x":1,"x":2}'])(
    'refuses malformed or ambiguous response %s rather than retaining a fictitious location',
    async (raw) => {
      await expect(executeReference(raw)).rejects.toThrow();
    },
  );
  it('does not reconstruct missing wire evidence from an already parsed JavaScript integer', () => {
    expect(
      nativeProjection('ror-positive-int-geonames-decimal/1', [1]),
    ).toMatchObject({
      status: 'invalid',
      reason: 'missing exact wire evidence',
    });
  });
  it('validates historical plan shape without transport and refuses a mutated pin association', () => {
    const p = graphFixturePlan();
    expect(assertNativeGraphPlan(p).id).toBe('w1-ror-geonames-context/1');
    p.stages.locations.runtime.sourceSha256 = 'f'.repeat(64);
    expect(() => assertNativeGraphPlan(p)).toThrow();
  });
});
