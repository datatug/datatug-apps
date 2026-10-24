import type { SessionScope } from '../session-context/session-context-contract';
import type {
  WatchObservation,
  WatchNotification,
  WatchDelivery,
} from '../watch/watch.models';
import type {
  WorkCapabilities,
  WorkDraft,
  WorkEnvironment,
  WorkItem,
  WorkMember,
  WorkScope,
} from './work.models';

export interface WorkWatchEvent {
  id: string;
  namespace: string;
  project: string;
  environment: string;
  watchId: string;
  runId: string;
  title: string;
  kind: 'trigger' | 'recovery';
  outcome: string;
  previous: string;
  occurredAt: string;
  checkId: string;
  checkRunRef?: string;
}
export interface WorkWatchContextPreview {
  eventId: string;
  scope: SessionScope;
  entries: { label: string; value: unknown }[];
  omitted: string[];
  requiresSharing?: boolean;
}
export interface WorkWatchPage {
  watches: {
    id: string;
    title: string;
    version: number;
    owner: string;
    visibility: string;
    checkId: string;
    workCheckId?: string;
    namespace: string;
    project: string;
    environment: string;
    mode: string;
    lifecycle: string;
    enabled: boolean;
    observation?: WatchObservation;
  }[];
  events: WorkWatchEvent[];
  linkedItems: WorkItem[];
  capabilities: WorkCapabilities;
  environments: WorkEnvironment[];
  members: WorkMember[];
  contexts: WorkWatchContextPreview[];
  observations?: WatchObservation[];
  notifications?: WatchNotification[];
  deliveries?: WatchDelivery[];
}
export interface WorkWatchAction extends WorkScope {
  operationId: string;
  action: 'create' | 'link' | 'sync';
  watchId: string;
  eventId?: string;
  sharePersonal: boolean;
  draft?: WorkDraft;
  itemId?: string;
  expectedVersion?: number;
}
