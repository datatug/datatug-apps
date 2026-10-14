import { IQueryDef, ITextQueryRequest, QueryType } from '../models/definition/query-def';
import { ContextEntryRevision, ContextRun, ContextSubject, ContextDefinitionDocument, sameContextSubject } from './session-context-contract';
import { sessionResultFingerprint } from './session-result-fingerprint';
import type { TypedValue } from '@sneat/datatug-semantic';

export const INVOICE_DASHBOARD_ID = 'chinook-invoice-overview';
export const INVOICE_DASHBOARD_REVISION = 'chinook-invoice-overview-1';
export function invoiceDashboardDocument(): ContextDefinitionDocument {
  const ids = ['lines', 'genres'] as const;
  const queries = ids.map((id) => {
    const query = invoiceWidgetQuery(id);
    const request = query.request as ITextQueryRequest;
    if (!query.id || !query.parameters || request.queryType !== QueryType.SQL)
      throw new Error(`The ${id} dashboard query is incomplete.`);
    return { id: query.id, queryType: 'SQL' as const, text: request.text, connectionId: query.connectionId,
      parameters: query.parameters.map(({ id: parameterId, type, isRequired }) => ({ id: parameterId, type, isRequired })) };
  });
  return { schemaVersion: 1, kind: 'dashboard', queries,
    widgets: queries.map((query, index) => ({ id: ids[index], queryId: query.id })) };
}
export const INVOICE_LINE_SQL = `SELECT il.InvoiceLineId, il.InvoiceId, t.Name AS Track, g.Name AS Genre,
il.Quantity, il.UnitPrice, ROUND(il.Quantity * il.UnitPrice, 2) AS Amount
FROM InvoiceLine il JOIN Track t ON t.TrackId = il.TrackId
JOIN Genre g ON g.GenreId = t.GenreId WHERE il.InvoiceId = ?
ORDER BY il.InvoiceLineId LIMIT 1000`;
export const INVOICE_GENRE_SQL = `SELECT g.GenreId, g.Name AS Genre,
ROUND(SUM(il.Quantity * il.UnitPrice), 2) AS Amount
FROM InvoiceLine il JOIN Track t ON t.TrackId = il.TrackId
JOIN Genre g ON g.GenreId = t.GenreId WHERE il.InvoiceId = ?
GROUP BY g.GenreId, g.Name ORDER BY Amount DESC, g.GenreId LIMIT 1000`;

type CachedDashboardWidget =
  | { readonly state: 'completed'; readonly resultRef: string; readonly rows: Record<string, unknown>[]; readonly columns: readonly { readonly field?: string }[] }
  | { readonly state: 'failed'; readonly error: string };

/** A partial failed dashboard may still have independently confirmed widgets. */
export async function matchesInvoiceDashboardReceipt(
  widgets: Readonly<Record<'lines' | 'genres', CachedDashboardWidget>>,
  run: Pick<ContextRun, 'state' | 'widgets'>,
): Promise<boolean> {
  if (!['completed', 'failed'].includes(run.state)) return false;
  for (const id of ['lines', 'genres'] as const) {
    const local = widgets[id], receipt = run.widgets?.find((widget) => widget.id === id);
    if (local.state === 'failed') {
      if (receipt?.state !== 'failed') return false;
      continue;
    }
    if (receipt?.state !== 'completed' || receipt.resultRef !== local.resultRef ||
      receipt.resultRef !== await sessionResultFingerprint({ columns: local.columns, rows: local.rows })) return false;
  }
  return true;
}

export function invoiceWidgetQuery(widget: 'lines' | 'genres'): IQueryDef {
  return {
    id: `${INVOICE_DASHBOARD_ID}-${widget}`, title: widget === 'lines' ? 'Invoice lines' : 'Amount by genre',
    connectionId: 'chinook-sqlite',
    parameters: [{ id: 'InvoiceId', type: 'integer', isRequired: true, meta: { entity: 'invoice', field: 'InvoiceId' } }],
    request: { queryType: QueryType.SQL, text: widget === 'lines' ? INVOICE_LINE_SQL : INVOICE_GENRE_SQL } as ITextQueryRequest,
    // This is a declared key reference in the pinned Chinook ModelSpec. The
    // exact fixture hash is admitted independently by the existing runtime.
    relationshipBindings: [{ id: 'chinook.InvoiceLine.InvoiceId->Invoice.InvoiceId', version: INVOICE_DASHBOARD_REVISION,
      from: { schema: 'main', table: 'InvoiceLine' }, to: { schema: 'main', table: 'Invoice' },
      pairs: [{ fromField: 'InvoiceId', toField: 'InvoiceId' }] }],
  };
}

export function invoiceInput(revisions: readonly ContextEntryRevision[], admittedSubjects: readonly ContextSubject[]): TypedValue {
  const candidates = revisions.filter((revision) => revision.subject.conceptId === 'invoice' && revision.subject.fieldId === 'InvoiceId');
  if (candidates.length !== 1) throw new Error(candidates.length ? 'Choose one invoice entry; multiple candidates are ambiguous.' : 'Apply an Invoice → InvoiceId entry in this environment.');
  if (!admittedSubjects.some((subject) => sameContextSubject(subject, candidates[0].subject)))
    throw new Error('This invoice entry uses an unavailable or different source/model/meaning revision. Review its mapping before binding.');
  const value = candidates[0].value;
  if (value.schemaVersion !== 1 || value.kind !== 'scalar' || value.scalar?.type !== 'integer')
    throw new Error('This dashboard needs one integer InvoiceId. Choose a scalar; a cohort never binds its first member.');
  return value.scalar;
}
