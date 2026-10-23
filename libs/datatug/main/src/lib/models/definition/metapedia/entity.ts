import { IOptionallyTitled } from '../../core';
import { IFieldCheckDef } from '../checks/field-checks';
import { DataType } from '../types';

export type EntityContentType = 'json' | 'csv' | 'xml';

export interface IEntity extends IOptionallyTitled {
  extends?: { def: string };
  fields: IEntityFieldDef[];
  /** Field IDs that let a person recognise a record (parameter-lookup REQ:display-columns). */
  display?: string[];
  sourceOfRecord?: {
    db: string;
    objType: 'table';
    objName: string;
  };
  options?: {
    sources?: {
      contentType: EntityContentType;
      url: string;
      source: string;
      mapping: Record<string, string>;
    }[];
  };
}

export interface IEntityFieldDef {
  readonly id: string;
  readonly type: DataType;
  readonly title?: string;
  /** Declared physical columns this field means (Core EntityField.Mappings). */
  readonly mappings?: readonly IPhysicalRef[];
  readonly namePattern?: { regexp: string } | { wildcard: string };
  readonly checks?: IFieldCheckDef[];
}

export interface IPhysicalRef {
  readonly source: string;
  readonly collection: string;
  readonly column: string;
}

export interface IEntityFieldRef {
  entity: string;
  field: string;
}
