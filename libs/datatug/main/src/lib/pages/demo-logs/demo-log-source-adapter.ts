import { InjectionToken } from '@angular/core';

export interface AppliedLogQuery {
  readonly baseUrl: string;
  readonly databaseId: string;
  readonly collection: string;
  readonly identifier: string;
}
export interface LogRecordLink {
  readonly commands: readonly string[];
  readonly queryParams: Readonly<Record<string, string>>;
  readonly label: string;
}
export interface DemoLogSourceAdapter {
  readonly defaults: { readonly baseUrl: string; readonly databaseId: string; readonly collection: string; readonly identifier: string; readonly from: string; readonly to: string };
  readonly identifier: { readonly label: string; readonly field: string; readonly queryParam: string };
  readonly detailFields: readonly { readonly label: string; readonly field: string }[];
  heading(query: AppliedLogQuery | null): { readonly eyebrow: string; readonly title: string; readonly description: string };
  relatedRecord(query: AppliedLogQuery, identifier: string, placement?: 'context' | 'row'): LogRecordLink | undefined;
  originalLabel(parser: string): string;
}
/** Existing synthetic source presentation policy. No read or execution grant:
 * ordinary OVDB descriptor/query checks remain the source authority. */
const northwindSource = (query: AppliedLogQuery) => query.baseUrl === 'http://127.0.0.1:6832' && query.databaseId === 'northwind_evidence' && ['fulfillment_events', 'carrier_events'].includes(query.collection);
export const DEMO_LOG_SOURCE_ADAPTER = new InjectionToken<DemoLogSourceAdapter>('demo log source presentation', {
  providedIn: 'root',
  factory: () => ({
    defaults: { baseUrl: 'http://127.0.0.1:6832', databaseId: 'northwind_evidence', collection: 'fulfillment_events', identifier: '11039', from: '2018-04-21T09:12:00Z', to: '2018-04-21T09:14:00Z' },
    identifier: { label: 'Order ID', field: 'order_id', queryParam: 'order' },
    detailFields: [{ label: 'Correlation', field: 'correlation_id' }, { label: 'Order', field: 'order_id' }],
    heading(query) {
      if (!query || !northwindSource(query)) return { eyebrow: 'Evidence from an OVDB collection', title: 'Log evidence timeline', description: query ? `Showing results from ${query.databaseId} / ${query.collection}${query.identifier ? ' for identifier ' + query.identifier : ''}.` : '' };
      return { eyebrow: 'Northwind investigation · synthetic log evidence', title: query.identifier === '11039' ? 'Why did order 11039 remain unshipped?' : query.identifier ? `Order ${query.identifier} evidence` : 'Northwind order evidence', description: query.identifier === '11039' ? 'The database record is real. These log entries are a deterministic synthetic scenario for investigating it.' : 'This source contains deterministic synthetic log entries. Check the selected database record separately.' };
    },
    relatedRecord(query, identifier, placement) { return northwindSource(query) && identifier ? { commands: ['/demo', 'sqlite', 'northwind', 'table', 'Orders'], queryParams: { record: identifier }, label: placement === 'context' ? 'Open the order record' : `Open related order ${identifier}` } : undefined; },
    originalLabel(parser) { return parser === 'google-cloud-logging' ? 'Provider entry (SDK reconstruction)' : 'Original file entry'; },
  }),
});

/** Existing SQLite-demo entry link, owned by the same source presentation. */
export function demoLogEvidenceMapping(dataset: string | undefined) {
  return dataset === 'northwind'
    ? { collection: 'Orders', field: 'OrderID', path: '/demo/logs', queryParam: 'order' } as const
    : undefined;
}
