import type { DetectiveInputValue } from '../detective/models';

export type WatchChannel = 'in_app' | 'email' | 'sms' | 'telegram';
export interface WatchIdentity {
  id: string;
  namespace: string;
  project: string;
  environment: string;
  sharedEditor: boolean;
  tier: string;
  telegramConnected?: boolean;
  channels: Record<WatchChannel, boolean>;
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
