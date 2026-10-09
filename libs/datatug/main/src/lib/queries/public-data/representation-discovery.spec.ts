import sourceRights from '@sneat/datatug-semantic/fixtures/client-only-source-rights.json';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CanonicalMetadataCache,
  CanonicalMetadataReader,
  INITIAL_CANONICAL_PINS,
  sha256,
  type CanonicalIndexes,
  type MetadataObject,
} from './canonical-metadata';
import {
  discoverRepresentations,
  parseMeaningDocument,
  type RepresentationContract,
  type SourceField,
} from './representation-discovery';
import {
  mixedVocabularies,
  toCurrentSpelling,
} from './model-vocabulary.spec-helper';

function fixtureFiles(): Record<string, string> {
  return Object.fromEntries(
    [
      'contract.json',
      'source.modelspec.json',
      'target.modelspec.json',
      'target.meaning.json',
      'core.meaning.json',
      'snapshot.json',
      'bridge.json',
      'keys.json',
      'decision.md',
    ].map((name) => [
      name,
      readFileSync(
        resolve(
          'libs/datatug/main/src/lib/queries/fixtures/public-data-fabric/representation',
          name,
        ),
        'utf8',
      ),
    ]),
  );
}
async function discover(
  files = fixtureFiles(),
  change?: (contract: RepresentationContract) => void,
  rights?: { readonly licence: unknown; readonly dataRights?: unknown },
) {
  const document = JSON.parse(files['contract.json']) as {
    contracts: RepresentationContract[];
  };
  if (change) change(document.contracts[0]);
  files['contract.json'] = JSON.stringify(document);
  const contract = document.contracts[0];
  const source = contract.source as SourceField;
  const provider = {
    repository: 'https://github.com/example/provider',
    commit: 'a'.repeat(40),
    title: 'Synthetic reviewed-helper fixture',
    licence: rights ? rights.licence : 'fixture-only',
    ...(rights?.dataRights !== undefined ? { dataRights: rights.dataRights } : {}),
    representation_contract: {
      path: 'contract.json',
      sha256: await sha256(files['contract.json']),
    },
  };
  const indexes: CanonicalIndexes = {
    pins: INITIAL_CANONICAL_PINS,
    bytes: 0,
    directory: { databases: [provider] },
    models: {
      models: [
        {
          repository: source.schema.repository,
          commit: source.schema.revision,
          files: { json: 'source.modelspec.json' },
        },
        {
          repository: provider.repository,
          commit: provider.commit,
          files: { json: 'target.modelspec.json' },
          licence: 'fixture-only',
        },
      ],
    },
    meanings: {
      graphs: [
        {
          repository: provider.repository,
          commit: provider.commit,
          meaning_files: ['target.meaning.json'],
          meaning_licence: 'fixture-only',
          depends: [{ id: 'fixture-core', commit: source.schema.revision }],
        },
        {
          id: 'fixture-core',
          repository: source.schema.repository,
          commit: source.schema.revision,
          meaning_files: ['core.meaning.json'],
        },
      ],
    },
  };
  const http: typeof fetch = vi.fn(async (input, options) => {
    expect(options?.redirect).toBe('error');
    const path = String(input).split('/').at(-1) ?? '';
    return new Response(files[path] ?? '', {
      status: files[path] === undefined ? 404 : 200,
    });
  });
  const reader = new CanonicalMetadataReader(
    http,
    new CanonicalMetadataCache(),
    new AbortController().signal,
  );
  return discoverRepresentations(source, indexes, reader);
}

