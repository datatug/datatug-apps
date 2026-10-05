import { describe, expect, it } from 'vitest';
import { localResultBytes } from './local-result-bytes';
describe('local output metadata serialization preflight', () => {
  it.each([null, true, false, 0, -0, 0.00001, 1e30, NaN, 'plain', 'é€😀', '\ud800', '\udc00', '"\\\b\t\n\f\r\u0000', [undefined, null, '☘'], { optional: undefined, nested: { key: 'value' }, rows: [] }])('matches exact JSON UTF8 bytes without a preallocated buffer: %j', (value) => {
    expect(localResultBytes(value)).toBe(new TextEncoder().encode(JSON.stringify(value)).byteLength);
  });
  it('refuses non-JSON and cyclic metadata', () => {
    const cyclic: Record<string, unknown> = {}; cyclic['self'] = cyclic;
    expect(() => localResultBytes(cyclic)).toThrow('cyclic');
    expect(() => localResultBytes({ callback: () => undefined })).toThrow('JSON');
  });
});
