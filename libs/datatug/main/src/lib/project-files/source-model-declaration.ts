import Ajv2020 from 'ajv/dist/2020';
import schema from './schemas/https-json-catalog.schema.json';
import type { ImmutableFile } from '../queries/public-data/canonical-metadata';
import type { ProblemCollector } from './project-file-problems';

export interface SourceModelField {
  readonly name: string;
  readonly property: string;
  readonly datatype: 'string';
  readonly nullable: boolean;
  readonly namespace?: string;
}
export interface SourceModelTable {
  readonly schema: string;
  readonly name: string;
  readonly entity: string;
  readonly key: string;
  readonly fields: readonly SourceModelField[];
}
/** User declaration, cross-checked against bytes and a contract; never admission. */
export interface SourceModelDeclaration {
  readonly schema: ImmutableFile;
  readonly module: string;
  readonly moduleId: string;
  readonly tables: readonly SourceModelTable[];
}
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
  schema.properties.sourceModel,
);
export function checkSourceModel(
  raw: unknown,
  problems: ProblemCollector,
): SourceModelDeclaration | undefined {
  if (!validate(raw)) {
    for (const error of validate.errors ?? [])
      problems.add(
        `/sourceModel${error.instancePath}`,
        'type',
        error.message ?? 'Invalid source declaration.',
      );
    return undefined;
  }
  const value = raw as unknown as SourceModelDeclaration;
  const tables = new Set<string>();
  for (const table of value.tables) {
    const id = JSON.stringify([table.schema, table.name]);
    const fields = new Set<string>(),
      properties = new Set<string>();
    if (tables.has(id))
      problems.add(
        '/sourceModel/tables',
        'duplicate',
        'Duplicate physical table mapping.',
      );
    tables.add(id);
    for (const field of table.fields) {
      if (fields.has(field.name) || properties.has(field.property))
        problems.add(
          '/sourceModel/tables',
          'duplicate',
          'Duplicate field/property mapping.',
        );
      fields.add(field.name);
      properties.add(field.property);
    }
  }
  return value;
}
