import {
  array,
  exactFields,
  object,
  string,
  type CanonicalMetadataReader,
  type ImmutableFile,
  type MetadataObject,
  immutableUrl,
} from './canonical-metadata';
import { normalizeModel } from './model-vocabulary';
import { JsonNumberToken, strictJson, strictJsonNumbers } from './strict-json';
import type {
  NativeRepresentationContract,
  Reference,
  SourceFacts,
} from './representation-discovery';

function closed(
  value: unknown,
  fields: readonly string[],
  description: string,
): MetadataObject {
  const record = object(value, description);
  if (Object.keys(record).sort().join(',') !== [...fields].sort().join(','))
    throw new Error(`Invalid closed ${description}.`);
  return record;
}
function sameRef(value: unknown, ref: Reference): boolean {
  const record = closed(value, ['path', 'sha256'], 'native reference');
  return (
    record['path'] === ref.path &&
    record['sha256'] === ref.sha256 &&
    ref.repository === undefined &&
    ref.revision === undefined
  );
}
function int64(value: unknown): bigint {
  if (
    !(value instanceof JsonNumberToken) ||
    !/^-?(0|[1-9][0-9]*)$/.test(value.token)
  )
    throw new Error('Native count must be an exact JSON integer.');
  const count = BigInt(value.token);
  if (count < 0n || count > 9223372036854775807n)
    throw new Error('Native count exceeds nonnegative int64.');
  return count;
}
/** Object order is immaterial; array order and every numeric token remain exact. */
export function equalReceiptValues(left: unknown, right: unknown): boolean {
  if (left instanceof JsonNumberToken || right instanceof JsonNumberToken)
    return (
      left instanceof JsonNumberToken &&
      right instanceof JsonNumberToken &&
      left.token === right.token
    );
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalReceiptValues(value, right[index]))
    );
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = left as MetadataObject,
      b = right as MetadataObject;
    const keys = Object.keys(a).sort();
    const other = Object.keys(b).sort();
    return (
      keys.length === other.length &&
      keys.every(
        (key, index) =>
          key === other[index] && equalReceiptValues(a[key], b[key]),
      )
    );
  }
  return left === right;
}

