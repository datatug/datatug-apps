import {
  canonicalInputValue,
  canonicalSet,
  caseRunLinkMessage,
  detectiveParameterName,
  compatibleCaseInput,
  compatibleCaseInputs,
  displayInputValue,
  identifierProposals,
  parseInputValue,
  resultLines,
  validatorGridRows,
  validParameterBindings,
} from './detective-forms';

describe('Detective form values', () => {
  it('binds a confirmed seven-ID Case set only to a compatible set Check input', () => {
    const caseValue = {
      type: 'set' as const,
      values: Array.from({ length: 7 }, (_, index) => ({
        type: 'string' as const,
        value: String(index + 1),
      })),
    };
    expect(
      compatibleCaseInput(
        {
          name: 'invoice_id',
          type: 'string',
          cardinality: 'set',
          required: true,
        },
        caseValue,
      ),
    ).toBe(true);
    expect(
      compatibleCaseInput(
        {
          name: 'invoice_id',
          type: 'string',
          cardinality: 'scalar',
          required: true,
        },
        caseValue,
      ),
    ).toBe(false);
    expect(displayInputValue(caseValue)).toBe('1, 2, 3, 4, 5, 6, 7');
  });
  it('requires a Check to declare every confirmed Case cohort and range', () => {
    const context = {
      order_id: canonicalSet(
        ['101', '102', '103', '104', '105'].map((value) => ({
          type: 'string',
          value,
        })),
      ),
      invoice_id: canonicalSet(
        ['7', '8', '9', '10', '11', '12', '13'].map((value) => ({
          type: 'string',
          value,
        })),
      ),
      invoice_date: {
        type: 'range' as const,
        start: { type: 'date' as const, value: '2026-10-01' },
        end: { type: 'date' as const, value: '2026-10-12' },
      },
      analyst_note: { type: 'string' as const, value: 'confirmed separately' },
    };
    const inputs = [
      {
        name: 'order_id',
        type: 'string' as const,
        cardinality: 'set' as const,
        required: true,
      },
      {
        name: 'invoice_id',
        type: 'string' as const,
        cardinality: 'set' as const,
        required: true,
      },
      {
        name: 'invoice_date',
        type: 'date' as const,
        cardinality: 'range' as const,
        required: true,
      },
    ];
    expect(compatibleCaseInputs(inputs, context)).toBe(true);
    expect(compatibleCaseInputs(inputs.slice(1), context)).toBe(false);
    expect(compatibleCaseInputs(inputs.slice(0, 2), context)).toBe(false);
    expect(compatibleCaseInputs([], context)).toBe(false);
    expect(
      compatibleCaseInputs(
        [
          { ...inputs[1], cardinality: 'scalar' },
          ...inputs.filter((input) => input.name !== 'invoice_id'),
        ],
        context,
      ),
    ).toBe(false);
  });
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
          values: ['INV-10', 'INV-7', 'INV-9'].map((value) => ({
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
          values: ['10', '7', '9'].map((value) => ({ type: 'string', value })),
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

  it('matches Core canonical UTF-8 JSON-byte set order and deduplicates before persistence', () => {
    expect(
      parseInputValue('7, 8, 9, 10, 11, 12, 13, 7', 'integer', 'set'),
    ).toEqual({
      type: 'set',
      values: ['10', '11', '12', '13', '7', '8', '9'].map((value) => ({
        type: 'integer',
        value,
      })),
    });
    expect(
      canonicalSet(
        ['é', 'Ä', 'é', '&', '<'].map((value) => ({ type: 'string', value })),
      ),
    ).toEqual({
      type: 'set',
      values: ['&', '<', 'Ä', 'é'].map((value) => ({ type: 'string', value })),
    });
    expect(
      canonicalSet(
        ['😀', '\uffff', '\u2028', '&', '<', '😀'].map((value) => ({
          type: 'string',
          value,
        })),
      ),
    ).toEqual({
      type: 'set',
      values: ['&', '<', '\u2028', '\uffff', '😀'].map((value) => ({
        type: 'string',
        value,
      })),
    });
    expect(
      canonicalInputValue({
        type: 'set',
        values: [
          { type: 'integer', value: '7' },
          { type: 'integer', value: '10' },
        ],
      }),
    ).toEqual({
      type: 'set',
      values: [
        { type: 'integer', value: '10' },
        { type: 'integer', value: '7' },
      ],
    });
    expect(
      canonicalSet([
        { value: '7', type: 'integer' } as const,
        { type: 'integer', value: '10' } as const,
      ]).values.map((entry) => entry.value),
    ).toEqual(['10', '7']);
  });

  it('accepts the same exact parameter name domain as Core', () => {
    expect(detectiveParameterName.test('Invoice-ID')).toBe(true);
    expect(detectiveParameterName.test('A'.repeat(128))).toBe(true);
    expect(detectiveParameterName.test('A'.repeat(129))).toBe(false);
    expect(detectiveParameterName.test('0Invoice')).toBe(false);
    expect(
      validParameterBindings([
        { input: 'Invoice-ID', fromInput: 'A'.repeat(128) },
      ]),
    ).toBe(true);
    expect(
      validParameterBindings([
        { input: 'Invoice-ID', fromInput: 'A'.repeat(129) },
      ]),
    ).toBe(false);
  });

  it('does not describe a completed but unlinked Run as Case evidence', () => {
    expect(caseRunLinkMessage('case-1', 'run-1', 'case-archived')).toContain(
      'archived and was not linked',
    );
    expect(caseRunLinkMessage('case-1', 'run-1', 'case-changed')).toContain(
      'changed before its evidence could be linked',
    );
    expect(caseRunLinkMessage('case-1', 'run-1', undefined)).toContain(
      'linkage was not reported',
    );
    expect(caseRunLinkMessage('case-1', 'run-1', 'linked')).toContain(
      'is linked',
    );
    expect(caseRunLinkMessage(undefined, 'run-1', 'linked')).toBeUndefined();
    expect(
      caseRunLinkMessage('case-1', 'run-1', undefined, 'pending'),
    ).toContain('linkage is not confirmed');
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
