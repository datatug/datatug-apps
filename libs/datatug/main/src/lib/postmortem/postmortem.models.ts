import type { WorkDetail, WorkScope, WorkTarget } from '../work/work.models';
export const reportSections = [
  'executive-summary',
  'scope-impact',
  'timeline',
  'detection',
  'investigation',
  'root-cause',
  'contributing-factors',
  'resolution',
  'verification',
  'lessons-learned',
  'preventive-actions',
  'open-questions',
  'evidence',
] as const;
export interface ReportSection {
  name: string;
  text: string;
  classification: 'fact' | 'hypothesis' | 'unknown';
  evidenceIds: string[];
}
export interface ReportEvidence {
  id: string;
  kind: string;
  sourceId: string;
  sourceVersion: number;
  digest: string;
  capturedAt: string;
  summary: string;
  availability: string;
}
export interface ReportProposal {
  id: string;
  kind: 'query' | 'check' | 'watch';
  revision: number;
  state: 'proposed' | 'approved' | 'rejected' | 'ignored';
  dto: Record<string, unknown>;
  dependencies?: unknown[];
  evidenceIds: string[];
  rationale: string;
  validationErrors?: string[];
  target?: WorkTarget;
  saveState?: string;
  targetVersion?: string;
  decisions?: {
    state: string;
    actorId: string;
    at: string;
    revision: number;
    rationale?: string;
  }[];
}
export interface ReportDraft {
  sections: ReportSection[];
  recommendations: ReportProposal[];
}
export interface ReportRevision {
  workItemId: string;
  revision: number;
  digest: string;
  origin: string;
  authorId: string;
  at: string;
  approvedBy?: string;
  approvedAt?: string;
  draft: ReportDraft;
  evidence: ReportEvidence[];
}
export interface PublicReportContent {
  sections: ReportSection[];
  safeCitationLabels: string[];
  proposalSummaries: string[];
}
export interface PublicReport {
  id: string;
  workItemId: string;
  revision: number;
  digest: string;
  content: PublicReportContent;
  createdAt: string;
}
export interface ReportLink {
  id: string;
  publicationId: string;
  expiresAt: string;
  revoked: boolean;
}
export interface PostmortemDetail {
  work: WorkDetail;
  report: ReportRevision;
  capabilities: { canApprove: boolean; canPublish: boolean; canShare: boolean };
  publications: PublicReport[];
  links: ReportLink[];
  token?: string;
  candidate?: GenerationCandidate;
  sendStatus?: string;
}
export interface GenerationCandidate {
  id: string;
  draft: ReportDraft;
  provider?: string;
  model?: string;
  inputDigest?: string;
  warnings?: string[];
}
export interface PostmortemAction extends WorkScope {
  itemId: string;
  operationId: string;
  expectedVersion: number;
  action: string;
  [field: string]: unknown;
}
export function emptyReport(): ReportDraft {
  return {
    sections: reportSections.map((name) => ({
      name,
      text: '',
      classification: 'unknown',
      evidenceIds: [],
    })),
    recommendations: [],
  };
}
