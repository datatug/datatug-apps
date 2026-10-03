import type { Params } from '@angular/router';
import { tryProjectUrl } from '../nav/nav-models';
import type {
  IncidentArtifactRef,
  IncidentDetail,
  IncidentFactView,
  IncidentParticipant,
  IncidentProjectRef,
} from './models';

export interface IncidentEvidenceTarget {
  readonly kind: IncidentArtifactRef['kind'];
  readonly label: string;
  readonly routerLink?: readonly string[];
  readonly queryParams?: Params;
}

export interface IncidentHypothesisView {
  readonly id: string;
  readonly layer: string;
  readonly state: 'proposed' | 'rejected';
  readonly facts: readonly IncidentFactView[];
}

export interface IncidentProjectTarget {
  readonly project: IncidentProjectRef;
  readonly routerLink: readonly string[];
}

/**
 * Link only when a real DataTug route exists. Query, board, and project
 * overview pages exist; execution, check, compare, snapshot, and annotation
 * pages do not, so those stay unlabeled text.
 */
export function incidentEvidenceTargets(
  refs: readonly IncidentArtifactRef[] | undefined,
  agentStoreId: string,
): readonly IncidentEvidenceTarget[] {
  return (refs ?? []).map((ref) => evidenceTarget(ref, agentStoreId));
}

export function incidentHypotheses(
  incident: IncidentDetail,
): readonly IncidentHypothesisView[] {
  const groups = new Map<string, IncidentFactView[]>();
  for (const fact of incident.canonicalContext.facts ?? []) {
    const layer = fact.layer;
    if (!layer?.startsWith('hypothesis:')) {
      continue;
    }
    const facts = groups.get(layer) ?? [];
    facts.push(fact);
    groups.set(layer, facts);
  }
  const rejected = new Set<string>(
    (incident.contextRejections ?? []).map((item) => item.layer),
  );
  return [...groups.entries()].map(([layer, facts]) => ({
    id: layer.slice('hypothesis:'.length),
    layer,
    state: rejected.has(layer) ? 'rejected' : 'proposed',
    facts,
  }));
}

/**
 * Router commands for a page of a project of the serving agent: the project's address from `projectUrl()`'s rules
 * (`tryProjectUrl`), then the page's segments, each left raw for the router to encode (a folder-qualified id keeps
 * its `/` as one segment). A project with no exact address has no page to link to: the root.
 */
function projectCommands(
  agentStoreId: string,
  projectId: string,
  ...page: string[]
): readonly string[] {
  const address = tryProjectUrl({ storeId: agentStoreId, projectId });
  return typeof address === 'string' ? [address, ...page] : ['/'];
}

export function incidentProjectTargets(
  projects: readonly IncidentProjectRef[] | undefined,
  agentStoreId: string,
): readonly IncidentProjectTarget[] {
  return (projects ?? []).map((project) => ({
    project,
    routerLink: projectCommands(agentStoreId, project.projectId),
  }));
}

export function incidentParticipants(
  participants: readonly IncidentParticipant[] | undefined,
): readonly IncidentParticipant[] {
  return participants ?? [];
}

function evidenceTarget(
  ref: IncidentArtifactRef,
  agentStoreId: string,
): IncidentEvidenceTarget {
  switch (ref.kind) {
    case 'query': {
      const artifact = ref.artifact;
      if (!artifact) {
        return { kind: ref.kind, label: 'query' };
      }
      return {
        kind: ref.kind,
        label: `query ${artifact.id}`,
        routerLink: projectCommands(
          agentStoreId,
          artifact.projectId,
          'query',
          artifact.id,
        ),
        queryParams: { id: artifact.id },
      };
    }
    case 'board': {
      const artifact = ref.artifact;
      if (!artifact) {
        return { kind: ref.kind, label: 'board' };
      }
      return {
        kind: ref.kind,
        label: `board ${artifact.id}`,
        routerLink: projectCommands(
          agentStoreId,
          artifact.projectId,
          'board',
          artifact.id,
        ),
      };
    }
    case 'project': {
      const project = ref.project;
      if (!project) {
        return { kind: ref.kind, label: 'project' };
      }
      return {
        kind: ref.kind,
        label: `project ${project.projectId}`,
        routerLink: projectCommands(agentStoreId, project.projectId),
      };
    }
    case 'compare':
      return {
        kind: ref.kind,
        label: ref.comparison
          ? `compare ${ref.comparison.left.executionId} vs ${ref.comparison.right.executionId}`
          : 'compare',
      };
    case 'execution':
    case 'snapshot':
      return {
        kind: ref.kind,
        label: ref.execution
          ? `${ref.kind} ${ref.execution.executionId}`
          : ref.kind,
      };
    case 'check':
    case 'annotation':
      return {
        kind: ref.kind,
        label: ref.artifact ? `${ref.kind} ${ref.artifact.id}` : ref.kind,
      };
    case 'hypothesis':
    case 'event':
    case 'fact':
    case 'incident':
      return {
        kind: ref.kind,
        label: ref.id ? `${ref.kind} ${ref.id}` : ref.kind,
      };
  }
}
