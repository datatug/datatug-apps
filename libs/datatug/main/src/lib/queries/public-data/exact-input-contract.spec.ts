import { describe, expect, it, vi } from 'vitest';
import { immutableUrl } from './canonical-metadata';
import { nativeFixture } from './native-fixture.spec-helper';
import { parseHttpsJsonCatalog } from '../../project-files/https-json-catalog';
import {
  parseRepresentationContracts,
  sameSource,
} from './representation-discovery';
import { PublicDataService } from './public-data.service';

describe('closed exact-artifact native contract', () => {
  it.each(['ror', 'geo'] as const)(
    'binds the independently configured %s source to all four data coordinates without fetching rows',
    async (kind) => {
      const fixture = await nativeFixture(kind, true);
      const parsed = parseRepresentationContracts(fixture.document)[0];
      expect(parsed.source.data).toEqual(fixture.data);
      const pins = await fixture.publish();
      vi.stubGlobal('fetch', fixture.http);
      try {
        const discovered = await new PublicDataService().discoverDeclared(
          fixture.context,
          new AbortController().signal,
          pins,
        );
        expect(discovered.declaredSources?.[0].source.data).toEqual(
          fixture.data,
        );
        expect(discovered.suggestions[0]).toMatchObject({
          matchesSource: true,
          compatibility: 'compatible',
          eligible: false,
        });
        expect(
          fixture.http.mock.calls.some(
            ([url]) => String(url) === immutableUrl(fixture.data),
          ),
        ).toBe(false);
        const source = discovered.declaredSources?.[0].source;
        if (!source) throw new Error('Missing checked source.');
        for (const coordinate of [
          'repository',
          'revision',
          'path',
          'sha256',
        ] as const) {
          const data = { ...fixture.data, [coordinate]: 'different' };
          expect(sameSource(source, { ...parsed.source, data })).toBe(false);
        }
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('does not upgrade a format-2 native attachment by inference or accept an added data member', async () => {
    const fixture = await nativeFixture('ror');
    const pins = await fixture.publish();
    vi.stubGlobal('fetch', fixture.http);
    try {
      const discovered = await new PublicDataService().discoverDeclared(
        fixture.context,
        new AbortController().signal,
        pins,
      );
      expect(
        discovered.suggestions.every((value) => !value.matchesSource),
      ).toBe(true);
      const injected = structuredClone(fixture.document);
      Object.assign(injected.contracts[0].source, { data: fixture.data });
      expect(() => parseRepresentationContracts(injected)).toThrow();
      const missing = structuredClone(injected);
      missing.format = 'ovdb-representation-contract/3';
      delete (missing.contracts[0].source as { data?: unknown }).data;
      expect(() => parseRepresentationContracts(missing)).toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['repository', 'revision', 'path', 'sha256'] as const)(
    'refuses a canonically shaped attachment with a changed %s data coordinate',
    async (coordinate) => {
      const fixture = await nativeFixture('ror', true);
      const replacement = {
        repository: 'https://github.com/example/other-source',
        revision: 'd'.repeat(40),
        path: 'source/other.json',
        sha256: '0'.repeat(64),
      }[coordinate];
      Object.assign(fixture.contract.source.data ?? {}, {
        [coordinate]: replacement,
      });
      const pins = await fixture.publish();
      vi.stubGlobal('fetch', fixture.http);
      try {
        const result = await new PublicDataService().discoverDeclared(
          fixture.context,
          new AbortController().signal,
          pins,
        );
        expect(result.suggestions[0].matchesSource).toBe(false);
        expect(result.suggestions[0].eligible).toBe(false);
        expect(
          fixture.http.mock.calls.some(
            ([url]) => String(url) === immutableUrl(fixture.data),
          ),
        ).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it.each(['selected-rename', 'key-rename', 'module-id'] as const)(
    'refuses %s reinterpretation from the selected configuration',
    async (mutation) => {
      const fixture = await nativeFixture('ror', true);
      const catalog = structuredClone(fixture.context.catalog);
      const declaration = catalog.sourceModel;
      if (!declaration) throw new Error('Missing fixture declaration.');
      const table = declaration.tables[0];
      if (mutation === 'selected-rename')
        Object.assign(table.fields[1], { name: 'alternate' });
      if (mutation === 'key-rename') {
        Object.assign(table.fields[0], { name: 'other_key' });
        Object.assign(table, { key: 'other_key' });
        Object.assign(catalog.keys, { affiliations: 'other_key' });
      }
      if (mutation === 'module-id')
        Object.assign(declaration, { moduleId: 'other-module' });
      const text = JSON.stringify(catalog);
      const parsed = parseHttpsJsonCatalog(text, { trust: 'untrusted' });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const configuration = await fixture.put(
        fixture.context.configuration,
        text,
      );
      const context = {
        ...fixture.context,
        configuration,
        catalog: parsed.value,
      };
      const pins = await fixture.publish();
      vi.stubGlobal('fetch', fixture.http);
      try {
        const check = new PublicDataService().discoverDeclared(
          context,
          new AbortController().signal,
          pins,
        );
        if (mutation === 'module-id') await expect(check).rejects.toThrow();
        else {
          const result = await check;
          expect(result.suggestions[0].compatibility).toBe('incompatible');
        }
        expect(
          fixture.http.mock.calls.some(
            ([url]) => String(url) === immutableUrl(fixture.data),
          ),
        ).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it.each([
    'missing-required',
    'nonboolean-required',
    'composite-key',
  ] as const)('refuses a checked source model with %s', async (mutation) => {
    const fixture = await nativeFixture('ror', true);
    const schemaRef = fixture.contract.source.schema;
    const bytes = fixture.files.get(immutableUrl(schemaRef));
    if (!bytes) throw new Error('Missing fixture model.');
    const model = JSON.parse(bytes);
    const entity = model.entities[fixture.contract.source.entity];
    if (mutation === 'missing-required')
      delete entity.properties.ror_id.required;
    if (mutation === 'nonboolean-required')
      entity.properties.ror_id.required = 'false';
    if (mutation === 'composite-key') entity.key.push('ror_id');
    const updated = await fixture.put(schemaRef, JSON.stringify(model));
    Object.assign(schemaRef, { sha256: updated.sha256 });
    const catalog = structuredClone(fixture.context.catalog);
    Object.assign(catalog.sourceModel?.schema ?? {}, {
      sha256: updated.sha256,
    });
    const text = JSON.stringify(catalog);
    const parsed = parseHttpsJsonCatalog(text, { trust: 'untrusted' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const configuration = await fixture.put(
      fixture.context.configuration,
      text,
    );
    const pins = await fixture.publish();
    vi.stubGlobal('fetch', fixture.http);
    try {
      const check = new PublicDataService().discoverDeclared(
        { ...fixture.context, configuration, catalog: parsed.value },
        new AbortController().signal,
        pins,
      );
      if (mutation === 'composite-key')
        await expect(check).rejects.toThrow(/grain|key/i);
      else
        expect((await check).suggestions[0].compatibility).toBe('incompatible');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
