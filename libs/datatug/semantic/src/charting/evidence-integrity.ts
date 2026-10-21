import { decodeRecordset, decodeResult } from '../contract/decoders';
import type { Result, TypedValue } from '../contract/types';
import {
  decodeRowEvidence,
  evidenceKey,
  evidenceText,
  sameExecution,
} from './row-evidence';
import type {
  RowEvidence,
  RowEvidenceSelector,
  RowEvidenceSlot,
} from './row-evidence';

/** Canonical Core json.Marshal order/escaping, including negative zero. */
export function canonicalRecordsetJSON(recordset: Result['recordset']): string {
  const validated = decodeRecordset(recordset, 'recordset', true);
  const quote = (s: string) =>
    JSON.stringify(s).replace(
      /[<>&\u2028\u2029]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
  const columns = validated.columns;
  const rows = validated.rows;
  const cell = (v: TypedValue): string => {
    if (v.type === 'number' && !Number.isFinite(v.value))
      throw new Error('Nonfinite recordset value');
    const value =
      v.type === 'number'
        ? Object.is(v.value, -0)
          ? '-0'
          : JSON.stringify(v.value)
        : typeof v.value === 'string'
          ? quote(v.value)
          : JSON.stringify(v.value);
    return `{"type":${quote(v.type)},"value":${value}}`;
  };
  return `{"columns":[${columns.map((c) => `{"name":${quote(c.name)},"type":${quote(c.type)}}`).join(',')}],"rows":[${rows
    .map((row) => {
      if ((row?.length ?? 0) !== columns.length)
        throw new Error('Malformed held row');
      return `[${(row ?? []).map(cell).join(',')}]`;
    })
    .join(',')}]}`;
}

/** Standard browser SHA-256 over the exact published Core canonical bytes. */
export async function recordsetFingerprint(
  recordset: Result['recordset'],
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRecordsetJSON(recordset));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
}

/** Digest admission is asynchronous and occurs before selectors/refs leave preparation. */
export async function verifyRowEvidence(
  value: unknown,
  result: Result,
): Promise<RowEvidence> {
  const validated = decodeResult(result);
  const evidence = decodeRowEvidence(value, validated);
  if (
    evidence.recordsetFingerprint !==
    (await recordsetFingerprint(validated.recordset))
  )
    throw new Error('Row evidence fingerprint mismatch');
  return evidence;
}

/** Optional metadata is not authority. Consumers re-admit retention and rights on open. */
export async function resolveRowEvidence(
  result: Result,
  selector: RowEvidenceSelector,
): Promise<RowEvidenceSlot | undefined> {
  const validated = decodeResult(result);
  const expectedSelector = structuredClone(selector);
  evidenceKey(expectedSelector.rowKey);
  evidenceText(expectedSelector.slotColumn);
  if (!validated.rowEvidence) return undefined;
  const e = await verifyRowEvidence(validated.rowEvidence, validated);
  if (
    !sameExecution(e.execution, expectedSelector.execution) ||
    e.recordsetFingerprint !== expectedSelector.recordsetFingerprint ||
    e.rowKeyColumn !== expectedSelector.rowKeyColumn ||
    e.scope.storeId !== expectedSelector.scope.storeId ||
    e.scope.projectId !== expectedSelector.scope.projectId ||
    e.scope.environment !== expectedSelector.scope.environment ||
    e.scope.spaceID !== expectedSelector.scope.spaceID ||
    e.source.id !== expectedSelector.source.id ||
    e.source.generation !== expectedSelector.source.generation
  )
    throw new Error('Evidence selector mismatch');
  const row = e.rows.find(
    (r) => evidenceKey(r.rowKey) === evidenceKey(expectedSelector.rowKey),
  );
  const slot = row?.slots[expectedSelector.slotColumn];
  return slot?.state === 'available' ? structuredClone(slot) : undefined;
}
