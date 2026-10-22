import { IProjectRef } from '../../core/project-context';
import { IEnvironmentFull } from './environments';

/** Exact requested qualifiers stay intact; resolved authority is additional. */
export interface EnvironmentScope extends IProjectRef {
  readonly authorityId: string;
  readonly resolvedBranch?: string;
  readonly repositoryId?: number;
  readonly owner?: string;
  readonly repository?: string;
  readonly folder?: string;
}
export interface EnvironmentCapabilities {
  readonly canReadOrder: boolean;
  readonly canWriteOrder: boolean;
  readonly canCreateEnvironment: boolean;
  readonly reasons?: Partial<Record<'canReadOrder' | 'canWriteOrder' | 'canCreateEnvironment', string>>;
}
export interface EnvironmentState {
  readonly contract: 'environment-state/1';
  readonly scope: EnvironmentScope;
  readonly scopeBinding: string;
  readonly environments: readonly IEnvironmentFull[];
  readonly savedOrder: readonly string[] | null;
  readonly order: readonly string[];
  readonly needsRepair: boolean;
  readonly revision: string;
  readonly capabilities: EnvironmentCapabilities;
}
export interface EnvironmentMutation {
  readonly scope: EnvironmentScope;
  readonly ifRevision: string;
  readonly operationId: string;
}
export interface CreateEnvironmentRequest extends EnvironmentMutation { readonly name: string }
export interface SaveEnvironmentOrderRequest extends EnvironmentMutation { readonly environmentOrder: readonly string[] }
export interface EnvironmentOperationResult {
  readonly operationId: string;
  readonly kind: 'create-environment' | 'save-environment-order';
  readonly payloadDigest: string;
  readonly acceptedAt: string;
  readonly replayUntil: string;
  readonly environmentId?: string;
  readonly environmentOrder?: readonly string[];
  readonly afterStateDigest: string;
  readonly status: 'pending' | 'committed' | 'expired' | 'unresolved';
}
