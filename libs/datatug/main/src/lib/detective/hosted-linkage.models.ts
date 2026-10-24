import type {
  IncidentEvent,
  IncidentArtifactRef,
  IncidentAssertion,
  IncidentNotePresentation,
} from '../incidents/models';
import type { AppliedEvidenceRequest } from '../evidence/applied-evidence';
import type { IncidentResolutionCriterion } from '../incidents/models';
import type { DetectiveCase } from './models';
import type { DetectiveInputValue } from './models';

export interface HostedIncidentView {
  workItemId?: string;
  resolutionEpoch?: number;
  reopenedAt?: string;
  resolutionCriterion?: IncidentResolutionCriterion;
  resolution?: import('../incidents/models').IncidentResolution;
  ref: { storeId: string; incidentId: string };
  uid: string;
  title: string;
  description?: string;
  status: string;
  outcome?: string;
  canonicalContext: unknown;
  lastSeq: number;
}

export interface HostedIncidentLinks {
  caseId: string;
  incidents: HostedIncidentView[];
}

export interface HostedProjectIncidents {
  incidents: HostedIncidentView[];
}

export interface HostedProjectIncident {
  incident: HostedIncidentView;
}

export type IncidentMessagePresentationCapability =
  | {
      status: 'available';
      kind: 'demo-character';
      characterIds: ['sarah', 'maya', 'daniel'];
    }
  | { status: 'not-eligible' | 'unavailable' };

export interface HostedIncidentEvents {
  messagePresentation?: IncidentMessagePresentationCapability;
  events: IncidentEvent[];
  nextAfterSeq: number;
  hasMore: boolean;
}
export interface HostedIncidentMessage {
  presentation?: IncidentNotePresentation;
  body: string;
  assertion?: Exclude<IncidentAssertion['kind'], 'deterministic-result'>;
  refs?: IncidentArtifactRef[];
}

export type HostedCriterionAction =
  | {
      type: 'criterion-draft';
      incidentRef: string;
      environment: string;
      expectedSeq: number;
      criterion: { version: number; checkID: string; maxAgeSeconds: number };
      evidence: AppliedEvidenceRequest;
    }
  | {
      type: 'criterion-finalize';
      incidentRef: string;
      environment: string;
      expectedSeq: number;
      criterionVersion: number;
    };

export interface HostedResolveAction {
  readonly criteriaAccepted?: boolean;
  readonly expectedWorkVersion?: number;
  readonly type: 'resolve';
  readonly incidentRef: string;
  readonly environment: string;
  readonly expectedSeq: number;
  readonly criterionVersion: number;
  readonly run: Extract<
    import('@sneat/datatug-semantic').ArtifactRef,
    { kind: 'check-run' }
  >['checkRun'];
  readonly recovery: import('@sneat/datatug-semantic').SourceOperationRef;
  readonly humanNote: string;
}

export type HostedIncidentAction =
  | HostedResolveAction
  | HostedCriterionAction
  | {
      type: 'append-message';
      incidentRef: string;
      environment: string;
      expectedSeq: number;
      message: HostedIncidentMessage;
    }
  | {
      type: 'create';
      caseId?: string;
      title: string;
      description?: string;
      context?: Record<string, DetectiveInputValue>;
      environment: string;
      ifMatch?: number;
    }
  | {
      type: 'link';
      caseId: string;
      incidentRef: string;
      environment: string;
      ifMatch: number;
    }
  | {
      type: 'start-case';
      incidentRef: string;
      case: DetectiveCase;
      environment: string;
      ifMatch?: 0;
    };

export interface HostedIncidentResponse {
  event?: IncidentEvent;
  replayed?: boolean;
  incident: HostedIncidentView;
  case?: DetectiveCase;
  receipt: string;
  caseLinkStatus?: 'linked' | 'already-linked' | 'link-pending';
  linkPendingReason?: 'case-changed' | 'case-archived' | 'case-unavailable';
}

export type HostedKnowledgeKind =
  'field-meaning' | 'relationship' | 'invariant' | 'query' | 'scenario';

export interface HostedKnowledgeTarget {
  system: 'meaninggraph' | 'modelspec';
  repository: string;
  resourceId: string;
  expectedRevision: string;
}

export interface HostedKnowledgeHandoff {
  kind: 'knowledge-handoff';
  status: 'ready-for-target-review';
  target: HostedKnowledgeTarget;
  proposalId: string;
  proposalVersion: number;
  caseId: string;
  claimStatus: 'hypothesis' | 'confirmed';
  statement: string;
  evidenceRefs: string[];
  findingRefs?: string[];
  preparedAt: string;
  preparedBy: string;
  receipt: string;
}

export interface HostedKnowledgeProposal {
  id: string;
  caseId: string;
  kind: HostedKnowledgeKind;
  title: string;
  statement: string;
  evidenceRefs: string[];
  findingRefs?: string[];
  claimStatus: 'hypothesis' | 'confirmed';
  status: 'draft' | 'reviewed' | 'rejected';
  version: number;
  createdAt: string;
  createdBy: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  handoffs?: HostedKnowledgeHandoff[];
}

export interface HostedKnowledgePage {
  proposals: HostedKnowledgeProposal[];
  nextCursor?: string;
  hasMore: boolean;
}

export type HostedKnowledgeAction =
  | {
      type: 'save-draft';
      proposal: Pick<
        HostedKnowledgeProposal,
        | 'id'
        | 'caseId'
        | 'kind'
        | 'title'
        | 'statement'
        | 'evidenceRefs'
        | 'findingRefs'
        | 'claimStatus'
      >;
      ifMatch?: number;
    }
  | {
      type: 'review' | 'reject';
      proposalId: string;
      ifMatch: number;
      reviewNote?: string;
    }
  | {
      type: 'export';
      proposalId: string;
      ifMatch: number;
      target: HostedKnowledgeTarget;
    };

export interface HostedKnowledgeResponse {
  proposal?: HostedKnowledgeProposal;
  export?: HostedKnowledgeHandoff;
  receipt: string;
}