/** Mirror the landed helper's metadata association. Never resolves a dataset or key corpus. */
export async function verifyNativeReceipt(
  contract: NativeRepresentationContract,
  model: MetadataObject,
  metadata: MetadataObject,
  reader: CanonicalMetadataReader,
  own: (ref: Reference) => ImmutableFile,
  ancestry: readonly string[],
): Promise<SourceFacts> {
  const { target, native } = contract;
  if (contract.source.namespace !== target.namespace)
    throw new Error('Native namespaces must be byte-exact equal.');
  own(native.dataset);
  own(native.provenance);
  const entity = object(
    object(normalizeModel(model)['entities'], 'native entities')[target.entity],
    'native entity',
  );
  exactFields(entity, ['key', 'properties']);
  const key = array(entity['key'], 'native key');
  const properties = object(entity['properties'], 'native properties');
  if (
    key.length !== 1 ||
    key[0] !== target.property ||
    object(properties[target.property], 'native property')['required'] !== true
  )
    throw new Error(
      'Native target must declare this required single-property key.',
    );
  if (native.serving_identity_column) {
    if (
      native.serving_identity_column === target.property ||
      !properties[native.serving_identity_column]
    )
      throw new Error(
        'Native serving identity must be a separately declared property.',
      );
  }
  const proofText = await reader.text(own(native.provenance), ancestry);
  const proof = object(strictJsonNumbers(proofText), 'native provenance');
  exactFields(proof, ['native_key', 'snapshot', 'snapshot_association']);
  const receipt = closed(
    proof['native_key'],
    [
      'module',
      'entity',
      'property',
      'namespace',
      'model',
      'binding',
      'dataset',
      'records',
      'duplicates',
    ],
    'native key receipt',
  );
  if (
    receipt['module'] !== target.module ||
    receipt['entity'] !== target.entity ||
    receipt['property'] !== target.property ||
    receipt['namespace'] !== target.namespace ||
    !sameRef(receipt['model'], target.model) ||
    !sameRef(receipt['binding'], target.binding.document) ||
    !sameRef(receipt['dataset'], native.dataset) ||
    int64(receipt['duplicates']) !== 0n
  )
    throw new Error(
      'Native generation scope/model/binding/data/uniqueness mismatch.',
    );
  const records = int64(receipt['records']);
  let original = object(proof['snapshot'], 'original snapshot');
  exactFields(original, ['outputs', 'counts']);
  if (proof['snapshot_association'] !== undefined) {
    const association = closed(
      proof['snapshot_association'],
      ['source', 'output_key'],
      'snapshot association',
    );
    const ref = closed(
      association['source'],
      ['path', 'sha256'],
      'original snapshot reference',
    );
    const path = string(ref['path'], 'original snapshot path');
    const selector = string(
      association['output_key'],
      'literal snapshot output selector',
    );
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(selector) ||
      [
        native.provenance.path,
        target.snapshot.path,
        native.dataset.path,
      ].includes(path)
    )
      throw new Error(
        'Unsafe original snapshot association selector/reference.',
      );
    const reference = {
      path,
      sha256: string(ref['sha256'], 'original snapshot hash'),
    };
    if (
      !array(metadata['artifacts'], 'artifact closure').some((value) => {
        const artifact = object(value, 'artifact');
        return (
          artifact['path'] === reference.path &&
          artifact['sha256'] === reference.sha256
        );
      })
    )
      throw new Error('Original snapshot is outside checked artifact closure.');
    const originalText = await reader.text(own(reference), [
      ...ancestry,
      immutableUrl(own(native.provenance)),
    ]);
    const external = object(
      strictJsonNumbers(originalText),
      'exact original snapshot',
    );
    if (!equalReceiptValues(external, original))
      throw new Error(
        'Embedded snapshot differs from exact original values/number tokens.',
      );
    original = external;
    exactFields(original, ['outputs', 'counts']);
    const descriptor = object(
      object(original['outputs'], 'original outputs')[selector],
      'literal selected output descriptor',
    );
    exactFields(descriptor, ['file', 'sha256']);
    if (
      descriptor['file'] !== native.dataset.path ||
      descriptor['sha256'] !== native.dataset.sha256
    )
      throw new Error(
        'Original descriptor does not bind native dataset file/hash.',
      );
  } else {
    const outputs = object(original['outputs'], 'original outputs');
    for (const value of Object.values(outputs))
      exactFields(object(value, 'output descriptor'), ['sha256']);
    if (
      object(outputs[native.dataset.path], 'path-keyed original output')[
        'sha256'
      ] !== native.dataset.sha256
    )
      throw new Error('Original snapshot does not bind native dataset hash.');
  }
  if (
    int64(object(original['counts'], 'original counts')[target.entity]) !==
    records
  )
    throw new Error('Original native entity count mismatch.');
  // Supported receipt facts are descriptive source evidence, never admission or semantic truth.
  const ordinary = object(
    strictJson(proofText),
    'native descriptive provenance',
  );
  const snapshot = object(ordinary['snapshot'], 'descriptive source snapshot');
  const source =
    snapshot['source'] && typeof snapshot['source'] === 'object'
      ? object(snapshot['source'], 'release source')
      : undefined;
  if (source)
    exactFields(source, [
      'release',
      'release_date',
      'fetch_time',
      'source_record_url',
      'metadata_license',
      'embedded_geonames_license',
    ]);
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length <= 4096 ? value : undefined;
  const inputs =
    snapshot['sources'] === undefined
      ? []
      : Object.values(object(snapshot['sources'], 'source receipts')).map(
          (value) => object(value, 'source receipt'),
        );
  for (const input of inputs)
    exactFields(input, ['licence', 'url', 'fetched_at', 'last_modified']);
  const licences = [
    ...new Set(
      [
        source?.['metadata_license'],
        source?.['embedded_geonames_license'],
        ...inputs.map((input) => input['licence']),
      ].filter((value): value is string => typeof value === 'string'),
    ),
  ];
  return {
    release: text(source?.['release']),
    releaseDate: text(source?.['release_date']),
    retrievedAt: text(source?.['fetch_time']),
    sourceUrl: text(source?.['source_record_url']),
    records: records.toString(),
    inputs: inputs.map((input) => ({
      url: text(input['url']),
      retrievedAt: text(input['fetched_at']),
      modifiedAt: text(input['last_modified']),
      licence: text(input['licence']),
    })),
    coverage: `Generated source receipt records ${records.toString()} ${target.entity}; input membership and current completeness are not established.`,
    confidence:
      'Byte and structural compatibility only; semantic and runtime admission unavailable.',
    sourceLicences: licences,
  };
}
