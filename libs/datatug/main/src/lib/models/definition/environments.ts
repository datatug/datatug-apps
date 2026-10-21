import { ITagged } from '../tags';
import { IDbServer } from './apis/database';

export type EnvironmentTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger';

/** Optional display metadata; route IDs retain their original meaning. */
export interface IEnvironmentPresentation {
  label?: string;
  icon?: string;
  tone?: EnvironmentTone;
}

export interface IEnvironmentBase {
  presentation?: IEnvironmentPresentation;
  id: string;
  title: string;
  access?: string;
}

export interface IEnvironmentFull extends IEnvironmentBase {
  /** Current environment wire shape. */
  dbServers?: IEnvDbServer[];
  /** Older clients used the singular key. */
  dbServer?: IEnvDbServer[];
}

export interface IEnvironmentSummary extends IEnvironmentBase {
  vars?: Record<string, string>;
  connections?: Record<string, IConnection>;
  dbServers?: IEnvDbServer[];
  editionConnections?: string[];
}

export interface IEnvDbServer extends IDbServer {
  id: string;
  title?: string;
  catalogs?: string[];
}

export interface IProjectEnv {
  webAPIs?: Record<string, IWebApiEnv>;
}

export interface IWebApiEnv {
  protocol: 'http' | 'https';
  host: string;
  basePath?: string;
}

export interface IConnection extends ITagged {
  host: string;
  type: 'SQL';
  kind: 'MSSQL' | 'MySQL' | 'Oracle';
  port?: string;
  user?: string;
  database?: string;
  dataTugSchema?: string;
  integratedSecurity?: boolean | 'SSPI';
}

export interface IConnectionWithName extends IConnection {
  name?: string;
}
