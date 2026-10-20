import type { IncidentEvent } from './models';

export function incidentEventSummary(event: IncidentEvent): string {
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
