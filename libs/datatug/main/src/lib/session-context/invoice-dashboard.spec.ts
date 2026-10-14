import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import initSqlJs from 'sql.js';
import { executePinnedSql } from '../queries/public-sqlite-query.worker';
import { invoiceInput, INVOICE_LINE_SQL, INVOICE_GENRE_SQL, matchesInvoiceDashboardReceipt } from './invoice-dashboard';
import { ContextEntryRevision } from './session-context-contract';
import { sessionResultFingerprint } from './session-result-fingerprint';

export const admittedInvoiceSubject = { conceptId: 'invoice', fieldId: 'InvoiceId',
  fieldMappingRef: 'https://github.com/demo-db/chinook/blob/95d14a11256f8db512d5ecd7ea5be56e01d51781/model/chinook.modelspec.json#/records/Invoice/fields/InvoiceId',
  modelRef: 'modelspec:///chinook.Invoice', modelRevision: '19be3e0f575e14aa999769da79ba3ecb7fe3cb7e6a7dee151399dcbebfc56a7b',
  graphResource: 'https://github.com/demo-db/chinook/blob/95d14a11256f8db512d5ecd7ea5be56e01d51781/model/chinook.meaning.yaml',
  graphRevision: '08070167da1626c3fd51f6555e846cd8aa1aa068a533db45c53394127bb0fcad', record: 'Invoice', fields: ['InvoiceId'] };
export const invoiceRevision: ContextEntryRevision = { id: 'r1', entryId: 'e1', bagId: 'b1', subject: admittedInvoiceSubject,
  value: { schemaVersion: 1, kind: 'scalar', scalar: { type: 'integer', value: '1' } }, createdAt: '' };

describe('Invoice input compatibility', () => {
  it('requires exact admitted mapping and model/meaning revisions', () => {
    expect(invoiceInput([invoiceRevision], [admittedInvoiceSubject])).toEqual({ type: 'integer', value: '1' });
    for (const field of ['fieldMappingRef', 'modelRevision', 'graphRevision'] as const) {
      expect(() => invoiceInput([{ ...invoiceRevision, subject: { ...admittedInvoiceSubject, [field]: 'other' } }], [admittedInvoiceSubject])).toThrow('different source/model/meaning');
    }
    expect(() => invoiceInput([invoiceRevision], [])).toThrow('unavailable');
  });
  it('blocks ambiguous candidates and never takes a cohort first member', () => {
    expect(() => invoiceInput([invoiceRevision, { ...invoiceRevision, id: 'r2', entryId: 'e2' }], [admittedInvoiceSubject])).toThrow('ambiguous');
    expect(() => invoiceInput([{ ...invoiceRevision, value: { schemaVersion: 1, kind: 'set', values: [{ type: 'integer', value: '1' }] } }], [admittedInvoiceSubject])).toThrow('cohort');
  });
});

it('restores the completed widget from a partial failed dashboard only when its content fingerprint matches', async () => {
  const rows = [{ InvoiceLineId: 1 }], columns = [{ field: 'InvoiceLineId' }];
  const resultRef = await sessionResultFingerprint({ columns, rows });
  const cached = {
    lines: { state: 'completed' as const, resultRef, columns, rows },
    genres: { state: 'failed' as const, error: 'Source unavailable' },
  };
  const run = { state: 'failed', widgets: [
    { id: 'lines', state: 'completed', resultRef },
    { id: 'genres', state: 'failed', errorCode: 'SOURCE_QUERY_FAILED' },
  ] } as const;
  expect(await matchesInvoiceDashboardReceipt(cached, run)).toBe(true);
  expect(await matchesInvoiceDashboardReceipt(cached, { ...run, widgets: [
    { id: 'lines', state: 'completed', resultRef: 'sha256-wrong' },
    run.widgets[1],
  ] })).toBe(false);
});

const fixturePath = process.env['DATATUG_CHINOOK_FIXTURE'];
it.skipIf(!fixturePath)('runs real Invoice1 grid and genre chart from the exact admitted fixture', async () => {
  if (!fixturePath) throw new Error('The admitted Chinook fixture path is unavailable.');
  const fixture = readFileSync(fixturePath);
  await initSqlJs();
  expect(createHash('sha256').update(fixture).digest('hex')).toBe('7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15');
  const lines = await executePinnedSql(INVOICE_LINE_SQL, fixture, [1]);
  const genres = await executePinnedSql(INVOICE_GENRE_SQL, fixture, [1]);
  expect(lines.rows).toHaveLength(2);
  expect(lines.rows.every((row) => row[1] === 1)).toBe(true);
  expect(lines.rows.reduce((total, row) => total + Number(row[6]), 0)).toBeCloseTo(1.98);
  expect(genres.rows.reduce((total, row) => total + Number(row[2]), 0)).toBeCloseTo(1.98);
  expect(genres.rows.every((row) => typeof row[1] === 'string' && Number(row[2]) > 0)).toBe(true);
  await expect(executePinnedSql('SELECT * FROM MissingGenre WHERE InvoiceId = ?', fixture, [1])).rejects.toThrow();
  await expect(executePinnedSql('SELECT 1; DELETE FROM Invoice', fixture)).rejects.toThrow('one read-only');
});
