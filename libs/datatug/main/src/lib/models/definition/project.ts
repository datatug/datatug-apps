import { Board } from '@datatug/board-models';
import { IStore } from './store';
import { IEnvironmentFull } from './environments';
import { IDbModelFull } from './dbmodels';
import { IProjDbServerFull } from './apis/database';
import { IParameterDef } from './parameter';

export type ProjectAccess = 'private' | 'protected' | 'public';

export enum ProjectItem {
  agent = 'agent',
  dbModel = 'dbModel',
  environment = 'environment',
  entity = 'entity',
  Board = 'board',
  query = 'query',
  variable = 'variable',
}

export type ProjectItemType = `${ProjectItem}`;

export interface IProjectBase {
  id: string;
  title: string;
  access: ProjectAccess;
}

export interface IProjectFull extends IProjectBase {
  readonly boards?: readonly Board[];
  environments?: IEnvironmentFull[];
  dbModels?: IDbModelFull[];
  /** Legacy project-full response shape retained for older agents. */
  dbServers?: IProjDbServerFull[];
  /** Current datatug.Project wire shape returned by project_full. */
  dbDrivers?: readonly {
    readonly id: string;
    readonly servers?: readonly {
      readonly id?: string;
      readonly server: import('./apis/database').IDbServer;
      readonly tags?: string[];
      readonly catalogs?: readonly unknown[];
    }[];
  }[];
}

export interface IProjectSummary extends IProjectBase {
  readonly boards?: IProjBoard[];
  readonly dbModels?: IProjDbModelBrief[];
  readonly entities?: IProjEntity[];
  readonly environments?: IProjEnv[];
  readonly agents?: IStore[];
  readonly tags?: Record<string, number>;
  readonly default?: {
    readonly agent?: string;
  };
}

export interface IProjItemBrief {
  tags?: string[];
  id: string;
  title?: string;
}

export interface IProjItemsFolder {
  id: string;
  folders?: IProjItemsFolder[];
  items?: IProjItemBrief[];
}

// Mirrors `ProjBoardBrief` (datatug-core's boards.go) field for field:
// `ProjItemBrief` + `parameters` + `requiredParams`.
export interface IProjBoard extends IProjItemBrief {
  parameters?: IParameterDef[];
  requiredParams?: string[][];
}

export interface IProjDbModelBrief extends IProjItemBrief {
  numberOf?: IProjDbModelNumbers;
}

export interface IProjDbModelNumbers {
  schemas?: number;
  tables?: number;
  views?: number;
}

export type IProjEntity = IProjItemBrief;

export type IProjEnv = IProjItemBrief;

export interface IProjectApp {
  id: string;
  name: string;
}

export interface IApiDefinition {
  type: 'web' | 'db';
  id: string;
  title?: string;
  tags?: string[];
  endpointPattern?: string;
  server?: { host: string; port: number };
}

export type FieldType = string | number;

export type IDefaultValues = Record<string, Record<string, FieldType>>;
