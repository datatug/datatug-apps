import { isJoinedTugQLQuery, parseTugQLYaml, type TugQLSchema } from '@dalgo/core';
import { CHINOOK_SCHEMA } from '../chat/chat.types';
import { chatSQLite, chatTugqlYaml } from '../chat/chat-query-format';
import { IQueryDef, ITextQueryRequest, QueryType } from '../models/definition/query-def';
import { ContextEntryRevision, ContextSubject } from './session-context-contract';
import { invoiceInput, invoiceWidgetQuery } from './invoice-dashboard';

/** Validate the existing interpreter action and bind an explicit pinned invoice through its declared key/FK. */
export function sessionChatQuery(tugql: string, revisions: readonly ContextEntryRevision[], admittedSubjects: readonly ContextSubject[]): { definition: IQueryDef; yaml: string; invoiceId: string } {
  const query = parseTugQLYaml(tugql, CHINOOK_SCHEMA as unknown as TugQLSchema, { maxLimit: 1000 });
  if (isJoinedTugQLQuery(query)) throw new Error('Choose Invoice or InvoiceLine for this first session chat adapter. JOIN proposals need a reviewed relationship choice.');
  if (!['main.Invoice', 'main.InvoiceLine'].includes(query.source.name)) throw new Error('This session chat adapter supports the declared Invoice → InvoiceLine relationship. Choose that source; unrelated tables are not read automatically.');
  const value = invoiceInput(revisions, admittedSubjects);
  if (value.type !== 'integer' || !Number.isSafeInteger(Number(value.value))) throw new Error('This source cannot represent the pinned InvoiceId losslessly.');
  for (const filter of query.filters.filter((filter) => filter.field === 'InvoiceId')) {
    if (filter.operator !== '==' || typeof filter.value !== 'number' || filter.value !== Number(value.value))
      throw new Error('The proposed InvoiceId conflicts with the attached revision. Correct the question or attachment.');
  }
  const bound = { ...query, filters: [...query.filters.filter((filter) => filter.field !== 'InvoiceId'), { field: 'InvoiceId', operator: '==' as const, value: Number(value.value) }] };
  return { definition: { id: 'session-chat-query', title: 'Session chat result', connectionId: 'chinook-sqlite', parameters: invoiceWidgetQuery('lines').parameters,
    request: { queryType: QueryType.SQL, text: chatSQLite(bound, ['InvoiceId']) } as ITextQueryRequest,
    relationshipBindings: invoiceWidgetQuery('lines').relationshipBindings,
  }, yaml: chatTugqlYaml(bound), invoiceId: value.value };
}
