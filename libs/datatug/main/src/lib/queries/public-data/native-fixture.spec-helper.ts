import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import {
  immutableUrl,
  sha256,
  type ImmutableFile,
  type CanonicalPins,
  type MetadataObject,
} from './canonical-metadata';
import { parseHttpsJsonCatalog } from '../../project-files/https-json-catalog';
import type { DeclaredCatalogContext } from './declared-source';
import type { NativeRepresentationContract } from './representation-discovery';

/** Hypothetical publication envelope around exact landed, small provider metadata. */
export async function nativeFixture(kind: 'ror' | 'geo') {
  const dir = resolve(
    'libs/datatug/main/src/lib/queries/fixtures/public-data-fabric/native',
    kind,
  );
  const manifest = JSON.parse(
    readFileSync(resolve(dir, 'manifest.json'), 'utf8'),
  ) as {
    provider: MetadataObject;
    files: (ImmutableFile & { local: string })[];
  };
  const document = JSON.parse(
    readFileSync(resolve(dir, 'contract.json'), 'utf8'),
  ) as { format: string; contracts: NativeRepresentationContract[] };
  const contract = document.contracts[0];
  const files = new Map<string, string>();
  for (const file of manifest.files)
    files.set(
      immutableUrl(file),
      readFileSync(resolve(dir, file.local), 'utf8'),
    );
  const own = (path: string, hash: string): ImmutableFile => ({
    path,
    sha256: hash,
    repository: String(manifest.provider['repository']),
    revision: String(manifest.provider['commit']),
  });
  const content = (file: ImmutableFile): string => {
    const value = files.get(immutableUrl(file));
    if (value === undefined) throw new Error('Missing fixture bytes.');
    return value;
  };
  const put = async (ref: ImmutableFile, text: string) => {
    const file = { ...ref, sha256: await sha256(text) };
    files.set(immutableUrl(file), text);
    return file;
  };
  const provider: MetadataObject = {
    ...manifest.provider,
    localId: kind,
    apiUrl: `https://demodb.dev/ovdb/v1/databases/${kind}`,
    recordsets: [
      {
        name: contract.target.entity,
        modelEntity: contract.target.entity,
        fields: [{ name: contract.target.property }],
      },
    ],
  };
  const sourceModel = JSON.parse(content(contract.source.schema));
  const modelEntity = sourceModel.entities[contract.source.entity];
  const key = modelEntity.key[0];
  const table = kind === 'ror' ? 'affiliations' : 'input';
  const dataText =
    kind === 'ror'
      ? readFileSync(
          resolve(
            'libs/datatug/main/src/lib/queries/fixtures/public-data-fabric/affiliations.json',
          ),
          'utf8',
        )
      : '[{"id":"one","country_iso":"CA"}]';
  const data = await put(
    {
      ...contract.source.schema,
      path:
        kind === 'ror'
          ? contract.source.schema.path.replace(
              'affiliations.modelspec.json',
              'affiliations.json',
            )
          : 'source/input.json',
    },
    dataText,
  );
  const rawCatalog = {
    driver: 'https-json',
    label: 'Explicit hypothetical user affiliations',
    urlTemplate: immutableUrl(data).replace(`${table}.json`, '{table}.json'),
    keys: { [table]: key },
    sha256: { [table]: data.sha256 },
    sourceModel: {
      schema: contract.source.schema,
      module: contract.source.module,
      moduleId: sourceModel.module.id,
      tables: [
        {
          schema: '',
          name: table,
          entity: contract.source.entity,
          key,
          fields: Object.entries(modelEntity.properties).map(
            ([name, value]) => ({
              name,
              property: name,
              datatype: 'string',
              nullable: (value as { required?: boolean }).required !== true,
              ...(name === contract.source.property
                ? { namespace: contract.source.namespace }
                : {}),
            }),
          ),
        },
      ],
    },
  };
  const catalogText = JSON.stringify(rawCatalog);
  const parsed = parseHttpsJsonCatalog(catalogText, { trust: 'untrusted' });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const context: DeclaredCatalogContext = {
    configuration: await put(
      {
        repository: 'https://github.com/example/user-project',
        revision: 'c'.repeat(40),
        path: `environments/local/catalogs/${table}/${table}.db.json`,
        sha256: '0'.repeat(64),
      },
      catalogText,
    ),
    connection: {
      storeId: 'github.com',
      projectId: 'user-project@example@',
      id: `local/user/${table}`,
    },
    catalog: parsed.value,
  };
  // Canonical public target registration is unchanged; user schemas are not global registrations.
  const registries = resolve(
    'libs/datatug/main/src/lib/queries/fixtures/public-data-fabric/native/registries',
  );
  const models = JSON.parse(
    readFileSync(resolve(registries, 'models.json'), 'utf8'),
  ) as { format: string; models: MetadataObject[] };
  const meanings = JSON.parse(
    readFileSync(resolve(registries, 'meanings.json'), 'utf8'),
  );
  const indexRef = (name: string, revision: string): ImmutableFile => ({
    repository: `https://github.com/example/${name}`,
    revision,
    path: 'index.json',
    sha256: '0'.repeat(64),
  });
  async function publish(revision = 'a'.repeat(40)): Promise<CanonicalPins> {
    const attachment = await put(
      own('source/consumer-test-contract.json', '0'.repeat(64)),
      JSON.stringify(document),
    );
    provider['representation_contract'] = {
      path: attachment.path,
      sha256: attachment.sha256,
    };
    return {
      directory: await put(
        indexRef('directory', revision),
        JSON.stringify({
          format: 'ovdb-directory/draft-1',
          databases: [provider],
        }),
      ),
      models: await put(indexRef('models', revision), JSON.stringify(models)),
      meanings: await put(
        indexRef('meanings', revision),
        JSON.stringify(meanings),
      ),
    };
  }
  const http = vi.fn(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.redirect !== 'error')
        throw new Error('Metadata redirects must be refused.');
      const text = files.get(String(input));
      if (text === undefined)
        throw new Error(`Unexpected metadata request: ${String(input)}`);
      return new Response(text);
    },
  );
  const updateReceipt = async (change: (proof: MetadataObject) => void) => {
    const file = own(
      contract.native.provenance.path,
      contract.native.provenance.sha256,
    );
    const proof = JSON.parse(content(file));
    change(proof);
    const updated = await put(file, JSON.stringify(proof));
    Object.assign(contract.native.provenance, { sha256: updated.sha256 });
    const snapshotFile = own(
      contract.target.snapshot.path,
      contract.target.snapshot.sha256,
    );
    const snapshot = JSON.parse(content(snapshotFile));
    snapshot.artifacts.find(
      (a: { path: string }) => a.path === updated.path,
    ).sha256 = updated.sha256;
    Object.assign(contract.target.snapshot, {
      sha256: (await put(snapshotFile, JSON.stringify(snapshot))).sha256,
    });
  };
  return {
    contract,
    document,
    provider,
    context,
    data,
    models,
    files,
    own,
    put,
    publish,
    http,
    updateReceipt,
    manifest,
  };
}
