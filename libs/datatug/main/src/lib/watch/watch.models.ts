import type { DetectiveInputValue } from '../detective/models';

export type WatchChannel = 'in_app' | 'email' | 'sms' | 'telegram';
export interface WatchIdentity {
  hosted?: boolean;
  spaceID?: string;
  canManageRunners?: boolean;
  id: string;
  namespace: string;
  project: string;
  environment: string;
  sharedEditor: boolean;
  tier: string;
  telegramConnected?: boolean;
  channels: Record<WatchChannel, boolean>;
  providers?: { email?: boolean; sms?: boolean };
  coordination?: { endpoint: string; namespace: string } | null;
  limits: {
    emailPerDay: number;
    emailPerMinute?: number;
    smsPerDay: number;
    smsPerMinute?: number;
    telegramPerDay?: number;
    telegramPerMinute?: number;
    watchesPerUser?: number;
    minIntervalSeconds?: number;
  };
}
export interface WatchHostedScope {
  spaceID: string;
  project: string;
  environment: string;
  principal: string;
}
export interface WatchRunnerEnrollment {
  id: string;
  scope: { namespace: string; project: string; environment: string };
  ownerId: string;
  capabilities: string[];
  sourceIDs: string[];
  telegramBotId?: string;
  revision: number;
  revoked: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
export interface WatchRunnerSource {
  id: string;
  kind: string;
  origin?: string;
  database?: string;
  collection?: string;
  sourceId?: string;
}
export interface WatchDefinition {
  id: string;
  version: number;
  title: string;
  sourceFingerprint?: string;
  namespace: string;
  project: string;
  environment: string;
  owner: string;
  visibility: 'personal' | 'shared';
  checkId: string;
  checkVersion?: string;
  inputs?: Record<string, DetectiveInputValue>;
  schedule: { intervalSeconds: number };
  trigger: 'becomes_true' | 'becomes_false' | 'changes';
  initialObservation: 'notify' | 'baseline';
  mode: 'one_shot' | 'continuous';
  lifecycle: 'enabled' | 'paused' | 'completed' | 'deleted';
  enabled: boolean;
  requirements?: string[];
  notificationPolicy: { cooldownSeconds?: number; recovery: boolean };
  createdAt: string;
  updatedAt: string;
}
export interface WatchObservation {
  watchId: string;
  value: 'true' | 'false' | 'unknown' | 'never';
  lastKnown: string;
  lastRunId?: string;
  lastObservedAt?: string;
  nextEvaluation: string;
  availability: string;
}
export interface WatchRun {
  id: string;
  watchId: string;
  state: string;
  dueAt: string;
  finishedAt?: string;
  executionStatus?: string;
  outcome?: string;
  failureCode?: string;
  runnerId?: string;
  checkRunRef?: string;
  attempts: number;
}
export interface WatchNotification {
  id: string;
  watchId: string;
  title: string;
  event: string;
  createdAt: string;
  readAt?: string;
  link: string;
}
export interface WatchStatus {
  coordinator: string;
  runners: { id: string; environment: string; lastSeen: string }[];
  observations: WatchObservation[];
}
export interface WatchSubscription {
  watchId: string;
  channels: WatchChannel[];
  unsubscribed?: boolean;
}

export interface WatchDelivery {
  id: string;
  watchId: string;
  channel: string;
  state: string;
  attempts: number;
  retryAt?: string;
  failureCode?: string;
  createdAt: string;
}
