import { describe, expect, it, vi } from 'vitest';
import {
  CanonicalMetadataCache,
  CanonicalMetadataReader,
  INITIAL_CANONICAL_PINS,
  immutableUrl,
  sha256,
  strictJson,
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
      '{"property":1,"Property":2}',
      '{"x":"\\ud800"}',
      '{}{}',
      '[1,]',
      '{"a":1,}',
    ])
      expect(() => strictJson(text)).toThrow();
    expect(strictJson('{"x":"\\ud83d\\ude00"}')).toEqual({ x: '😀' });
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
    cache.set(a, text);
    cache.set(b, text);
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
