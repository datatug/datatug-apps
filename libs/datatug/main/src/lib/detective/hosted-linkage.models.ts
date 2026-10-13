import type { DetectiveCase } from './models';

export interface HostedIncidentView {
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

export type HostedIncidentAction =
  | {
      type: 'create';
      caseId: string;
      title: string;
      description?: string;
      environment: string;
      ifMatch: number;
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
  incident: HostedIncidentView;
  case?: DetectiveCase;
  receipt: string;
}

export type HostedKnowledgeKind =
  | 'field-meaning'
  | 'relationship'
  | 'invariant'
  | 'query'
  | 'scenario';

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
