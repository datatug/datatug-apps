import type {
  IncidentDetail,
  IncidentFactView,
  IncidentStreamItem,
} from './models';

export interface IncidentStatusSentence {
  readonly text: string;
  readonly eventIds: readonly string[];
}

/**
 * Deterministic troubleshooter status view (hub REQ:status-projection).
 * Every sentence cites visible event ids; hypothesis layers are counted as
 * hypotheses and never restated as facts.
 */
export function incidentStatusProjection(
  incident: IncidentDetail,
  events: readonly IncidentStreamItem[],
): readonly IncidentStatusSentence[] {
  const visibleIds = new Set(events.map((item) => item.event.id));
  const created = events.find((item) => item.event.type === 'incident.created');
  const sentences: IncidentStatusSentence[] = [];

  const statusEventIds = uniquePresentIds(visibleIds, [
    ...events
      .filter(
        (item) =>
          item.event.type === 'incident.status' &&
          'status' in item.event.payload &&
          item.event.payload.status === incident.status,
      )
      .sort((left, right) => left.event.seq - right.event.seq)
      .map((item) => item.event.id)
      .slice(-1),
    ...(incident.status === 'open' && created ? [created.event.id] : []),
  ]);
  if (statusEventIds.length) {
    sentences.push({
      text: `Status is ${incident.status}.`,
      eventIds: statusEventIds,
    });
  }

  if (incident.outcome) {
    const outcomeIds = uniquePresentIds(
      visibleIds,
      events
        .filter((item) => item.event.type === 'incident.outcome')
        .map((item) => item.event.id),
    );
    if (outcomeIds.length) {
      sentences.push({
        text: `Outcome is ${incident.outcome}.`,
        eventIds: outcomeIds,
      });
    }
  }

  const affectedCount = canonicalFacts(incident).filter(
    (fact) => fact.role === 'affected' && fact.enabled,
  ).length;
  if (affectedCount) {
    const promotionIds = uniquePresentIds(
      visibleIds,
      events
        .filter(
          (item) =>
            item.event.type === 'context.fact.promoted' &&
            'role' in item.event.payload &&
            item.event.payload.role === 'affected',
        )
        .map((item) => item.event.id),
    );
    const eventIds = promotionIds.length
      ? promotionIds
      : uniquePresentIds(visibleIds, created ? [created.event.id] : []);
    if (eventIds.length) {
      sentences.push({
        text: `${affectedCount} affected ${
          affectedCount === 1 ? 'fact is' : 'facts are'
        } recorded in canonical context.`,
        eventIds,
      });
    }
  }

  const proposedHypothesisLayers = hypothesisLayers(incident).filter(
    (layer) =>
      !(incident.contextRejections ?? []).some(
        (rejection) => rejection.layer === layer,
      ),
  );
  if (proposedHypothesisLayers.length) {
    const eventIds = uniquePresentIds(
      visibleIds,
      events
        .filter((item) => {
          if (item.event.type !== 'context.fact.added') {
            return false;
          }
          const payload = item.event.payload;
          return (
            'fact' in payload &&
            typeof payload.fact.layer === 'string' &&
            proposedHypothesisLayers.includes(payload.fact.layer)
          );
        })
        .map((item) => item.event.id),
    );
    if (eventIds.length) {
      sentences.push({
        text: `${proposedHypothesisLayers.length} ${
          proposedHypothesisLayers.length === 1
            ? 'hypothesis is'
            : 'hypotheses are'
        } proposed.`,
        eventIds,
      });
    }
  }

  return sentences;
}

function canonicalFacts(incident: IncidentDetail): readonly IncidentFactView[] {
  return (incident.canonicalContext.facts ?? []).filter(
    (fact) => !fact.layer || fact.layer === 'canonical',
  );
}

function hypothesisLayers(incident: IncidentDetail): readonly string[] {
  const layers = new Set<string>();
  for (const fact of incident.canonicalContext.facts ?? []) {
    if (fact.layer?.startsWith('hypothesis:')) {
      layers.add(fact.layer);
    }
  }
  return [...layers];
}

function uniquePresentIds(
  visibleIds: ReadonlySet<string>,
  ids: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const present: string[] = [];
  for (const id of ids) {
    if (!visibleIds.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    present.push(id);
  }
  return present;
}
