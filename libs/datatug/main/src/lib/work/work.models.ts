import {
  ContextCommand,
  ContextSnapshot,
  SessionScope,
  ContextSubject,
  ContextEntryRef,
} from '../session-context/session-context-contract';
export type WorkType = 'incident' | 'case' | 'task';
export interface WorkScope {
  readonly spaceID: string;
  readonly projectID: string;
}
export interface WorkItem extends WorkScope {
  readonly id: string;
  readonly type: WorkType;
  readonly title: string;
  readonly description?: string;
  readonly ownerId: string;
  readonly assigneeIds: readonly string[];
  readonly primaryAssigneeId?: string;
  readonly status: string;
  readonly lifecycle: 'open' | 'active' | 'done' | 'archived';
  readonly priority: string;
  readonly dueAt?: string;
  readonly criteria?: string;
  readonly version: number;
  readonly contextSessionId: string;
  readonly parentId?: string;
  readonly inheritance?: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closure?: {
    summary: string;
    actorId: string;
    at: string;
    outcome?: string;
  };
  readonly incident?: {
    severity: string;
    impact?: string;
    environment: string;
    legacyRef?: { storeId: string; incidentId: string };
  };
  readonly case?: { legacyCaseId?: string; scenarioIds?: readonly string[] };
}
export interface WorkDraft {
  type: WorkType;
  title: string;
  description?: string;
  ownerId?: string;
  assigneeIds?: string[];
  primaryAssigneeId?: string;
  priority: string;
  dueAt?: string;
  criteria?: string;
  severity?: string;
  impact?: string;
  environment?: string;
}
export interface WorkTarget {
  kind: 'work' | 'check' | 'watch' | 'query' | 'dashboard';
  id: string;
  storeId?: string;
  projectId?: string;
  folder?: string;
  environment?: string;
}
export interface WorkLink {
  id: string;
  sourceId: string;
  relation: string;
  target: WorkTarget;
  createdBy: string;
  createdAt: string;
}
export interface WorkActivity {
  id: string;
  itemId: string;
  version: number;
  actorId: string;
  action: string;
  fields?: string[];
  comment?: string;
  summary?: string;
  outcome?: string;
  changes?: { field: string; before: string; after: string }[];
  at: string;
}
export interface WorkMember {
  id: string;
  title: string;
  role: string;
}
export interface WorkCapabilities {
  canRead: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canAssign: boolean;
  canContext: boolean;
  transitions: string[];
}
export interface WorkEnvironment extends SessionScope {
  title: string;
  subjects: {
    id: string;
    label: string;
    subject: ContextSubject;
    type: string;
    shape: string;
  }[];
}
export interface WorkProposal {
  id: string;
  sourceId: string;
  targetId: string;
  state: string;
  actorId: string;
  createdAt: string;
  selection: ContextEntryRef[];
}
export interface WorkDetail {
  environments: WorkEnvironment[];
  proposals: WorkProposal[];
  executionSessionId?: string;
  item: WorkItem;
  links: WorkLink[];
  activity: WorkActivity[];
  hasEarlierActivity?: boolean;
  members: WorkMember[];
  capabilities: WorkCapabilities;
  context?: ContextSnapshot;
}
export interface WorkPage {
  environments: WorkEnvironment[];
  items: WorkItem[];
  members: WorkMember[];
  capabilities: WorkCapabilities;
  hasMore: boolean;
  nextCursor?: string;
}
export interface WorkAction extends WorkScope {
  operationId: string;
  action:
    | 'create'
    | 'edit'
    | 'transition'
    | 'comment'
    | 'link'
    | 'unlink'
    | 'context'
    | 'propose-context'
    | 'accept-context'
    | 'reject-context'
    | 'cancel-context'
    | 'refresh-context'
    | 'execution-snapshot';
  proposalId?: string;
  targetItemId?: string;
  targetVersion?: number;
  sourceSessionVersion?: number;
  targetSessionVersion?: number;
  selection?: ContextEntryRef[];
  itemId?: string;
  expectedVersion?: number;
  draft?: WorkDraft;
  status?: string;
  summary?: string;
  outcome?: string;
  criteriaAccepted?: boolean;
  comment?: string;
  relation?: string;
  target?: WorkTarget;
  linkId?: string;
  parentId?: string;
  parentVersion?: number;
  inheritance?: string;
  contextScope?: SessionScope;
  contextCommand?: ContextCommand;
}
export type WorkFilters = Partial<
  Record<
    | 'type'
    | 'assignee'
    | 'owner'
    | 'status'
    | 'priority'
    | 'due'
    | 'search'
    | 'cursor',
    string
  >
>;
export const workTypeLabel = (type: WorkType): string =>
  ({ incident: 'Incident', case: 'Detective Case', task: 'Task' })[type];
export const workOverdue = (
  item: Pick<WorkItem, 'dueAt' | 'lifecycle'>,
  now = Date.now(),
): boolean =>
  !!item.dueAt &&
  !['done', 'archived'].includes(item.lifecycle) &&
  Date.parse(item.dueAt) < now;
export const workScopeKey = (scope: WorkScope): string =>
  JSON.stringify([scope.spaceID, scope.projectID]);
export const workId = (): string =>
  `work_${crypto.randomUUID().replaceAll('-', '')}`;
export function workError(error: unknown): string {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403)
    return 'Access is no longer available. Sign in or ask your project owner to review your membership.';
  if (status === 409)
    return 'This work changed elsewhere. Reload and review the latest version before submitting again.';
  if (status === 404)
    return 'This work is unavailable or the server does not support Work yet.';
  if (status === 400 || status === 422)
    return 'The server rejected this change. Check the fields, permissions and allowed transition.';
  return 'The server could not confirm this operation. Retry the original change before making another.';
}
export function draftFromWork(item: WorkItem): WorkDraft {
  return {
    type: item.type,
    title: item.title,
    description: item.description,
    ownerId: item.ownerId,
    assigneeIds: [...(item.assigneeIds ?? [])],
    primaryAssigneeId: item.primaryAssigneeId,
    priority: item.priority,
    dueAt: item.dueAt,
    criteria: item.criteria,
    ...(item.incident
      ? {
          severity: item.incident.severity,
          impact: item.incident.impact,
          environment: item.incident.environment,
        }
      : {}),
  };
}
