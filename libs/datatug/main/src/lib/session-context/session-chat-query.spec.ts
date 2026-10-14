import { sessionChatQuery } from './session-chat-query';
import { ContextEntryRevision } from './session-context-contract';
import { ITextQueryRequest } from '../models/definition/query-def';
const admittedInvoiceSubject = { conceptId: 'invoice', fieldId: 'InvoiceId', fieldMappingRef: 'admitted-fixture-mapping', modelRevision: 'pinned-model', graphRevision: 'pinned-meaning' };
const invoiceRevision: ContextEntryRevision = { id: 'r1', entryId: 'e1', bagId: 'b1', subject: admittedInvoiceSubject,
  value: { schemaVersion: 1, kind: 'scalar', scalar: { type: 'integer', value: '1' } }, createdAt: '' };

describe('pinned session chat execution', () => {
  const query = JSON.stringify({ from: { schema: 'main', name: 'InvoiceLine' }, limit: 100 });
  it('turns the attached immutable scalar into an actual typed SQL parameter', () => {
    const result = sessionChatQuery(query, [invoiceRevision], [admittedInvoiceSubject]);
    const sql = (result.definition.request as ITextQueryRequest).text;
    expect(sql).toContain('"InvoiceId" = ?');
    expect(sql).not.toContain('"InvoiceId" = 1');
    expect(result.definition.parameters?.[0].id).toBe('InvoiceId');
    expect(result.invoiceId).toBe('1');
  });
  it('rejects a conflicting model filter instead of executing with hidden mixed inputs', () => {
    const conflict = JSON.stringify({ from: { schema: 'main', name: 'Invoice' }, where: { op: '==', left: { field: 'InvoiceId' }, right: { value: 2 } }, limit: 100 });
    expect(() => sessionChatQuery(conflict, [invoiceRevision], [admittedInvoiceSubject])).toThrow('conflicts');
  });
  it('rejects unrelated tables and unadmitted semantic pins', () => {
    expect(() => sessionChatQuery(JSON.stringify({ from: { schema: 'main', name: 'Customer' }, limit: 10 }), [invoiceRevision], [admittedInvoiceSubject])).toThrow('unrelated');
    expect(() => sessionChatQuery(query, [invoiceRevision], [])).toThrow('unavailable');
  });
});
