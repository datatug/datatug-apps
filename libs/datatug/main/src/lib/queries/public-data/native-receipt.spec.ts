import { describe, expect, it } from 'vitest';
import {
  CanonicalMetadataCache,
  CanonicalMetadataReader,
  immutableUrl,
  readCanonicalIndexes,
  sha256,
} from './canonical-metadata';
import { verifyDeclaredCatalog } from './declared-source';
import { discoverRepresentations } from './representation-discovery';
import { equalReceiptValues } from './native-receipt';
import { strictJsonNumbers } from './strict-json';
import { nativeFixture } from './native-fixture.spec-helper';

async function discover(
  fixture: Awaited<ReturnType<typeof nativeFixture>>,
  revision?: string,
  cache = new CanonicalMetadataCache(),
) {
  const pins = await fixture.publish(revision);
  cache.begin(pins);
  const reader = new CanonicalMetadataReader(
    fixture.http,
    cache,
    new AbortController().signal,
  );
  const declared = await verifyDeclaredCatalog(fixture.context, reader);
  const indexes = await readCanonicalIndexes(pins, reader);
  const suggestions = await discoverRepresentations(
    fixture.contract.source,
    indexes,
    reader,
    declared,
  );
  return { suggestions, reader, pins };
}
describe('native metadata parity with exact landed provider receipts', () => {
  it.each(['ror', 'geo'] as const)(
    'reads %s metadata into a structural suggestion without dataset/keyset loads or execution admission',
    async (kind) => {
      const fixture = await nativeFixture(kind);
      for (const file of fixture.manifest.files)
        expect(await sha256(fixture.files.get(immutableUrl(file)) ?? '')).toBe(
          file.sha256,
        );
      const { suggestions, reader } = await discover(fixture);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toMatchObject({
        compatibility: 'compatible',
        matchesSource: true,
        eligible: false,
        sourceFacts: { records: kind === 'ror' ? '141528' : '252' },
      });
      expect(reader.bytes).toBeLessThan(200 * 1024);
      expect(
        fixture.http.mock.calls.every(
          ([url]) =>
            !String(url).endsWith('.sqlite') &&
            !String(url).includes('keys.json'),
        ),
      ).toBe(true);
      if (kind === 'ror') {
        expect(suggestions[0].sourceFacts).toMatchObject({
          release: 'v2.13',
          releaseDate: '2026-09-22',
          sourceLicences: ['CC0-1.0', 'CC-BY-4.0'],
        });
        expect(fixture.contract.source.schema.revision).toBe(
          'e7362033ec79c6663d7dbe0483b62fab01f7b9cd',
        );
        expect(fixture.contract.decision.document.revision).toBe(
          '17263dbacabdfe95e53fc3c6980177416bdab941',
        );
      } else {
        expect(suggestions[0].sourceFacts?.release).toBeUndefined();
        expect(suggestions[0].sourceFacts?.sourceLicences).toEqual([
          'CC-BY-4.0',
        ]);
        expect(suggestions[0].sourceFacts?.inputs?.length).toBe(5);
        expect(
          fixture.http.mock.calls.some(([url]) =>
            String(url).endsWith('/source/generation-snapshot.json'),
          ),
        ).toBe(true);
      }
    },
  );
  it('changes the computed suggestion after an exact immutable canonical revision changes, through the real reader and shared cache', async () => {
    const fixture = await nativeFixture('ror'),
      cache = new CanonicalMetadataCache();
    const first = await discover(fixture, 'a'.repeat(40), cache);
    expect(first.suggestions[0].compatibility).toBe('compatible');
    const target = fixture.models.models.find(
      (record) => record['repository'] === fixture.provider['repository'],
    );
    Object.assign(target?.['files'] ?? {}, {
      json: 'model/unregistered-model.json',
    });
    const second = await discover(fixture, 'b'.repeat(40), cache);
    expect(second.pins.directory).not.toEqual(first.pins.directory);
    expect(second.suggestions[0]).toMatchObject({
      compatibility: 'incompatible',
      eligible: false,
    });
    expect(second.suggestions[0].contract).toBeUndefined();
    expect(second.suggestions[0].reason).toMatch(/registered target model/);
  });
  it.each([
    'namespace',
    'duplicates',
    'binding',
    'count',
    'association',
    'selector',
    'without-association',
    'embedded',
  ] as const)(
    'rejects a freshly hashed %s mismatch instead of admitting its wrapper',
    async (kind) => {
      const fixture = await nativeFixture('geo');
      await fixture.updateReceipt((proof) => {
        const receipt = proof['native_key'] as Record<string, unknown>;
        const snapshot = proof['snapshot'] as Record<string, unknown>;
        const association = proof['snapshot_association'] as Record<
          string,
          unknown
        >;
        if (kind === 'namespace')
          receipt['namespace'] = 'GeoNames:countryInfoISO2 ';
        if (kind === 'duplicates') receipt['duplicates'] = 1;
        if (kind === 'binding')
          (receipt['binding'] as Record<string, unknown>)['sha256'] =
            '0'.repeat(64);
        if (kind === 'count') receipt['records'] = 251;
        if (kind === 'association')
          (association['source'] as Record<string, unknown>)['sha256'] =
            '0'.repeat(64);
        if (kind === 'selector') association['output_key'] = 'sqlite/file';
        if (kind === 'without-association')
          delete proof['snapshot_association'];
        if (kind === 'embedded')
          (snapshot['counts'] as Record<string, unknown>)['geonames_places'] =
            1;
      });
      const { suggestions } = await discover(fixture);
      expect(suggestions[0]).toMatchObject({
        compatibility: 'incompatible',
        eligible: false,
      });
      expect(suggestions[0].contract).toBeUndefined();
    },
  );
  it('preserves numeric tokens and array order without rounding or key-delimiter collisions', () => {
    const parsed = strictJsonNumbers;
    expect(
      equalReceiptValues(parsed('{"a":1,"b":[2]}'), parsed('{"b":[2],"a":1}')),
    ).toBe(true);
    for (const [left, right] of [
      ['1', '1.0'],
      ['9007199254740992', '9007199254740993'],
      ['[1,2]', '[2,1]'],
      ['{"a\\u0000b":1}', '{"a":1,"b":1}'],
    ])
      expect(equalReceiptValues(parsed(left), parsed(right))).toBe(false);
    for (const text of [
      '{"x":1,"x":2}',
      '{"x":"\\ud800"}',
      '{}{}',
      '[1,]',
      '1e400',
    ])
      expect(() => parsed(text)).toThrow();
    expect(equalReceiptValues(parsed('"\\ud83d\\ude00"'), parsed('"😀"'))).toBe(
      true,
    );
    expect(equalReceiptValues(parsed('"\\uFFFD"'), parsed('"�"'))).toBe(true);
  });
  it('rejects duplicate source scopes independent of JSON key order without retaining an earlier compatible suggestion', async () => {
    const fixture = await nativeFixture('ror');
    fixture.document.contracts.push({
      ...fixture.contract,
      source: Object.fromEntries(
        Object.entries(fixture.contract.source).reverse(),
      ) as typeof fixture.contract.source,
    });
    const { suggestions } = await discover(fixture);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].reason).toMatch(/Duplicate contract/);
    expect(suggestions[0].compatibility).toBe('incompatible');
  });
});
