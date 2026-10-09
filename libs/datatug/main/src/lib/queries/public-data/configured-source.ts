import type {
  DeclaredCatalogContext,
  VerifiedDeclaredSource,
} from './declared-source';
import type { ITableFull } from '../../models/definition/apis/database';
import {
  directoryRecordType,
  indexedFields,
  indexedRecordTypes,
} from './model-vocabulary';
import {
  array,
  exactFields,
  object,
  type CanonicalIndexes,
} from './canonical-metadata';
import {
  sameSource,
  type PublicDataSuggestion,
  type SourceField,
} from './representation-discovery';

export interface ConfiguredPublicSource {
  readonly id: string;
  readonly title: string;
  readonly environment: string;
  readonly catalog: string;
  readonly driver: string;
  readonly host: string;
  readonly tables?: readonly ITableFull[];
  readonly declaration?: DeclaredCatalogContext;
  readonly upstream?: {
    readonly repository: string;
    readonly revision: string;
  };
}
export interface ConfiguredFieldChoice {
  readonly id: string;
  readonly table: ITableFull;
  readonly property: string;
  readonly source?: SourceField;
  readonly context?: VerifiedDeclaredSource;
  readonly reason: string;
}

/** Connection identity and explicit modelEntity mapping, never a table-name guess. */
export function configuredFieldChoices(
  connection: ConfiguredPublicSource,
  tables: readonly ITableFull[],
  indexes: CanonicalIndexes,
  suggestions: readonly PublicDataSuggestion[],
): readonly ConfiguredFieldChoice[] {
  const unavailable = (reason: string): readonly ConfiguredFieldChoice[] =>
    tables.map((table) => ({
      id: `${table.schema}.${table.name}`,
      table,
      property: '',
      reason,
    }));
  const providers = array(indexes.directory['databases'], 'providers')
    .map((value) => object(value, 'provider'))
    .filter((provider) => {
      exactFields(provider, [
        'repository',
        'commit',
        'apiUrl',
        'id',
        'recordsets',
      ]);
      const explicitHost =
        connection.driver === 'ovdb' &&
        (connection.host === provider['apiUrl'] ||
          connection.host === provider['id']);
      const explicitUpstream =
        connection.upstream?.repository === provider['repository'] &&
        connection.upstream?.revision === provider['commit'];
      if (explicitHost && connection.upstream && !explicitUpstream)
        return false;
      return explicitHost || explicitUpstream;
    });
  if (providers.length !== 1)
    return unavailable(
      'This configured source has no exact canonical provider identity/revision. Its original upstream or table names cannot supply that provenance.',
    );
  const provider = providers[0];
  const models = array(indexes.models['models'], 'models')
    .map((value) => object(value, 'model'))
    .filter(
      (model) =>
        model['repository'] === provider['repository'] &&
        model['commit'] === provider['commit'],
    );
  if (models.length !== 1)
    return unavailable(
      'The exact provider revision has no unambiguous canonical ModelSpec registration.',
    );
  const model = models[0];
  const recordsets = array(provider['recordsets'], 'recordsets').map((value) =>
    object(value, 'recordset'),
  );
  const choices: ConfiguredFieldChoice[] = [];
  for (const table of tables) {
    const mappings = recordsets.filter(
      (set) =>
        set['name'] === table.name && (set['schema'] ?? '') === table.schema,
    );
    if (
      mappings.length !== 1 ||
      typeof directoryRecordType(mappings[0]) !== 'string'
    ) {
      choices.push({
        id: `${table.schema}.${table.name}`,
        table,
        property: '',
        reason:
          'No explicit canonical recordset-to-model entity mapping exists for this configured table.',
      });
      continue;
    }
    const entity = directoryRecordType(mappings[0]);
    const entities = array(indexedRecordTypes(model), 'registered entities')
      .map((value) => object(value, 'registered entity'))
      .filter((value) => value['name'] === entity);
    if (entities.length !== 1) {
      choices.push({
        id: `${table.schema}.${table.name}`,
        table,
        property: '',
        reason:
          'The explicit recordset modelEntity is absent or ambiguous in this pinned model.',
      });
      continue;
    }
    for (const value of array(
      indexedFields(entities[0]),
      'registered properties',
    )) {
      const property = object(value, 'registered property');
      if (property['type'] !== 'string' || typeof property['name'] !== 'string')
        continue;
      const physical = array(mappings[0]['fields'], 'canonical fields')
        .map((value) => object(value, 'canonical field'))
        .filter(
          (value) =>
            value['name'] === property['name'] && value['type'] === 'string',
        );
      if (
        physical.length !== 1 ||
        (table.columns &&
          !table.columns.some((column) => column.name === property['name']))
      ) {
        choices.push({
          id: `${table.schema}.${table.name}.${property['name']}`,
          table,
          property: property['name'],
          reason:
            'The exact model property has no unambiguous canonical raw string field in this configured recordset.',
        });
        continue;
      }
      const scopes = suggestions.flatMap((suggestion) => {
        const source = suggestion.contract?.source as SourceField | undefined;
        if (
          !source ||
          // Exact data must come from the selected checked catalog, never a suggestion.
          source.data !== undefined ||
          !suggestion.rights ||
          !suggestion.snapshot ||
          source.schema.repository !== provider['repository'] ||
          source.schema.revision !== provider['commit'] ||
          source.schema.path !==
            object(model['files'], 'model files')['json'] ||
          source.module !== model['module'] ||
          source.entity !== entity ||
          source.property !== property['name'] ||
          source.datatype !== 'string'
        )
          return [];
        return [source];
      });
      const unique = scopes.filter(
        (scope, i) =>
          !scopes.slice(0, i).some((prior) => sameSource(prior, scope)),
      );
      choices.push({
        id: `${table.schema}.${table.name}.${property['name']}`,
        table,
        property: property['name'],
        ...(unique.length === 1 ? { source: unique[0] } : {}),
        reason:
          unique.length === 1
            ? 'Source scope resolved from the configured provider identity, pinned model and verified representation metadata. Inspect its explanation before any lookup.'
            : 'This exact field has no unambiguous verified raw representation/namespace attachment at the pinned revisions. Lookup is unavailable.',
      });
    }
  }
  return choices;
}
