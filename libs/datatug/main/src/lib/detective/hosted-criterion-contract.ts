import { isIncidentResolution, resolutionMatchesCriterion } from '../incidents/resolution-proof';
import { decodeIncidentEvent } from '../incidents/incident-client.service';
import {
  isIncidentResolutionCriterion,
  criterionObject,
  criterionVersion,
} from '../incidents/resolution-criterion';
import type { DetectiveRequestContext } from './detective-client.service';
import type {
  HostedCriterionAction,
  HostedIncidentResponse,
  HostedIncidentView,
} from './hosted-linkage.models';
import type { IncidentEvent } from '../incidents/models';
const sameJSON = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameJSON(value, b[index]))
    );
  if (!criterionObject(a) || !criterionObject(b)) return false;
  const names = Object.keys(a);
  return (
    names.length === Object.keys(b).length &&
    names.every((k) => Object.hasOwn(b, k) && sameJSON(a[k], b[k]))
  );
};
type Cloud = Extract<DetectiveRequestContext, { kind: 'cloud' }>;
export function validateHostedCriterionView(
  view: HostedIncidentView,
  ref: string,
  context: Cloud,
  environment: string,
): void {
  if (
    !criterionObject(view) ||
    Object.keys(view).some(
      (k) =>
        ![
          'ref',
          'uid',
          'title',
          'description',
          'status',
          'outcome',
          'mergedInto',
          'projects',
          'participants',
          'canonicalContext',
          'contextPromotions',
          'contextRejections',
          'assetRefs',
          'notes',
          'lastSeq',
          'resolutionCriterion',
          'resolution',
        ].includes(k),
    ) ||
    JSON.stringify(view).length > 131072 ||
    !criterionObject(view.ref) ||
    `${view.ref.storeId}/${view.ref.incidentId}` !== ref ||
    !criterionVersion(view.lastSeq)
  )
    throw new Error('Invalid Incident projection.');
  if (Object.hasOwn(view, 'resolutionCriterion')) {
    const c = view.resolutionCriterion;
    if (
      !isIncidentResolutionCriterion(c) ||
      c.scope.project.storeId !== context.storage ||
      c.scope.project.projectId !== context.project ||
      c.scope.project.environment !== environment
    )
      throw new Error('The current resolution criterion is unavailable.');
  }
  if (Object.hasOwn(view, 'resolution') && (!isIncidentResolution(view.resolution) || !view.resolutionCriterion || !resolutionMatchesCriterion(view.resolution, view.resolutionCriterion) || view.status !== 'resolved')) throw new Error('The current Incident resolution proof is unavailable.');

}
export function validateHostedCriterionEvent(
  event: IncidentEvent,
  ref: string,
  context: Cloud,
  environment: string,
): void {
  if (!criterionObject(event) || !['incident.created','incident.status','incident.outcome','incident.merged','note.added','context.fact.added','context.fact.promoted','context.fact.rejected','compare.run','incident.criterion-set','incident.resolved'].includes(event.type)) throw new Error('Unsupported Incident history event.');
  if (event.type === 'incident.resolved') {
    decodeIncidentEvent(event);
    if (!isIncidentResolution(event.payload) || `${event.incident.storeId}/${event.incident.incidentId}` !== ref || event.payload.proof.scope.project.storeId !== context.storage || event.payload.proof.scope.project.projectId !== context.project || event.payload.proof.scope.project.environment !== environment) throw new Error('Resolution history is unavailable.');
    return;
  }
  if (event.type !== 'incident.criterion-set') return;
  decodeIncidentEvent(event);
  if (
    `${event.incident.storeId}/${event.incident.incidentId}` !== ref ||
    !isIncidentResolutionCriterion(event.payload) ||
    event.payload.scope.project.storeId !== context.storage ||
    event.payload.scope.project.projectId !== context.project ||
    event.payload.scope.project.environment !== environment
  )
    throw new Error('Criterion history is unavailable.');
}
export function validateHostedCriterionSuccess(
  result: HostedIncidentResponse,
  action: HostedCriterionAction,
  context: Cloud,
): void {
  if (
    !criterionObject(result) ||
    JSON.stringify(result).length > 262144 ||
    Object.keys(result).some(
      (k) => !['event', 'incident', 'receipt', 'replayed'].includes(k),
    ) ||
    ('replayed' in result && typeof result.replayed !== 'boolean')
  )
    throw new Error('Invalid criterion operation response.');
  validateHostedCriterionView(
    result.incident,
    action.incidentRef,
    context,
    action.environment,
  );
  const e = result.event,
    c = result.incident.resolutionCriterion;
  if (!e || e.type !== 'incident.criterion-set')
    throw new Error('Missing criterion receipt event.');
  validateHostedCriterionEvent(
    e,
    action.incidentRef,
    context,
    action.environment,
  );
  if (
    !c ||
    e.actor.kind !== 'human' ||
    e.actor.id !== context.principal ||
    e.actor.via !== 'web' ||
    e.seq !== action.expectedSeq + 1 ||
    result.incident.lastSeq < e.seq ||
    !sameJSON(e.payload, c) ||
    (action.type === 'criterion-draft'
      ? c.finalized ||
        c.version !== action.criterion.version ||
        c.checkID !== action.criterion.checkID ||
        c.maxAgeSeconds !== action.criterion.maxAgeSeconds ||
        c.scope.sessionRef !== action.evidence.context.sessionId
      : !c.finalized || c.version !== action.criterionVersion + 1)
  )
    throw new Error(
      'The server did not confirm the exact criterion intent. Retry the original operation.',
    );
}

export function validateHostedCriterionHistory(
  page: unknown,
  ref: string,
  context: Cloud,
  environment: string,
  after: number,
  limit: number,
): void {
  if (
    !criterionObject(page) ||
    Object.keys(page).some(
      (k) =>
        !['events', 'nextAfterSeq', 'hasMore', 'messagePresentation'].includes(
          k,
        ),
    ) ||
    !Array.isArray(page['events']) ||
    page['events'].length > limit ||
    !Number.isSafeInteger(page['nextAfterSeq']) ||
    (page['nextAfterSeq'] as number) < after ||
    typeof page['hasMore'] !== 'boolean' ||
    (page['hasMore'] && (page['nextAfterSeq'] as number) <= after)
  )
    throw new Error('Invalid Incident history envelope.');
  let previous = after;
  const ids = new Set<string>();
  for (const event of page['events']) {
    if (
      !criterionObject(event) ||
      !criterionObject(event['incident']) ||
      `${event['incident']['storeId']}/${event['incident']['incidentId']}` !==
        ref ||
      !criterionVersion(event['seq']) ||
      event['seq'] <= previous ||
      event['seq'] > (page['nextAfterSeq'] as number) ||
      typeof event['id'] !== 'string' ||
      ids.has(event['id'])
    )
      throw new Error('Invalid Incident history membership.');
    previous = event['seq'];
    ids.add(event['id']);
    validateHostedCriterionEvent(
      event as unknown as IncidentEvent,
      ref,
      context,
      environment,
    );
  }
}
