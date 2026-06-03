import {
  IAlternateKey,
  IColumn,
  IForeignKey,
  IIndex,
  IPrimaryKey,
  IReferencedBy,
} from './apis/database';

export interface IDbModelBase {
  id: string;
  title?: string;
}

export interface IDbModelFull extends IDbModelBase {
  schemas?: ISchemaModel[];
}

export interface ISchemaModel {
  id: string;
  title?: string;
  tables?: ITableModel[];
  views?: ITableModel[];
}

/**
 * Persisted DB-model table as stored in `dbmodels/<id>.dbmodel.json`.
 *
 * Mirrors the DataTug CLI `TableModel`. All relationship/index fields are
 * optional & additive (omitempty on the CLI side), so older project files
 * without them must keep rendering unchanged.
 *
 * NOTE: `Columns` is intentionally capitalised — a pre-existing CLI
 * serialization quirk — while every other field is lower-camelCase.
 */
export interface ITableModel {
  name: string;
  schema?: string;
  type?: 'table' | 'view' | string;
  dbType?: 'BASE TABLE' | 'VIEW' | string;
  Columns?: IColumn[];
  primaryKey?: IPrimaryKey;
  foreignKeys?: IForeignKey[];
  referencedBy?: IReferencedBy[];
  indexes?: IIndex[];
  alternateKeys?: IAlternateKey[];
}
