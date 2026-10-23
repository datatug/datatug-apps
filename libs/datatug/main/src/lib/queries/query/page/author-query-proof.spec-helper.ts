import type { RecursiveTugQLQuery } from '@dalgo/core';
import type { PublicSqliteQueryPreview } from '../../public-sqlite-tugql';

const invoiceQuery = {
  kind: 'recursive-tugql',
  from: { kind: 'table', name: 'Invoice', alias: 'i', joins: [] },
  limit: 7,
  columns: [
    {
      expression: {
        kind: 'field',
        field: { source: 'i', field: 'InvoiceId' },
      },
    },
  ],
} satisfies RecursiveTugQLQuery;

export function testAuthorProof(): PublicSqliteQueryPreview['authorProof'] {
  return {
    profile: 'invoice-query',
    resolvedQuery: invoiceQuery,
  };
}
