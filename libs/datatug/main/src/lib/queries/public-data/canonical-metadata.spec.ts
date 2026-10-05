import { describe, expect, it, vi } from 'vitest';
import {
  CanonicalMetadataCache,
  CanonicalMetadataReader,
  INITIAL_CANONICAL_PINS,
  immutableUrl,
  sha256,
  strictJson,
  exactFields,
  type ImmutableFile,
} from './canonical-metadata';
import { sameSource, type SourceField } from './representation-discovery';

const file = async (text: string, path = 'a.json'): Promise<ImmutableFile> => ({
  repository: 'https://github.com/example/fixture',
  revision: 'a'.repeat(40),
  path,
  sha256: await sha256(text),
});
const reader = (http: typeof fetch, cache = new CanonicalMetadataCache()) =>
  new CanonicalMetadataReader(http, cache, new AbortController().signal);

describe('immutable canonical discovery admission', () => {
  it('rejects duplicate/case-aliased keys, lone surrogates, trailing documents and mutable paths', () => {
    for (const text of [
      '{"a":1,"a":2}',
      '{"x":"\\ud800"}',
      '{}{}',
      '[1,]',
      '{"a":1,}',
    ])
      expect(() => strictJson(text)).toThrow();
    expect(strictJson('{"x":"\\ud83d\\ude00"}')).toEqual({ x: '😀' });
    expect(strictJson('{"Country":1,"COUNTRY":2}')).toEqual({
      Country: 1,
      COUNTRY: 2,
    });
    expect(() =>
      exactFields({ property: 1, Property: 2 }, ['property']),
    ).toThrow(/Aliased/);
    for (const encoded of [
      '\\uFFFD',
      '�',
      '\\ud83d\\ude00',
      '\\uD83D\\uDE00',
      '\\\\ud800',
      '\\"label\\"',
    ])
      expect(() => strictJson(`{"x":"${encoded}"}`)).not.toThrow();
    expect(() =>
      immutableUrl({ ...INITIAL_CANONICAL_PINS.directory, revision: 'main' }),
    ).toThrow();
    expect(() =>
      immutableUrl({
        ...INITIAL_CANONICAL_PINS.directory,
        path: '../index.json',
      }),
    ).toThrow();
  });
  it('caches exact verified bytes, invalidates on a revision mutation without code changes, and never aliases wrong hashes', async () => {
    const text = '{"value":"fixture"}';
    const reference = await file(text);
    const http = vi.fn(async () => new Response(text));
    const cache = new CanonicalMetadataCache();
    cache.begin(INITIAL_CANONICAL_PINS);
    await reader(http, cache).json(reference);
    await reader(http, cache).json(reference);
    expect(http).toHaveBeenCalledTimes(1);
    cache.begin({
      ...INITIAL_CANONICAL_PINS,
      meanings: {
        ...INITIAL_CANONICAL_PINS.meanings,
        revision: 'b'.repeat(40),
      },
    });
    await reader(http, cache).json(reference);
    expect(http).toHaveBeenCalledTimes(2);
    const operation = reader(http, cache);
    await operation.json(reference);
    await expect(
      operation.json({ ...reference, sha256: '0'.repeat(64) }),
    ).rejects.toThrow(/checksum/);
  });
  it('charges aggregate cached and fetched metadata, rejects cycles/depth/count and refuses redirects/missing files', async () => {
    const text = 'x'.repeat(1024 * 1024 + 1);
    const a = await file(text);
    const b = await file(text, 'b.json');
    const cache = new CanonicalMetadataCache();
    cache.set(a, new TextEncoder().encode(text));
    cache.set(b, new TextEncoder().encode(text));
    const operation = reader(vi.fn(), cache);
    await operation.text(a);
    await expect(operation.text(b)).rejects.toThrow(/aggregate/);
    await expect(reader(vi.fn()).text(a, [immutableUrl(a)])).rejects.toThrow(
      /cycle/,
    );
    await expect(
      reader(vi.fn()).text(a, Array(9).fill('ancestor')),
    ).rejects.toThrow(/depth/);
    const small = await file('{}');
    const many = reader(async () => new Response('{}'));
    for (let i = 0; i < 96; i++)
      await many.text({ ...small, path: `${i}.json` });
    await expect(many.text({ ...small, path: '97.json' })).rejects.toThrow(
      /count/,
    );
    const redirected = new Response('{}');
    Object.defineProperty(redirected, 'redirected', { value: true });
    await expect(reader(async () => redirected).text(small)).rejects.toThrow(
      /redirect/,
    );
    await expect(
      reader(async () => new Response('{}', { status: 404 })).text(small),
    ).rejects.toThrow(/unavailable/);
  });
  it('hashes original BOM bytes and retains their exact budget on cold and cached reads', async () => {
    const plain = new TextEncoder().encode('é😀�'),
      bom = new Uint8Array([0xef, 0xbb, 0xbf, ...plain]);
    const ref = { ...(await file('é😀�')), sha256: await sha256(bom) };
    for (const [expected, actual] of [
      [plain, bom],
      [bom, plain],
    ]) {
      const wrong = { ...ref, sha256: await sha256(expected) };
      const cache = new CanonicalMetadataCache();
      await expect(
        reader(async () => new Response(actual), cache).text(wrong),
      ).rejects.toThrow(/checksum/);
      expect(cache.get(wrong)).toBeUndefined();
    }
    const cache = new CanonicalMetadataCache(),
      http = vi.fn(async () => new Response(bom));
    const cold = reader(http, cache),
      warm = reader(http, cache);
    expect(await cold.text(ref)).toBe('\ufeffé😀�');
    expect(await warm.text(ref)).toBe('\ufeffé😀�');
    expect(cold.bytes).toBe(bom.byteLength);
    expect(warm.bytes).toBe(bom.byteLength);
    expect(http).toHaveBeenCalledOnce();
    const copy = cache.get(ref);
    if (!copy) throw new Error('Missing verified cache bytes.');
    copy[0] = 0;
    expect(cache.get(ref)).toEqual(bom);
    const invalid = new Uint8Array([0xc3, 0x28]),
      invalidRef = { ...ref, sha256: await sha256(invalid) };
    await expect(
      reader(async () => new Response(invalid), cache).text(invalidRef),
    ).rejects.toThrow();
    expect(cache.get(invalidRef)).toBeUndefined();
    cache.set(invalidRef, invalid);
    await expect(reader(vi.fn(), cache).text(invalidRef)).rejects.toThrow();
  });
  it('enforces exact aggregate byte budgets with BOM and multibyte Unicode in fetched and cached metadata', async () => {
    const cap = 2 * 1024 * 1024;
    const exact = new TextEncoder().encode('\ufeffé' + 'x'.repeat(cap - 5));
    expect(exact.byteLength).toBe(cap);
    const ref = { ...(await file('')), sha256: await sha256(exact) },
      cache = new CanonicalMetadataCache();
    const cold = reader(async () => new Response(exact), cache);
    await cold.text(ref);
    expect(cold.bytes).toBe(cap);
    const warm = reader(vi.fn(), cache);
    await warm.text(ref);
    expect(warm.bytes).toBe(cap);
    const extra = await file('x', 'extra.txt');
    cache.set(extra, new TextEncoder().encode('x'));
    await expect(warm.text(extra)).rejects.toThrow(/byte bound|aggregate/);
    const over = new Uint8Array([...exact, 120]),
      overRef = { ...ref, sha256: await sha256(over) };
    await expect(
      reader(async () => new Response(over), cache).text(overRef),
    ).rejects.toThrow(/byte bound/);
    expect(cache.get(overRef)).toBeUndefined();
    cache.set(overRef, over);
    await expect(reader(vi.fn(), cache).text(overRef)).rejects.toThrow(
      /aggregate/,
    );
  });
  it('uses full source coordinates and representation scope, with no case or space guesses', () => {
    const source: SourceField = {
      schema: INITIAL_CANONICAL_PINS.models,
      module: 'sample',
      entity: 'Customer',
      property: 'Country',
      datatype: 'string',
      namespace: 'raw-country',
    };
    expect(sameSource(source, source)).toBe(true);
    for (const change of [
      { property: 'country' },
      { entity: 'Invoice' },
      { namespace: 'raw-country ' },
      { schema: { ...source.schema, revision: 'c'.repeat(40) } },
    ])
      expect(sameSource(source, { ...source, ...change })).toBe(false);
  });
});
