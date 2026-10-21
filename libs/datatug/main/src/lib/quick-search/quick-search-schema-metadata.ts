export interface SchemaIndexColumn {
  name: string;
  tags?: string[];
}
export interface SchemaIndexTable {
  name: string;
  Columns?: SchemaIndexColumn[];
  tags?: string[];
}
export interface SchemaIndexModel {
  id: string;
  title?: string;
  schemas?: {
    id: string;
    tables?: SchemaIndexTable[];
    views?: SchemaIndexTable[];
  }[];
}

type Metadata = Record<string, unknown>;
function object(value: unknown): Metadata {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid schema metadata');
  return value as Metadata;
}
/** Go's known field casing is accepted; ambiguous aliases are never merged. */
function field(value: Metadata, key: string): unknown {
  const keys = Object.keys(value).filter(
    (k) => k.toLowerCase() === key.toLowerCase(),
  );
  if (keys.length > 1) throw new Error('Ambiguous schema metadata');
  return keys.length ? value[keys[0]] : undefined;
}
function text(value: unknown, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string') throw new Error('Invalid schema name');
  return value;
}
function array(value: unknown, optional = false): unknown[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) throw new Error('Invalid schema inventory');
  return value;
}
function tags(value: Metadata): { tags: string[] } {
  return {
    tags: array(field(value, 'tags'), true).map((v) => text(v) as string),
  };
}
function unique<T>(items: T[], id: (item: T) => string): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    const key = id(item);
    if (seen.has(key)) throw new Error('Duplicate schema identity');
    seen.add(key);
  }
  return items;
}
export function schemaColumns(value: unknown): SchemaIndexColumn[] {
  return unique(
    array(value).map((v) => {
      const item = object(v),
        name = text(field(item, 'name')) as string;
      if (!name) throw new Error('Missing column name');
      return { name, ...tags(item) };
    }),
    (c) => c.name,
  );
}
export function schemaTableMetadata(
  name: string,
  value: unknown,
): SchemaIndexTable {
  const item = object(value);
  return {
    name,
    Columns: schemaColumns(field(item, 'columns')),
    ...tags(item),
  } as SchemaIndexTable;
}
/** Copies only indexable metadata. An absent schemas field is a descriptor, not an empty model. */
export function inlineSchemaModel(
  value: unknown,
  id: string,
): SchemaIndexModel | undefined {
  const item = object(value),
    actualId = text(field(item, 'id'), true),
    title = text(field(item, 'title'), true);
  if (actualId !== undefined && actualId !== id)
    throw new Error('Conflicting model identity');
  const schemas = field(item, 'schemas');
  if (schemas === undefined) return undefined;
  return {
    id,
    ...(title !== undefined ? { title } : {}),
    schemas: unique(
      array(schemas).map((v) => {
        const schema = object(v),
          schemaId = text(field(schema, 'id')) as string;
        const tables = (key: string) =>
          unique(
            array(field(schema, key), true).map((v) => {
              const table = object(v),
                name = text(field(table, 'name')) as string;
              if (!name) throw new Error('Missing table name');
              return {
                name,
                Columns:
                  field(table, 'columns') === undefined
                    ? []
                    : schemaColumns(field(table, 'columns')),
                ...tags(table),
              } as SchemaIndexTable;
            }),
            (t) => t.name,
          );
        return {
          id: schemaId,
          tables: tables('tables'),
          views: tables('views'),
        };
      }),
      (s) => s.id,
    ),
  };
}
