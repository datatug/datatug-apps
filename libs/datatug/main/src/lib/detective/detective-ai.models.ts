/** Browser mirror of datatug-core/pkg/detectiveai/model.go. The host owns scope and catalog snapshots. */
import type {
  CaseFinding,
  CheckDefinition,
  CheckInput,
  DetectiveInputValue,
  InvestigationScenario,
  PublishedValidator,
} from './models';

export interface AiProvenance {
  sourceId: string;
  start: number;
  end: number;
  quote?: string;
  confidence: number;
  ambiguous?: boolean;
}

export interface AiExtractedValue {
  value: DetectiveInputValue;
  provenance: AiProvenance[];
}

export interface AiQueryDraft {
  id: string;
  title: string;
  type: string;
  text: string;
  connectionId?: string;
  inputs?: CheckInput[];
  expectedRevision?: string;
}

export interface AiCaseEdit {
  caseId: string;
  expectedVersion: number;
  title?: string;
  context?: Record<string, DetectiveInputValue>;
  findings?: CaseFinding[];
  status?: string;
  closureReason?: string;
}

export interface AiRunDraft {
  checkId: string;
  caseId?: string;
  environment: string;
  inputs: Record<string, DetectiveInputValue>;
}

export interface AiDraft {
  kind:
    | 'extract-context'
    | 'draft-query'
    | 'draft-check'
    | 'draft-validator'
    | 'draft-scenario'
    | 'edit-case'
    | 'run-check'
    | 'explain-failure';
  title: string;
  context?: Record<string, AiExtractedValue>;
  query?: AiQueryDraft;
  check?: CheckDefinition;
  validator?: PublishedValidator;
  scenario?: InvestigationScenario;
  case?: AiCaseEdit;
  run?: AiRunDraft;
  explanation?: { runId: string; summary: string; basis: string };
  sources: AiProvenance[];
  ambiguities?: string[];
}

export interface AiProposal {
  id: string;
  parentProposalId?: string;
  scope: { key: string; project: string; actor: string };
  basis: { catalogRevision: string; environments: string[] };
  draft: AiDraft;
  sources: {
    id: string;
    kind: string;
    revision: string;
    digest: string;
    length: number;
  }[];
  expectedCounts?: Record<string, number>;
  createdAt: string;
  expiresAt: string;
  digest: string;
}

export interface AiGenerateResponse {
  proposals: AiProposal[];
  matches: { kind: string; id: string; title: string; revision: string }[];
  text?: string;
}

export interface AiProposalsPage {
  proposals: AiProposal[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface AiContextReview {
  proposalId: string;
  digest: string;
  caseId: string;
  expectedVersion: number;
  context: Record<string, DetectiveInputValue>;
}

export interface AiReviewedDraft {
  proposalId: string;
  digest: string;
  draft: AiDraft;
}

export interface AiConfirmReceipt {
  operationId: string;
  scopeKey: string;
  project: string;
  actor: string;
  proposalId: string;
  payloadDigest: string;
  resourceId: string;
  at: string;
}
