import { prepareGroupedBars } from '../held-result-presentation/grouped-bars';
import {
  chartEvidenceError,
  decodeSourceRightsEvidence,
} from '@sneat/datatug-semantic';
import type { FederatedQueryResult } from '../../../../queries/federated-query-executor';
import type { IQueryDef } from '../../../../models/definition/query-def';
import type { BoardResultSnapshot } from './board-widget.component';
import { NORTHWIND_ORDERS_PIN } from '../../../../queries/public-data/public-orders-admission';
import { PUBLIC_ORDERS_QUERY_ID } from '../../../../queries/public-data/public-chart-query';
const pair = ['chinook/Customer', 'northwind/Customers'];
/** Distinct admission arm: never turns a root result into a one-collection profiled result. */
export function admitComparisonChart(
  result: FederatedQueryResult,
  definition: IQueryDef,
): void {
  const fail = (): never => {
    throw new Error(
      'This chart source needs the complete admitted 17-country Northwind/Chinook result.',
    );
  };
  const actual = result.ordinarySources
    ?.map((source) => `${source.database}/${source.collection}`)
    .sort();
  const planned = definition.federation?.tables
    .map((source) => `${source.database}/${source.name}`)
    .sort();
  if (
    definition.federation?.ovdbBaseUrl !== 'https://cloud.openvaultdb.com' ||
    result.provenance.source !==
      'https://cloud.openvaultdb.com/v1/tugql (direct OVDB)' ||
    definition.id !== 'customer-country-comparison-server' ||
    !result.nativeDirect ||
    !result.ordinaryComplete ||
    result.totalRows !== 17 ||
    result.recordset.rows.length !== 17 ||
    result.hasMore ||
    result.truncated ||
    result.execution ||
    JSON.stringify(actual) !== JSON.stringify(pair) ||
    JSON.stringify(planned) !== JSON.stringify(pair)
  )
    fail();
  // Transport already checked live rights before materializing. Preserve absent
  // declarations, and reject malformed evidence without inventing licence/profile.
  decodeSourceRightsEvidence(result as unknown as Record<string, unknown>);
  if (
    result.recordset.columns.length !== 3 ||
    result.recordset.columns[0].name !== 'country' ||
    result.recordset.columns
      .slice(1)
      .some((column) => column.type !== 'integer') ||
    result.recordset.rows.some((row) =>
      row
        .slice(1)
        .some(
          (cell) =>
            !Number.isSafeInteger(Number(cell.value)) || Number(cell.value) < 0,
        ),
    )
  )
    fail();
  prepareGroupedBars(result, 'country', [
    { id: 'northwind', title: 'Northwind', valueColumn: 'northwindCustomers' },
    { id: 'chinook', title: 'Chinook', valueColumn: 'chinookCustomers' },
  ]);
}

export function completeOrdersForFilter(
  result: BoardResultSnapshot['result'],
  queryId: string,
  column: string,
): boolean {
  if (
    queryId !== PUBLIC_ORDERS_QUERY_ID ||
    column !== 'ShipCountry' ||
    !('runtime' in result) ||
    result.runtime !== 'browser-public-api' ||
    !result.complete ||
    result.hasMore ||
    result.truncated ||
    result.recordset.rows.length !== NORTHWIND_ORDERS_PIN.rows
  )
    return false;
  const receipt = result.publicApiReceipt;
  return (
    receipt.queryId === PUBLIC_ORDERS_QUERY_ID &&
    receipt.databaseId === 'northwind' &&
    receipt.collectionId === 'Orders' &&
    receipt.rowsReturned === 830 &&
    receipt.sourceVerification.kind === 'publisher-digest' &&
    receipt.sourceVerification.canonicalRowsSha256 ===
      NORTHWIND_ORDERS_PIN.canonicalRowsSha256 &&
    !chartEvidenceError(result) &&
    result.recordset.columns.some(
      (field) => field.name === column && field.type === 'string',
    )
  );
}

export interface FilteredOrdersPresentation {
  readonly result?: BoardResultSnapshot['result'];
  readonly country?: string;
  readonly count?: number;
  readonly error?: string;
}
/** Retains original rows/order/proof; returns only a display projection. Never executes. */
export function filterHeldOrders(
  result: BoardResultSnapshot['result'] | undefined,
  queryId: string,
  filter: { selectionId: string; column: string } | undefined,
  country: string | undefined,
): FilteredOrdersPresentation {
  if (!filter || country === undefined) return { result };
  if (!result)
    return {
      country,
      error:
        'Country filtering is unavailable: this card needs the complete verified 830-order result.',
    };
  if (!completeOrdersForFilter(result, queryId, filter.column))
    return {
      country,
      error:
        'Country filtering is unavailable: this card needs the complete verified 830-order result.',
    };
  const index = result.recordset.columns.findIndex(
    (column) => column.name === filter.column,
  );
  const rows = result.recordset.rows.filter(
    (row) => row[index]?.type === 'string' && row[index].value === country,
  );
  return {
    country,
    count: rows.length,
    result: { ...result, recordset: { ...result.recordset, rows } },
  };
}
