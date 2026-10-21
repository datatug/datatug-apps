import type { IncidentEvent } from './models';

export function incidentEventSummary(event: IncidentEvent): string {
  if (event.type === 'incident.criterion-set' && 'checkID' in event.payload)
    return `${event.payload.finalized ? 'Criterion finalized' : 'Criterion draft saved'} · ${event.payload.checkID} · Check version ${event.payload.checkVersion} · criterion ${event.payload.version}`;
  if (
    event.type === 'note.added' &&
    event.payload &&
    typeof event.payload === 'object' &&
    'body' in event.payload &&
    typeof event.payload.body === 'string'
  )
    return event.payload.body;
  return event.type;
}
