/** Browser mirror of datatug-cli/pkg/detective/model.go. Keep JSON names in sync. */
export type DetectiveValue =
  | {
      readonly type: 'string' | 'integer' | 'decimal' | 'date' | 'datetime';
      readonly value: string;
    }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'null'; readonly value: null };

export type DetectiveInputValue =
  | DetectiveValue
  | { readonly type: 'set'; readonly values: DetectiveValue[] }
  | {
      readonly type: 'range';
      readonly start: DetectiveValue;
      readonly end: DetectiveValue;
    };

export interface CheckInput {
  name: string;
  type: DetectiveValue['type'];
  cardinality: 'scalar' | 'set' | 'range';
  required?: boolean;
}

export interface CheckBinding {
  input: string;
  fromInput?: string;
  part?: 'start' | 'end';
  fromColumn?: string;
}

export interface ValidatorDefinition {
  id: string;
  validatorId?: string;
  scope: 'row' | 'set';
  kind:
    | ''
    | 'non-null'
    | 'equals-fields'
    | 'row-count'
    | 'unique'
    | 'sum-equals'
    | 'check';
  severity: 'critical' | 'error' | 'warning' | 'info';
  field?: string;
  otherField?: string;
  expected?: DetectiveValue;
  checkId?: string;
  bindings?: CheckBinding[];
  onUnavailable?: 'block' | 'fail' | 'warn' | 'skip';
}

export interface PublishedValidator {
  id: string;
  title: string;
  version: number;
  validator: ValidatorDefinition;
}

export interface QueryValidators {
  queryId: string;
  version: number;
  validators: ValidatorDefinition[];
}

export interface CheckStep {
  id: string;
  kind: 'query' | 'check';
  queryId?: string;
  checkId?: string;
  bindings?: CheckBinding[];
  validators?: ValidatorDefinition[];
  onUnavailable?: 'block' | 'fail' | 'warn' | 'skip';
}

export interface CheckDefinition {
  id: string;
  title: string;
  description?: string;
  version: number;
  inputs: CheckInput[];
  steps: CheckStep[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface EvidenceRef {
  id: string;
  kind: 'check-run' | 'query' | 'external';
  ref: string;
  note?: string;
}

export interface CaseFinding {
  id: string;
  text: string;
  status: 'hypothesis' | 'confirmed';
  evidenceRefs?: string[];
}

export interface CaseEvent {
  id: string;
  at?: string;
  actor?: string;
  type: string;
  message?: string;
  ref?: string;
}

export interface DetectiveCase {
  id: string;
  title: string;
  status: 'active' | 'closed' | 'archived';
  version: number;
  context: Record<string, DetectiveInputValue>;
  incidentRefs: string[];
  scenarioRefs: string[];
  scenarioApplications?: ScenarioApplication[];
  runRefs: string[];
  evidence: EvidenceRef[];
  findings: CaseFinding[];
  timeline: CaseEvent[];
  timelineOffset?: number;
  closureReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScenarioStep {
  id: string;
  kind: 'query' | 'check';
  ref: string;
}

export interface InvestigationScenario {
  id: string;
  title: string;
  description?: string;
  version: number;
  inputs: CheckInput[];
  steps: ScenarioStep[];
}

export interface ScenarioStepReceipt {
  stepId: string;
  status: 'pending' | 'completed' | 'skipped';
  runId?: string;
  execution?: DetectiveExecutionRef;
  environment?: string;
  evidenceOutcome?: 'pass' | 'fail' | 'unknown';
  at?: string;
  actor?: string;
}

export interface ScenarioApplication {
  id: string;
  scenarioId: string;
  scenarioVersion: number;
  snapshot: InvestigationScenario;
  appliedAt: string;
  appliedBy: string;
  steps: ScenarioStepReceipt[];
}

export interface ValidationResult {
  validatorId: string;
  executionStatus: string;
  outcome: 'pass' | 'fail' | 'unknown';
  evidenceOutcome?: string;
  onUnavailable?: string;
  disposition?: string;
  severity: string;
  rowIndex?: number;
  message?: string;
  children?: CheckStepResult[];
}

export interface DetectiveExecutionRef {
  storeId: string;
  projectId: string;
  executionId: string;
}

export interface CheckStepResult {
  stepId: string;
  kind: string;
  queryId?: string;
  queryRevision?: string;
  resultFingerprint?: string;
  source?: string;
  observedAt?: string;
  executionProfile?: string;
  execution?: DetectiveExecutionRef;
  errorCode?: string;
  durationMs?: number;
  checkId?: string;
  executionStatus: string;
  outcome: 'pass' | 'fail' | 'unknown';
  evidenceOutcome?: string;
  onUnavailable?: string;
  disposition?: string;
  limitations?: {
    policy: string;
    rowsFiltered: boolean;
    hiddenColumns: string[];
  }[];
  severity?: string;
  rowCount?: number;
  message?: string;
  validators?: ValidationResult[];
  children?: CheckStepResult[];
}

export interface CheckRun {
  id: string;
  kind: 'check' | 'query-validators';
  checkId: string;
  queryId?: string;
  definition: CheckDefinition;
  dependencies: CheckDefinition[];
  publishedValidators: PublishedValidator[];
  queryValidators: QueryValidators[];
  caseId?: string;
  environment: string;
  inputNames: string[];
  executionStatus: string;
  outcome: 'pass' | 'fail' | 'unknown';
  severity?: string;
  steps: CheckStepResult[];
  startedAt: string;
  durationMs: number;
  actor: string;
  checkInvocations: number;
  queryExecutions: number;
}

export interface DetectiveState {
  checks: CheckDefinition[];
  validators: PublishedValidator[];
  queryValidators: QueryValidators[];
  cases: DetectiveCase[];
  runs: CheckRun[];
  runsHasMore: boolean;
  runsNextCursor?: string;
  scenarios: InvestigationScenario[];
  environments?: string[];
  capabilities: {
    localOnly: boolean;
    canRead: boolean;
    canWrite: boolean;
    canRun: boolean;
    maxRows: number;
    maxFanout: number;
  };
}

export interface DetectiveActionRequest {
  type:
    | 'save-check'
    | 'save-validator'
    | 'save-query-validators'
    | 'run-query-validators'
    | 'create-case'
    | 'update-case'
    | 'append-event'
    | 'run-check'
    | 'save-scenario'
    | 'apply-scenario'
    | 'record-scenario-step';
  project: string;
  securityContextId: string;
  check?: CheckDefinition;
  validator?: PublishedValidator;
  queryValidators?: QueryValidators;
  case?: DetectiveCase;
  scenario?: InvestigationScenario;
  event?: CaseEvent;
  checkId?: string;
  queryId?: string;
  caseId?: string;
  scenarioId?: string;
  applicationId?: string;
  stepId?: string;
  stepStatus?: 'pending' | 'completed' | 'skipped';
  runId?: string;
  execution?: DetectiveExecutionRef;
  environment?: string;
  inputs?: Record<string, DetectiveInputValue>;
}

export interface DetectiveActionResponse {
  check?: CheckDefinition;
  validator?: PublishedValidator;
  queryValidators?: QueryValidators;
  case?: DetectiveCase;
  run?: CheckRun;
  scenario?: InvestigationScenario;
  /** The completed Run and its Case evidence link have separate outcomes. */
  caseLinkStatus?:
    | 'linked'
    | 'already-linked'
    | 'case-unavailable'
    | 'case-archived'
    | 'case-changed'
    | 'link-unavailable';
}
