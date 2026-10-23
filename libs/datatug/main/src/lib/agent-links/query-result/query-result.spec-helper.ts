/**
 * A stored result as `GET /datatug/results/<id>` answers it, for the result page specs: an ad-hoc TugQL query of
 * Invoice joined to Customer on a registered project database. The row values are made-up markers.
 */
export const ROW_MARKER = 'row-value-marker-41';

export function invoiceCustomerResult(
  overrides: {
    meta?: Record<string, unknown>;
    query?: Record<string, unknown>;
    db?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    meta: {
      format: 'datatug.query-result.meta',
      version: 1,
      id: 't4',
      createdAt: '2026-10-16T08:00:00Z',
      expiresAt: '2026-10-23T08:00:00Z',
      cliVersion: 'v0.94.0',
      dataBytes: 100,
      db: {
        ref: 'datatug://demo/chinook?env=local',
        project: 'demo',
        env: 'local',
        source: 'chinook',
        driver: 'sqlite3',
        ...overrides.db,
      },
      query: {
        kind: 'tugql',
        tugql: 'from: Invoice i\njoin: Customer c on i.CustomerId = c.CustomerId\n',
        policy: 'discovered',
        ...overrides.query,
      },
      rows: { kept: 2, hasMore: true, truncatedBy: 'rows' },
      provenance: null,
      columns: [
        {
          name: 'InvoiceId',
          type: 'integer',
          declaredType: 'INTEGER',
          nullable: false,
          pk: 1,
          source: {
            instance: 'root',
            schema: '',
            relation: 'Invoice',
            column: 'InvoiceId',
          },
          foreignKeys: [],
        },
        {
          name: 'CustomerId',
          type: 'integer',
          declaredType: 'INTEGER',
          nullable: false,
          pk: null,
          source: {
            instance: 'root',
            schema: '',
            relation: 'Invoice',
            column: 'CustomerId',
          },
          foreignKeys: [
            { refSchema: '', refRelation: 'Customer', refColumn: 'CustomerId' },
          ],
        },
        {
          name: 'FirstName',
          type: 'string',
          declaredType: null,
          nullable: null,
          pk: null,
          source: null,
          foreignKeys: [],
          cutCells: 1,
        },
      ],
      participants: [
        {
          instance: 'root',
          schema: '',
          relation: 'Invoice',
          alias: 'i',
          kind: 'table',
          role: 'from',
        },
        {
          instance: 'c',
          schema: '',
          relation: 'Customer',
          alias: 'c',
          kind: 'table',
          role: 'join',
          join: {
            type: 'inner',
            on: [{ left: 'i.CustomerId', right: 'c.CustomerId' }],
          },
        },
      ],
      related: [
        {
          candidateId: 'root:fk_invoiceline_invoice',
          fromInstance: 'root',
          target: { schema: '', relation: 'InvoiceLine', kind: 'table' },
          constraintId: 'fk_invoiceline_invoice',
          direction: 'incoming',
          cardinality: 'one-to-many',
          fields: [{ sourceField: 'InvoiceId', targetField: 'InvoiceId' }],
          evidence: 'foreign-key',
        },
        {
          candidateId: 'c:fk_customer_employee',
          fromInstance: 'c',
          target: { schema: '', relation: 'Employee', kind: 'table' },
          constraintId: 'fk_customer_employee',
          direction: 'outgoing',
          cardinality: 'many-to-one',
          fields: [{ sourceField: 'SupportRepId', targetField: 'EmployeeId' }],
          evidence: 'foreign-key',
        },
      ],
      unavailable: {},
      ...overrides.meta,
    },
    recordset: {
      columns: [
        { name: 'InvoiceId', type: 'integer' },
        { name: 'CustomerId', type: 'integer' },
        { name: 'FirstName', type: 'string' },
      ],
      rows: [
        [
          { type: 'integer', value: '9007199254740993' },
          { type: 'integer', value: '2' },
          { type: 'string', value: ROW_MARKER },
        ],
        [
          { type: 'integer', value: '2' },
          { type: 'integer', value: '4' },
          { type: 'string', value: 'second-row' },
        ],
      ],
    },
  };
}

/** The prompt of the fixtures: markup on purpose, to show it is only ever drawn as text. */
export const PROMPT_TEXT = 'show the invoices <b id="x">of customer 2</b> & their names';
/** The query text of the fixtures. */
export const TUGQL_TEXT = 'from: Invoice i\njoin: Customer c on i.CustomerId = c.CustomerId\n';

/**
 * The answer of an agent with the editor-ready members (datatug-cli#431): `query.text`, `language`, `dbRef` and
 * `params` in both `meta.query` and the top-level `query`, and the prompt as `meta.prompt` and top-level `prompt`.
 */
export function editorReadyResult(
  options: {
    query?: Record<string, unknown>;
    prompt?: { text: string; truncated?: boolean } | null;
    unavailable?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const query = {
    kind: 'tugql',
    tugql: TUGQL_TEXT,
    policy: 'discovered',
    text: TUGQL_TEXT,
    language: 'tugql',
    dbRef: 'datatug://demo/chinook?env=local',
    params: [
      { name: 'CustomerId', value: { type: 'integer', value: '2' } },
      { name: 'Countries', value: { type: 'set', values: [{ type: 'string', value: 'FR' }] } },
    ],
    ...options.query,
  };
  const prompt =
    options.prompt === null
      ? undefined
      : { text: PROMPT_TEXT, truncated: false, at: '2026-10-16T08:00:01Z', ...options.prompt };
  const base = invoiceCustomerResult({
    query,
    meta: { ...(prompt ? { prompt } : {}), ...(options.unavailable ? { unavailable: options.unavailable } : {}), ...options.meta },
  });
  return { ...base, query, ...(prompt ? { prompt: prompt.text } : {}) };
}
