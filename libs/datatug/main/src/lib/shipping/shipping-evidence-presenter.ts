import {
  originalLogText,
  type OriginalEvidence,
  type OriginalRecord,
} from '../evidence/original-evidence-contract';
import type { RetainedSourceOperationView } from '../evidence/source-operation-contract';
import type { SourceEvidencePresenter } from '../evidence/source-evidence-presentation';
import type { SourceFact } from '../source-workspace/source-workspace-contract';
import { SHIPPING_SOURCE } from './shipping-api.service';

/** Projection of already validated owner responses. Never reads or grants source access. */
export const shippingEvidencePresenter: SourceEvidencePresenter = {
  sourceId: SHIPPING_SOURCE,
  operation(value) {
    const data = value as RetainedSourceOperationView;
    if (data.reference.sourceId !== SHIPPING_SOURCE)
      throw new Error('Source receipt presentation is unavailable.');
    const receipt = data.receipt,
      revision = receipt.revision;
    const facts: SourceFact[] = [
      { label: 'Actor', value: receipt.actorId },
      { label: 'Operation', value: receipt.operationId },
      { label: 'Accepted', value: receipt.acceptedAt, kind: 'time' },
      { label: 'Generation', value: data.reference.result.generation },
      { label: 'Revision', value: String(data.reference.result.revision) },
      { label: 'Source', value: data.reference.sourceId },
      { label: 'SHA-256', value: data.reference.result.sha256, kind: 'hash' },
      {
        label: 'Request SHA-256',
        value: data.reference.requestSHA256,
        kind: 'hash',
      },
      { label: 'Revision producer', value: revision.actorId },
      { label: 'Revision accepted', value: revision.acceptedAt, kind: 'time' },
      { label: 'Routing configuration', value: String(revision.configuration) },
      {
        label: 'Fixture business clock',
        value: revision.businessClock,
        kind: 'time',
      },
      ...revision.artifacts.map((item) => ({
        label: item.id,
        value: item.sha256,
        kind: 'hash' as const,
      })),
    ];
    return {
      title: `${receipt.action} · ${receipt.outcome === 'already-applied' ? 'No new change' : 'Applied'}`,
      summary:
        receipt.outcome === 'already-applied'
          ? 'No new processing attempt is established by this receipt.'
          : 'Original source receipt. This does not prove recovery.',
      sections: [
        { title: 'Original receipt', facts: facts.slice(0, 5) },
        { title: 'Immutable receipt details', collapsed: true, facts: facts.slice(5) },
      ],
    };
  },
  original(value) {
    const data = value as OriginalEvidence;
    if (data.status === 'unavailable')
      return { status: 'unavailable', reason: data.reason };
    const highlighted: Record<string, readonly string[]> = {
      events: ['kind', 'occurred_at'],
      attempts: ['state', 'attempt_no', 'config_revision'],
      requests: ['order_id', 'shipper_id'],
      configurations: ['published_at'],
      routes: ['partner_id', 'valid_from', 'valid_until'],
      partners: ['enabled'],
    };
    const fields = (record: OriginalRecord) =>
      Object.entries(record.fields).map(([label, cell]) => ({
        label,
        value: cell.type === 'null' ? 'NULL' : String(cell.value),
      }));
    const text = originalLogText(data.log);
    return {
      status: 'available',
      summary: `Synthetic Shipping source · historical configuration ${data.records[3].key.value}`,
      notices: [
        'Route candidates show actual validity intervals without a current-time status. Multiple candidates do not establish a unique causal route.',
      ],
      ...(data.records.length === 4
        ? {
            emptyMessage:
              'No route candidates in this historical configuration.',
          }
        : {}),
      records: data.records.map((record) => ({
        title: `${record.collection} · ${record.key.value}`,
        facts: fields(record)
          .filter((field) =>
            highlighted[record.collection]?.includes(field.label),
          )
          .map((field) => ({
            ...field,
            emphasized:
              record.collection === 'routes' &&
              field.label.startsWith('valid_'),
          })),
        fields: fields(record),
      })),
      log: { ...data.log, ...(text !== undefined ? { text } : {}) },
    };
  },
};
