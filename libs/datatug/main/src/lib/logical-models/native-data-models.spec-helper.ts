import { vi } from 'vitest';
import {
  immutableUrl,
  sha256,
  type ImmutableFile,
  type MetadataObject,
} from '../queries/public-data/canonical-metadata';
import { nativeModelJSON } from './native-data-models-reader';

export const SHARED_REGISTRY = 'https://github.com/meaninggraph/registry';
export const A = 'a'.repeat(40),
  B = 'b'.repeat(40),
  C = 'c'.repeat(40);
export interface FixtureModel {
  readonly alias: string;
  readonly id?: string;
  readonly commit?: string;
  readonly original: MetadataObject;
  readonly native?: MetadataObject;
  readonly selected?: boolean;
  readonly locks?: readonly { alias: string; revision_id: string }[];
  readonly graph?: unknown;
}
export async function nativeFixture() {
  const texts = new Map<string, string>();
  const rows: MetadataObject[] = [],
    models: MetadataObject[] = [],
    receipts = new Map<string, MetadataObject>();
  const publisherPins: Record<string, string> = {};
  const at = (path: string): string =>
    immutableUrl({
      repository: SHARED_REGISTRY,
      revision: C,
      path,
      sha256: '0'.repeat(64),
    });
  const put = (path: string, value: string): void => {
    texts.set(at(path), value);
  };
  const artifact = async (path: string, value: string, mediaType: string) => {
    const digest = await sha256(value),
      artifactPath = `artifacts/sha256/${digest.slice(0, 2)}/${digest}`;
    put(artifactPath, value);
    return { path, sha256: digest, artifactPath, mediaType };
  };
  const retain = async (options: FixtureModel): Promise<string> => {
    const id = options.id ?? options.alias.toLowerCase(),
      sourceCommit = options.commit ?? A;
    const repository = `https://github.com/acme/${options.alias.toLowerCase()}`,
      address = `modelspec://github.com/acme/${options.alias.toLowerCase()}/${options.alias}`;
    const revisionId = await sha256(
      JSON.stringify([
        'meaninggraph-revision/v1',
        'model',
        address,
        sourceCommit,
      ]),
    );
    const module = options.original['module'] as MetadataObject;
    const hcl = `${options.alias}/model.modelspec.hcl`,
      json = `${options.alias}/model.modelspec.json`;
    const registration = {
      format: 'modelspec-registry/draft-1',
      title: `${options.alias} model`,
      status: 'draft',
      address,
      repository,
      commit: sourceCommit,
      module: options.alias,
      source_file: hcl,
      json_file: json,
      licence: 'MIT',
      maintainers: ['acme'],
    };
    const recordPath = `models/$records/${id}.yaml`;
    const source = await artifact(
      recordPath,
      JSON.stringify(registration),
      'application/yaml',
    );
    const files = [
      await artifact(
        hcl,
        '# Licence: MIT\nrecord "Example" {\n  field "id" { type = "uuid" }\n}\n',
        'application/hcl',
      ),
      await artifact(
        json,
        nativeModelJSON(options.original),
        'application/json',
      ),
      await artifact(
        'LICENSE',
        'MIT License fixture attribution\n',
        'text/plain',
      ),
    ];
    const defPath = `definitions/${revisionId}.json`,
      definition = {
        format: 'meaninggraph-definition/draft-1',
        kind: 'model',
        revision_id: revisionId,
        ast: options.native ?? options.original,
        ...(options.graph ? { graph: options.graph } : {}),
      };
    const defText = nativeModelJSON(definition);
    put(defPath, defText);
    const defRef = { path: defPath, sha256: await sha256(defText) };
    const receipt = {
      format: 'meaninggraph-revision/draft-1',
      kind: 'model',
      id: revisionId,
      registry_id: id,
      address,
      repository,
      commit: sourceCommit,
      source_record: { repository: SHARED_REGISTRY, commit: C, ...source },
      module,
      format_identifier: options.original['modelspec'],
      source_paths: { hcl, json },
      files,
      definition: defRef,
      dependency_pins: options.locks ?? [],
      licences: { model: 'MIT' },
      maintainers: ['acme'],
      logical_digest: {
        algorithm: 'meaninggraph-logical-digest/v1',
        sha256: 'd'.repeat(64),
      },
    };
    const receiptPath = `revisions/$records/${revisionId}.yaml`;
    put(receiptPath, nativeModelJSON(receipt));
    receipts.set(revisionId, receipt);
    rows.push({
      kind: 'model',
      id: revisionId,
      address,
      commit: sourceCommit,
      path: receiptPath,
    });
    if (options.selected !== false) {
      models.push({
        ...registration,
        id,
        revision_id: revisionId,
        module_id: module['id'],
        module_version: module['version'],
        files: { source: hcl, json },
        definition: defRef,
      });
      publisherPins[repository] = sourceCommit;
    }
    return revisionId;
  };
  const publish = async (
    meanings: readonly MetadataObject[] = [],
  ): Promise<ImmutableFile> => {
    const indexText = nativeModelJSON({
      format: 'meaninggraph-revision-index/draft-1',
      revisions: rows,
    });
    put('revisions/index.json', indexText);
    const body = {
      format: 'meaninggraph-catalog/draft-1',
      models,
      graphs: meanings,
      source_revisions: publisherPins,
      revision_index: {
        path: 'revisions/index.json',
        sha256: await sha256(indexText),
      },
    };
    const catalog = nativeModelJSON({
      ...body,
      checksum: `sha256:${await sha256(nativeModelJSON(body))}`,
    });
    put('catalog.json', catalog);
    return {
      repository: SHARED_REGISTRY,
      revision: C,
      path: 'catalog.json',
      sha256: await sha256(catalog),
    };
  };
  const http = vi.fn<typeof fetch>(async (input, init) => {
    if (init?.signal?.aborted) throw init.signal.reason;
    const text = texts.get(String(input));
    return text === undefined
      ? new Response('missing', { status: 404 })
      : new Response(text);
  });
  return {
    texts,
    rows,
    models,
    receipts,
    publisherPins,
    at,
    put,
    retain,
    publish,
    http,
  };
}
export function modelAST(
  alias: string,
  records: MetadataObject = {},
  components: MetadataObject = {},
  enums: MetadataObject = {},
): MetadataObject {
  return {
    modelspec: '1.0-draft-2',
    module: {
      id: `github.com/acme/${alias.toLowerCase()}/model`,
      name: alias,
      version: '1.0.0',
    },
    ...(Object.keys(components).length ? { components } : {}),
    ...(Object.keys(enums).length ? { enums } : {}),
    records,
  };
}
