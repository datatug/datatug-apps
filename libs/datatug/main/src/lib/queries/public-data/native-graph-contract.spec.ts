import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import profile from './native-graph-profile.json';
import schema4 from './representation-contract-4.schema.json';
import {
  CanonicalMetadataCache,
  CanonicalMetadataReader,
  immutableUrl,
  readCanonicalIndexes,
  sha256,
  type CanonicalPins,
  type ImmutableFile,
  type MetadataObject,
} from './canonical-metadata';
import {
  parseNativeGraphEnvelope,
  NATIVE_GRAPH_ORIGINAL_DECISION,
  readNativeGraphMetadata,
} from './native-graph-contract';
import { parseRepresentationContracts } from './representation-discovery';
import {
  mixedVocabularies,
  toCurrentSpelling,
} from './model-vocabulary.spec-helper';

const dir = resolve(
  'libs/datatug/main/src/lib/queries/fixtures/public-data-fabric/native-graph',
);
async function metadataFixture() {
  const manifest = JSON.parse(
    readFileSync(resolve(dir, 'manifest.json'), 'utf8'),
  ) as { files: { file: ImmutableFile; local: string }[] };
  const values = new Map(
    manifest.files.map((r) => [
      immutableUrl(r.file),
      readFileSync(resolve(dir, r.local), 'utf8'),
    ]),
  );
  const put = async (
    path: string,
    text: string,
    repository = 'https://github.com/fixture/metadata',
    revision = 'f'.repeat(40),
  ) => {
    const file = { repository, revision, path, sha256: await sha256(text) };
    values.set(immutableUrl(file), text);
    return file;
  };
  const pins = Object.fromEntries(
    await Promise.all(
      (['directory', 'models', 'meanings'] as const).map(async (name) => [
        name,
        await put(
          name + '.json',
          readFileSync(resolve(dir, name + '-synthetic-index.json'), 'utf8'),
        ),
      ]),
    ),
  ) as unknown as CanonicalPins;
  const envelope = {
    format: 'ovdb-representation-contract/4',
    legacy: {
      path: 'model/representations.json',
      sha256:
        'd012fe6f269f9f3c48bd8051c77e74ab6c5578c4d7bfe2bdc7029d4bee0a7b2c',
    },
    graphs: [profile],
  };
  const attachment = await put(
    'model/representation-graph.json',
    JSON.stringify(envelope),
    'https://github.com/ingitdb/geo-ingitdb',
    '57e25689009047a557d35519831b8413b4abe838',
  );
  const http = vi.fn<typeof fetch>(
    async (url) =>
      new Response(values.get(String(url)) ?? 'missing', {
        status: values.has(String(url)) ? 200 : 404,
      }),
  );
  const cache = new CanonicalMetadataCache();
  const reader = new CanonicalMetadataReader(
    http,
    cache,
    new AbortController().signal,
  );
  return {
    reader,
    http,
    attachment,
    pins,
    envelope,
    values,
    put,
    cache,
    provider: {
      repository: attachment.repository,
      commit: attachment.revision,
      licence: 'Explicit hypothetical fixture licence',
    },
  };
}
describe('closed native graph metadata, never admission', () => {
  it('copies the exact reviewed provisional schema without assigning a canonical identity', async () => {
    expect(schema4.$id).toMatch(/^urn:datatug:provisional:/);
    expect(
      await sha256(
        readFileSync(
          resolve(
            'libs/datatug/main/src/lib/queries/public-data/representation-contract-4.schema.json',
          ),
        ),
      ),
    ).toBe('92b9a07c98c52146147afaa3b93a78aa83b7482bb96d9cda8d98329cd64185ca');
  });
  it('checks original legacy/entry and native entity-reference/ordered grains within one metadata budget', async () => {
    const f = await metadataFixture(),
      indexes = await readCanonicalIndexes(f.pins, f.reader);
    const checked = await readNativeGraphMetadata(
      f.attachment,
      f.provider,
      indexes,
      f.reader,
    );
    expect(checked.eligible).toBe(false);
    expect(checked.entrySource.entity).toBe('Affiliation');
    expect(checked.references.length).toBeLessThanOrEqual(96);
    expect(checked.bytes).toBeLessThan(2 * 1024 * 1024);
    expect(
      f.http.mock.calls.every(
        ([url]) =>
          !/\.sqlite|\.gz|part-|affiliations\.json|ror.*\.zip|archive/.test(
            String(url),
          ),
      ),
    ).toBe(true);
    expect(
      f.http.mock.calls.every(([url]) =>
        String(url).startsWith('https://raw.githubusercontent.com/'),
      ),
    ).toBe(true);
  });
  it('reads the exact two-decision lineage once in the shared closure and never follows archived audit links', async () => {
    const f = await metadataFixture(), indexes = await readCanonicalIndexes(f.pins, f.reader), checked = await readNativeGraphMetadata(f.attachment, f.provider, indexes, f.reader);
    for (const ref of [profile.decision.document, NATIVE_GRAPH_ORIGINAL_DECISION]) {
      expect(checked.references.filter((saved) => immutableUrl(saved) === immutableUrl(ref))).toEqual([ref]);
      expect(f.http.mock.calls.filter(([url]) => String(url) === immutableUrl(ref))).toHaveLength(1);
    }
    const requested = f.http.mock.calls.map(([url]) => String(url));
    expect(requested.some((url) => /proposal|review|root-acceptance|private\/tmp|research.*archive/.test(url))).toBe(false);
    const bytes = checked.references.reduce((sum, ref) => sum + new TextEncoder().encode(f.values.get(immutableUrl(ref)) ?? '').byteLength, 0);
    expect(checked.bytes).toBe(bytes); expect(bytes).toBeLessThan(2097152);
  });
  it('refuses a missing original or corrupted head before any source read and poisons the whole shared reader', async () => {
    for (const missing of [profile.decision.document, NATIVE_GRAPH_ORIGINAL_DECISION]) {
      const f = await metadataFixture(), indexes = await readCanonicalIndexes(f.pins, f.reader);
      f.values.delete(immutableUrl(missing));
      await expect(readNativeGraphMetadata(f.attachment, f.provider, indexes, f.reader)).rejects.toThrow();
      const before = f.http.mock.calls.length;
      await expect(f.reader.text(profile.sources.ror.model)).rejects.toThrow(); expect(f.http.mock.calls.length).toBe(before);
      expect(f.http.mock.calls.some(([url]) => /\.sqlite|\.gz|archive/.test(String(url)))).toBe(false);
    }
  });
  it('refuses an unchecked shorthand dependency at the decoded decision boundary without fetching it', async () => {
    const f = await metadataFixture(), indexes = await readCanonicalIndexes(f.pins, f.reader), original = f.reader.json.bind(f.reader);
    vi.spyOn(f.reader, 'json').mockImplementation(async (ref, ancestry) => {
      const parsed = await original(ref, ancestry);
      if (immutableUrl(ref) === immutableUrl(profile.decision.document)) return { ...(parsed as object), original_decision: { ...NATIVE_GRAPH_ORIGINAL_DECISION, repository: 'arbitrary/other' } };
      return parsed;
    });
    await expect(readNativeGraphMetadata(f.attachment, f.provider, indexes, f.reader)).rejects.toThrow('exact original decision');
    expect(f.http.mock.calls.some(([url]) => String(url) === immutableUrl(NATIVE_GRAPH_ORIGINAL_DECISION))).toBe(false);
  });
  it('accepts descriptor permutations but rejects changed fields, unknown capability/source/operator, nesting and salvage', () => {
    const good = {
      format: 'ovdb-representation-contract/4',
      graphs: [structuredClone(profile)],
    };
    good.graphs[0].stages.reverse();
    good.graphs[0].edges.reverse();
    expect(parseNativeGraphEnvelope(good).graphs[0].id).toBe(profile.id);
    const bad = structuredClone(good);
    bad.graphs[0].edges.find((e) => e.id === 'place-admin1')?.fields.reverse();
    expect(() => parseNativeGraphEnvelope(bad)).toThrow();
    expect(() =>
      parseNativeGraphEnvelope({ ...good, contracts: [] }),
    ).toThrow();
    expect(() => parseRepresentationContracts(good)).toThrow();
    expect(() =>
      parseNativeGraphEnvelope(
        JSON.stringify(good).replace(
          '"format":',
          '"format":"ovdb-representation-contract/4","format":',
        ),
      ),
    ).toThrow();
  });
  it('checks all finite core dependencies even without legacy, and rejects a broadened registry closure before source data I/O', async () => {
    const f = await metadataFixture(),
      indexes = await readCanonicalIndexes(f.pins, f.reader);
    const envelope = { format: f.envelope.format, graphs: f.envelope.graphs };
    const attachment = await f.put(
      f.attachment.path,
      JSON.stringify(envelope),
      f.attachment.repository,
      f.attachment.revision,
    );
    const checked = await readNativeGraphMetadata(
      attachment,
      f.provider,
      indexes,
      f.reader,
    );
    expect(
      checked.references
        .filter(
          (file) => file.repository === 'https://github.com/meaninggraph/core',
        )
        .map((file) => file.path)
        .sort(),
    ).toEqual(['geo.meaning.yaml', 'identity.meaning.yaml']);
    const unknown = structuredClone(indexes),
      registry = unknown.meanings['graphs'] as Record<string, unknown>[];
    const graph = registry.find(
      (record) =>
        record['repository'] === profile.sources.geo.binding.repository &&
        record['commit'] === profile.sources.geo.binding.revision,
    );
    (graph?.['depends'] as unknown[]).push({
      id: 'unbounded-meaning',
      commit: 'e'.repeat(40),
    });
    await expect(
      readNativeGraphMetadata(attachment, f.provider, unknown, f.reader),
    ).rejects.toThrow('meaning dependency');
    expect(
      f.http.mock.calls.every(
        ([url]) => !/\.sqlite|\.gz|archive/.test(String(url)),
      ),
    ).toBe(true);
  });
  it('refuses the whole wrapper before dependency reads for unknown selected source pins', async () => {
    const f = await metadataFixture(),
      indexes = await readCanonicalIndexes(f.pins, f.reader),
      bad = structuredClone(f.envelope);
    bad.graphs[0].sources.ror.model.sha256 = 'e'.repeat(64);
    const ref = await f.put(
      f.attachment.path,
      JSON.stringify(bad),
      f.attachment.repository,
      f.attachment.revision,
    );
    const count = f.http.mock.calls.length;
    await expect(
      readNativeGraphMetadata(ref, f.provider, indexes, f.reader),
    ).rejects.toThrow('source');
    expect(f.http.mock.calls.length - count).toBe(1);
  });
  it('cached bytes and failed bodies spend one operation allowance and failures poison subsequent reads', async () => {
    const f = await metadataFixture(),
      large = ' '.repeat(2 * 1024 * 1024 - 10),
      ref = await f.put('large.txt', large);
    f.cache.set(ref, new TextEncoder().encode(large));
    await f.reader.text(ref);
    expect(f.reader.bytes).toBe(large.length);
    await f.reader.text({
      sha256: ref.sha256,
      path: ref.path,
      revision: ref.revision,
      repository: ref.repository,
    });
    expect(f.reader.bytes).toBe(large.length);
    const small = await f.put('small.txt', 'too many bytes');
    await expect(f.reader.text(small)).rejects.toThrow('byte bound');
    const before = f.http.mock.calls.length;
    const after = await f.put('after.txt', 'x');
    await expect(f.reader.text(after)).rejects.toThrow();
    expect(f.http.mock.calls.length).toBe(before);
    const failRef = { ...after, path: 'failed.txt' },
      http = vi.fn<typeof fetch>(
        async () => new Response('failure body', { status: 500 }),
      );
    const reader = new CanonicalMetadataReader(
      http,
      new CanonicalMetadataCache(),
      new AbortController().signal,
    );
    await expect(reader.text(failRef)).rejects.toThrow('unavailable');
    expect(reader.bytes).toBe(12);
    await expect(reader.text(after)).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('shared immutable reference/depth limits reject without transport after exhaustion', async () => {
    const f = await metadataFixture();
    for (let i = 0; i < 96; i++) {
      const ref = await f.put('r' + i + '.txt', 'x');
      await f.reader.text(ref);
    }
    const last = await f.put('last.txt', 'x');
    await expect(f.reader.text(last)).rejects.toThrow('reference count');
    expect(f.http).toHaveBeenCalledTimes(96);
    const reader = new CanonicalMetadataReader(
      f.http,
      f.cache,
      new AbortController().signal,
    );
    await expect(
      reader.text(
        last,
        Array.from({ length: 9 }, (_, i) => String(i)),
      ),
    ).rejects.toThrow('depth');
    expect(f.http).toHaveBeenCalledTimes(96);
  });
  describe('reads each graph source model in either ModelSpec vocabulary', () => {
    // The reviewed pins of both source models are compiled in, so the models are
    // changed after the pinned bytes are read and verified, as the shorthand test above does.
    async function readWith(edit: (model: MetadataObject) => unknown) {
      const f = await metadataFixture(),
        indexes = await readCanonicalIndexes(f.pins, f.reader),
        original = f.reader.json.bind(f.reader),
        models = [profile.sources.ror.model, profile.sources.geo.model].map(
          immutableUrl,
        );
      vi.spyOn(f.reader, 'json').mockImplementation(async (ref, ancestry) => {
        const parsed = await original(ref, ancestry);
        return models.includes(immutableUrl(ref)) ? edit(parsed) : parsed;
      });
      return readNativeGraphMetadata(f.attachment, f.provider, indexes, f.reader);
    }

    it('gives the same metadata for the earlier and the current spelling', async () => {
      const earlier = await readWith((model) => model);
      expect(earlier.eligible).toBe(false);
      expect(await readWith(toCurrentSpelling)).toEqual(earlier);
    });
    it.each(mixedVocabularies)('refuses %s', async (_, edit) => {
      await expect(readWith(edit)).rejects.toThrow(/other vocabulary/);
    });
  });
});
