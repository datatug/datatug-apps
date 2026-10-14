import {
  parseHttpsJsonCatalog,
  tableUrls,
  type HttpsJsonCatalog,
} from '../../project-files/https-json-catalog';
import type {
  SourceModelField,
  SourceModelTable,
} from '../../project-files/source-model-declaration';
import {
  array,
  exactFields,
  immutableUrl,
  object,
  string,
  type CanonicalMetadataReader,
  type ImmutableFile,
} from './canonical-metadata';
import { normalizeModel } from './model-vocabulary';
import type { SourceField } from './representation-discovery';

export interface DeclaredCatalogContext {
  readonly configuration: ImmutableFile;
  readonly connection: {
    readonly storeId: string;
    readonly projectId: string;
    readonly id: string;
  };
  readonly catalog: HttpsJsonCatalog;
}
export interface VerifiedDeclaredSource {
  readonly kind: 'declared-https-json';
  readonly configuration: ImmutableFile;
  readonly connection: DeclaredCatalogContext['connection'];
  readonly source: SourceField;
  readonly moduleId: string;
  readonly table: SourceModelTable;
  readonly field: SourceModelField;
  readonly data: ImmutableFile;
}
export function immutableDataFile(url: string, hash: string): ImmutableFile {
  const matched =
    /^https:\/\/raw\.githubusercontent\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/([a-f0-9]{40})\/(.+)$/.exec(
      url,
    );
  if (!matched)
    throw new Error(
      'Declared source data must have an immutable, credential-free GitHub URL.',
    );
  const file = {
    repository: `https://github.com/${matched[1]}`,
    revision: matched[2],
    path: matched[3],
    sha256: hash,
  };
  if (immutableUrl(file) !== url)
    throw new Error(
      'Declared source data URL differs from its exact Git identity.',
    );
  return file;
}
/** Uses the same aggregate metadata operation as canonical target discovery; no row reads. */
export async function verifyDeclaredCatalog(
  input: DeclaredCatalogContext,
  reader: CanonicalMetadataReader,
): Promise<readonly VerifiedDeclaredSource[]> {
  const configurationUrl = immutableUrl(input.configuration);
  const parsed = parseHttpsJsonCatalog(await reader.text(input.configuration), {
    trust: 'untrusted',
  });
  if (!parsed.ok || !parsed.value.sourceModel)
    throw new Error(
      'An exact validated project sourceModel declaration is required.',
    );
  if (JSON.stringify(parsed.value) !== JSON.stringify(input.catalog))
    throw new Error(
      'Selected catalog differs from its checked configuration pin.',
    );
  const catalog = parsed.value,
    declaration = catalog.sourceModel;
  if (!declaration) throw new Error('Missing source declaration.');
  const model = normalizeModel(
    await reader.json(declaration.schema, [configurationUrl]),
  );
  exactFields(model, ['modelspec', 'module', 'entities']);
  const module = object(model['module'], 'declared module');
  exactFields(module, ['name', 'id']);
  if (
    model['modelspec'] !== '1.0-draft' ||
    module['name'] !== declaration.module ||
    module['id'] !== declaration.moduleId
  )
    throw new Error('Declared source module/name/id mismatch.');
  const entities = object(model['entities'], 'declared entities'),
    result: VerifiedDeclaredSource[] = [];
  for (const table of declaration.tables) {
    const entity = object(entities[table.entity], 'declared entity');
    exactFields(entity, ['key', 'properties']);
    const properties = object(entity['properties'], 'declared properties'),
      key = array(entity['key'], 'declared grain/key');
    const keyField = table.fields.find((field) => field.name === table.key);
    if (
      !keyField ||
      key.length !== 1 ||
      key[0] !== keyField.property ||
      keyField.nullable ||
      catalog.keys[table.name] !== table.key
    )
      throw new Error(
        'Declared physical key differs from the exact model grain.',
      );
    for (const field of table.fields) {
      const property = object(properties[field.property], 'declared property');
      exactFields(property, ['type', 'required']);
      if (
        property['type'] !== field.datatype ||
        (property['required'] === true) !== !field.nullable
      )
        throw new Error(
          'Declared physical datatype/optionality differs from source model.',
        );
    }
    const url = tableUrls(catalog, table.name, 'untrusted').primary;
    if (!url.ok)
      throw new Error(`Unsafe declared source table URL: ${url.problem}`);
    const data = immutableDataFile(
      url.url.href,
      string(catalog.sha256[table.name], 'declared source checksum'),
    );
    for (const field of table.fields)
      if (field.namespace !== undefined) {
        result.push({
          kind: 'declared-https-json',
          configuration: input.configuration,
          connection: input.connection,
          source: {
            schema: declaration.schema,
            data,
            module: declaration.module,
            entity: table.entity,
            property: field.property,
            datatype: 'string',
            namespace: field.namespace,
          },
          moduleId: declaration.moduleId,
          table,
          field,
          data,
        });
      }
  }
  return result;
}