describe('closed reviewed-helper consumer fixture, never production admission', () => {
  it('matches reviewed strict Unicode and single-document YAML controls', () => {
    const text = 'format: meaning/draft-1\nconcepts: []\n';
    for (const extra of ['---\nformat: broken\n', '---\n', '---\n['])
      expect(() => parseMeaningDocument(text + extra)).toThrow();
    expect(
      parseMeaningDocument(text + '...\n# trailing comment\n'),
    ).toMatchObject({ format: 'meaning/draft-1' });
    expect(() =>
      parseMeaningDocument(
        'format: meaning/draft-1\nFORMAT: broken\nconcepts: []',
      ),
    ).toThrow(/Aliased/);
    expect(() =>
      parseMeaningDocument(
        'format: meaning/draft-1\nconcepts: []\nx: "\\ud800"',
      ),
    ).toThrow();
  });
  it('verifies the pinned companion graph but remains unavailable without canonical publication', async () => {
    const suggestions = await discover();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      matchesSource: true,
      eligible: false,
    });
    expect(suggestions[0].reason).toMatch(/publication is pending/);
  });
  it('reads URL-only/text-only source terms without promoting the reviewed fixture to public admission', async () => {
    for (const declaration of [{ url: 'https://example.org/terms' }, { text: 'Fixture-only source conditions' }]) {
      const suggestions = await discover(fixtureFiles(), undefined, { licence: declaration, dataRights: sourceRights.structured.sourceRights });
      expect(suggestions[0].rights.declaration).toEqual(declaration);
      expect(suggestions[0].sourceRights).toEqual(sourceRights.structured.sourceRights);
      expect(suggestions[0].eligible).toBe(false);
    }
    const unsafe = await discover(fixtureFiles(), undefined, { licence: { url: 'javascript:alert(1)' } });
    expect(unsafe[0].eligible).toBe(false);
    expect(unsafe[0].rights?.declaration).toBeUndefined();
  });
  it('rejects exact wrong property, revision, checksum, namespace and reference scope', async () => {
    const changes: ((contract: RepresentationContract) => void)[] = [
      (c) => Object.assign(c.source, { property: 'country' }),
      (c) => Object.assign(c.source.schema, { revision: 'c'.repeat(40) }),
      (c) => Object.assign(c.target.model, { sha256: '0'.repeat(64) }),
      (c) => Object.assign(c.target, { namespace: 'iso-3166-1-alpha-2 ' }),
      (c) =>
        Object.assign(c.target.model, {
          repository: 'https://github.com/example/provider',
          revision: 'a'.repeat(40),
        }),
    ];
    for (const change of changes) {
      const [suggestion] = await discover(fixtureFiles(), change);
      expect(suggestion.eligible).toBe(false);
      expect(suggestion.contract).toBeUndefined();
      expect(suggestion.reason).not.toMatch(/publication is pending/);
    }
  });
  it('rejects a hashed bridge collision and binding to the wrong exact property', async () => {
    for (const name of ['bridge.json', 'target.meaning.json']) {
      const files = fixtureFiles();
      const value = JSON.parse(files[name]);
      if (name === 'bridge.json') value.rows.push({ ...value.rows[0] });
      else value.concepts[0].bindings[0].property = 'not_iso';
      files[name] = JSON.stringify(value);
      const hash = await sha256(files[name]);
      const snapshot = JSON.parse(files['snapshot.json']);
      const artifact = snapshot.artifacts.find(
        (a: { path: string }) => a.path === name,
      );
      if (artifact) artifact.sha256 = hash;
      files['snapshot.json'] = JSON.stringify(snapshot);
      const snapshotHash = await sha256(files['snapshot.json']);
      const [suggestion] = await discover(files, (c) => {
        Object.assign(c.target.snapshot, { sha256: snapshotHash });
        Object.assign(
          name === 'bridge.json'
            ? c.bridge.artifact
            : c.target.binding.document,
          { sha256: hash },
        );
      });
      expect(suggestion.reason).toMatch(
        name === 'bridge.json' ? /collision/ : /exact identifier/,
      );
      expect(suggestion.eligible).toBe(false);
    }
  });
  describe('reads a model in either ModelSpec vocabulary', () => {
    async function withModels(edit: (model: MetadataObject) => unknown) {
      const files = fixtureFiles();
      for (const name of ['source.modelspec.json', 'target.modelspec.json'])
        files[name] = JSON.stringify(
          edit(JSON.parse(files[name]) as MetadataObject),
        );
      const source = await sha256(files['source.modelspec.json']);
      const target = await sha256(files['target.modelspec.json']);
      const [suggestion] = await discover(files, (c) => {
        Object.assign(c.source.schema, { sha256: source });
        Object.assign(c.target.model, { sha256: target });
      });
      return suggestion;
    }
    it('gives the same suggestion for the earlier and the current spelling', async () => {
      // The pinned file hashes differ because the files' bytes do; nothing else may.
      const unhashed = (value: unknown) =>
        JSON.stringify(value).replace(/[0-9a-f]{64}/g, '#');
      const [original] = await discover();
      expect(original.contract).toBeDefined();
      expect(unhashed(await withModels((model) => model))).toBe(
        unhashed(original),
      );
      expect(unhashed(await withModels(toCurrentSpelling))).toBe(
        unhashed(original),
      );
    });
    it.each(mixedVocabularies)('refuses %s', async (_, edit) => {
      const suggestion = await withModels(edit);
      expect(suggestion.eligible).toBe(false);
      expect(suggestion.contract).toBeUndefined();
      expect(suggestion.reason).not.toMatch(/publication is pending/);
    });
  });
});
