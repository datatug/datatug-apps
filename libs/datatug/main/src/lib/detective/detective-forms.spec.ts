import {
  displayInputValue,
  identifierProposals,
  parseInputValue,
  resultLines,
  validatorGridRows,
} from './detective-forms';

describe('Detective form values', () => {
  it('offers separate sets from a pasted ticket without treating text as confirmed context', () => {
    const proposals = identifierProposals(
      'Order IDs: ORD-1, ORD-2 and ORD-3; Invoice IDs: INV-7, INV-9 and INV-10.',
    );
    expect(proposals.map(({ key, value }) => ({ key, value }))).toEqual([
      {
        key: 'order_id',
        value: {
          type: 'set',
          values: ['ORD-1', 'ORD-2', 'ORD-3'].map((value) => ({
            type: 'string',
            value,
          })),
        },
      },
      {
        key: 'invoice_id',
        value: {
          type: 'set',
          values: ['INV-7', 'INV-9', 'INV-10'].map((value) => ({
            type: 'string',
            value,
          })),
        },
      },
    ]);
  });
  it('retains single-digit IDs when the pasted text explicitly labels their type', () => {
    expect(identifierProposals('Invoice IDs: 7, 9 and 10.')).toEqual([
      {
        key: 'invoice_id',
        value: {
          type: 'set',
          values: ['7', '9', '10'].map((value) => ({ type: 'string', value })),
        },
        evidence: 'Invoice IDs: 7, 9 and 10',
      },
    ]);
  });
  it('retains integer precision in multi-value investigation context', () => {
    const value = parseInputValue(
      '9007199254740993, 9007199254740995',
      'integer',
      'set',
    );
    expect(value).toEqual({
      type: 'set',
      values: [
        { type: 'integer', value: '9007199254740993' },
        { type: 'integer', value: '9007199254740995' },
      ],
    });
    expect(displayInputValue(value)).toBe('9007199254740993, 9007199254740995');
  });

  it('requires two typed range endpoints', () => {
    expect(() => parseInputValue('2026-10-01', 'date', 'range')).toThrow(
      'Both range endpoints',
    );
    expect(
      parseInputValue('2026-10-01', 'date', 'range', '2026-10-12'),
    ).toEqual({
      type: 'range',
      start: { type: 'date', value: '2026-10-01' },
      end: { type: 'date', value: '2026-10-12' },
    });
  });

  it('keeps nested Validator row positions and child Checks in result order', () => {
    const lines = resultLines([
      {
        stepId: 'query',
        kind: 'query',
        queryId: 'invoices',
        executionStatus: 'completed',
        outcome: 'fail',
        validators: [
          {
            validatorId: 'amount-positive',
            executionStatus: 'completed',
            outcome: 'fail',
            severity: 'error',
            rowIndex: 2,
            children: [
              {
                stepId: 'child',
                kind: 'check',
                checkId: 'invoice-audit',
                executionStatus: 'completed',
                outcome: 'pass',
              },
            ],
          },
        ],
      },
    ]);
    expect(
      lines.map(({ label, depth, rowIndex }) => ({ label, depth, rowIndex })),
    ).toEqual([
      { label: 'Query invoices', depth: 0, rowIndex: undefined },
      { label: 'Validator amount-positive', depth: 1, rowIndex: 2 },
      { label: 'Check invoice-audit', depth: 2, rowIndex: undefined },
    ]);
  });

  it('shows filterable per-row status from the exact Validator run', () => {
    const rows = validatorGridRows([
      {
        stepId: 'query',
        kind: 'query',
        queryId: 'invoices',
        executionStatus: 'completed',
        outcome: 'fail',
        validators: [
          {
            validatorId: 'amount-positive',
            executionStatus: 'completed',
            outcome: 'fail',
            severity: 'error',
            rowIndex: 2,
          },
          {
            validatorId: 'count',
            executionStatus: 'completed',
            outcome: 'pass',
            severity: 'info',
          },
        ],
      },
    ]);
    expect(
      rows.map(({ query, row, validator, outcome }) => ({
        query,
        row,
        validator,
        outcome,
      })),
    ).toEqual([
      {
        query: 'invoices',
        row: '3',
        validator: 'amount-positive',
        outcome: 'fail',
      },
      { query: 'invoices', row: 'Set', validator: 'count', outcome: 'pass' },
    ]);
  });
});
