import type { TypedValue } from '@sneat/datatug-semantic';
import {
  PUBLIC_CHINOOK_CUSTOMER_FK,
  type PublicSqliteExecutionReceipt,
} from '../../public-sqlite-tugql';

/**
 * Return a CustomerId only when a current worker receipt proves the exact
 * admitted Invoice-to-Customer relationship and the selected typed cell's
 * source lineage. Output names are checked only for column alignment; they do
 * not establish semantic identity.
 */
export function customerIdLookupValue(
  receipt: PublicSqliteExecutionReceipt | undefined,
  columnIndex: number,
  columnName: string,
  cell: TypedValue | undefined,
  isCurrentRun: boolean,
): string | undefined {
  if (
    !isCurrentRun ||
    !hasVerifiedCustomerIdLineage(receipt, columnIndex, columnName) ||
    !cell ||
    cell.type !== 'integer'
  ) {
    return undefined;
  }

  if (!/^[1-9]\d*$/u.test(cell.value)) return undefined;
  const id = Number(cell.value);
  return Number.isSafeInteger(id) && id > 0 ? cell.value : undefined;
}

export function hasVerifiedCustomerIdLineage(
  receipt: PublicSqliteExecutionReceipt | undefined,
  columnIndex: number,
  columnName: string,
): boolean {
  const relationship = receipt?.relationship;
  const pair = relationship?.pairs[0];
  if (
    !receipt ||
    !relationship ||
    relationship.id !== PUBLIC_CHINOOK_CUSTOMER_FK ||
    relationship.version.length === 0 ||
    relationship.joinType !== 'inner' ||
    !relationship.fromSource ||
    !relationship.toSource ||
    relationship.fromSource === relationship.toSource ||
    relationship.pairs.length !== 1 ||
    pair?.fromField !== 'CustomerId' ||
    pair.toField !== 'CustomerId' ||
    !Number.isSafeInteger(columnIndex) ||
    columnIndex < 0 ||
    !columnName
  ) {
    return false;
  }

  const output = receipt.outputColumns?.[columnIndex];
  const lineage = output?.lineage;
  return !(
    output?.name !== columnName ||
    output.type !== 'integer' ||
    lineage?.length !== 1 ||
    lineage[0]?.field !== 'CustomerId' ||
    ![relationship.fromSource, relationship.toSource].includes(
      lineage[0]?.source ?? '',
    )
  );
}
