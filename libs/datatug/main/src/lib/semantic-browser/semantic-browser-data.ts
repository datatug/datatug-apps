import type { TypedValue } from '@sneat/datatug-semantic';

export interface NativeColumn {
  name: string;
  type: string;
  nullable: boolean;
}
export interface NativeCollection {
  name: string;
  kind: string;
  columns: NativeColumn[];
  primaryKey?: { columns: string[] };
  foreignKeys: {
    columns: string[];
    collection: string;
    referencedColumns: string[];
  }[];
}
export interface NativeSchema {
  schemaToken: string;
  source: {
    sourceId: string;
    environment: string;
    generation: string;
    revision: number;
    sha256: string;
    bindingRevision: number;
    schemaSHA256: string;
  };
  collections: NativeCollection[];
}
export interface NativeRows {
  schemaToken: string;
  collection: string;
  columns: NativeColumn[];
  rows: { rowToken: string; cells: TypedValue[] }[];
  truncated: boolean;
}

export interface NativeSelection {
  schemaToken: string;
  collection: string;
  rowToken: string;
  column: string;
}

export interface NativeResolution {
  column: string;
  value: TypedValue;
  entity?: string;
  field?: string;
  provenance?: 'declared' | 'inferred';
  rule?: string;
}
export interface NativeLookup {
  sourceId: string;
  collection: string;
  column: string;
  kind: 'sameField' | 'foreignKey' | 'referencedBy';
  via: string;
}
export interface NativeRelated {
  selection: NativeSelection;
  lookups: NativeLookup[];
  unsupported: string[];
}
export interface CanonicalEntity {
  id: string;
  title?: string;
  fields: {
    id: string;
    type: string;
    mappings?: { source: string; collection: string; column: string }[];
  }[];
}
export interface EntitySnapshot {
  entity: CanonicalEntity;
  revision?: string;
  revisionError?: string;
}
