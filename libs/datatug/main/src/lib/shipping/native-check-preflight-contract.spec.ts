import fixture from './testdata/native-check-applicable.go.json';
import inputFixture from './testdata/native-check-input-values.core070.go.json';
import httpFixture from './testdata/native-check-applicable.http.go.json';
import {
  decodeNativeApplicable,
  decodeNativeCheckInput,
} from './native-check-preflight-contract';

// Verbatim Go facade/real-DAL fixture from Backend native semantic preflight tests.
// SHA256 9359effc8f53ad00894b3b65f4d9f880f81a31b8d59989ddad4fdf3bc7b44f9b.
// This is source/transport evidence, not a browser or signed journey receipt.
const sample = () => structuredClone(fixture.response);
describe('native Core binding preflight wire', () => {
  it('accepts the actual Go response without converting readiness into outcome or Run capability', () => {
    const decoded = decodeNativeApplicable(sample());
    expect(decoded).toEqual(fixture.response);
    expect(decoded.checks.map((c) => c.title)).toContain('Request received');
    expect(
      decoded.checks.find((c) => c.id === 'preflight-row-deferred')?.ready,
    ).toBe(false);
    expect(
      decoded.checks.find((c) => c.id === 'shipping-request-received')
        ?.bindings,
    ).toEqual({ order_id: { type: 'integer', value: '11045' } });
    expect(decoded.queries).toEqual(fixture.response.queries);
  });
  it('accepts verbatim actual registered HTTP response bytes as the same frozen wire', () => {
    // Real /semantic/applicable response from TestShippingNativeContextActualHTTPAuthoringAndRestart.
    // SHA256 3f773862e0cee7636715a161f79c86c174c200312a72cf81a06ea94281451ac3.
    expect(decodeNativeApplicable(httpFixture)).toEqual(httpFixture);
  });
  it('accepts a child Check diagnostic rather than assuming it is the root', () => {
    const value = sample();
    value.checks[0].preflight.checkId = 'child-check';
    Object.assign(value.checks[0].preflight, { stepId: 'child-step' });
    expect(decodeNativeApplicable(value).checks[0].preflight.checkId).toBe(
      'child-check',
    );
  });
  it('rejects missing or unknown fields and malformed or contradictory proof', () => {
    const invalid: unknown[] = [];
    for (const field of Object.keys(sample().checks[0])) {
      const value = sample() as unknown as {
        checks: Record<string, unknown>[];
      };
      delete value.checks[0][field];
      invalid.push(value);
    }
    const alterations: Record<string, unknown>[] = [
      { title: '' },
      { title: '   ' },
      { title: 'é'.repeat(2049) },
      { title: 4 },
      { id: '../check' },
      { revision: '01' },
      { revision: '0' },
      { revision: 1 },
      { revision: '9223372036854775808' },
      { definitionDigest: 'A'.repeat(64) },
      { ready: true },
      { ready: 'false' },
      { run: true },
      { bindings: null },
      { bindings: { 'bad input': { type: 'integer', value: '1' } } },
      { bindings: { order_id: { type: 'integer', value: '01' } } },
      { bindings: { order_id: { type: 'integer', value: '1', grant: true } } },
      { preflight: { state: 'passing', checkId: 'root' } },
      {
        preflight: {
          state: 'missing/incompatible-input',
          checkId: 'root',
          sql: 'secret',
        },
      },
      { preflight: { state: 'missing/incompatible-input', checkId: '' } },
      {
        preflight: {
          state: 'missing/incompatible-input',
          checkId: 'root',
          stepId: '',
        },
      },
    ];
    for (const patch of alterations) {
      const value = sample();
      Object.assign(value.checks[0], patch);
      invalid.push(value);
    }
    const bindableFalse = sample();
    bindableFalse.checks[2].ready = false;
    invalid.push(bindableFalse);
    invalid.push(
      { ...sample(), action: 'run' },
      { checks: [] },
      { queries: [], checks: Array(1001).fill(sample().checks[0]) },
    );
    const duplicate = sample();
    duplicate.checks.push(duplicate.checks[0]);
    invalid.push(duplicate);
    for (const value of invalid)
      expect(() => decodeNativeApplicable(value)).toThrow();
  });
  it('keeps query wire separate: no Check proof or range granted to queries', () => {
    for (const patch of [
      { title: 'fake' },
      { revision: '1' },
      {
        bindings: {
          order_id: {
            type: 'range',
            start: { type: 'integer', value: '1' },
            end: { type: 'integer', value: '2' },
          },
        },
      },
    ]) {
      const value = sample();
      Object.assign(value.queries[0], patch);
      expect(() => decodeNativeApplicable(value)).toThrow();
    }
  });
  it('decodes actual published Core MarshalJSON scalar/set/ranges; preserves values beyond JS precision', () => {
    // Generic Core model fixture SHA256 07225afc8c2be95edf04d988eaace35b759083466792d3bc17a8169fbc986c14.
    // Not native set/range availability: the actual native facade fixture binds a scalar only.
    for (const value of Object.values(inputFixture))
      expect(decodeNativeCheckInput(value)).toEqual(value);
    for (const value of [
      inputFixture.integerRange,
      inputFixture.decimalRange,
      inputFixture.dateRange,
      inputFixture.datetimeRange,
    ])
      expect(() =>
        decodeNativeCheckInput({
          ...value,
          start: value.end,
          end: value.start,
        }),
      ).toThrow();
  });
  it('rejects malformed generic InputValue shapes without fabricating native set/range availability', () => {
    for (const value of [
      { scalar: { type: 'integer', value: '1' } },
      { type: 'set', values: [] },
      { type: 'set', values: [{ type: 'null', value: null }] },
      {
        type: 'set',
        values: [
          { type: 'integer', value: '1' },
          { type: 'integer', value: '1' },
        ],
      },
      {
        type: 'range',
        start: { type: 'integer', value: '3' },
        end: { type: 'integer', value: '2' },
      },
      {
        type: 'range',
        start: { type: 'string', value: 'a' },
        end: { type: 'string', value: 'z' },
      },
      {
        type: 'range',
        start: { type: 'integer', value: '1' },
        end: { type: 'decimal', value: '2.0' },
      },
    ])
      expect(() => decodeNativeCheckInput(value)).toThrow();
  });
});
