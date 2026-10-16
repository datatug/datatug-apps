import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { classifyResultError } from '../agent-link-api.service';
import {
  ResultVersionError,
  cellText,
  columnRows,
  decodeRecordset,
  decodeStoredResult,
  parseDatatugRef,
  relatedRows,
  rerunBlocker,
  rerunRequest,
  resultRow,
  resultView,
  sourceRows,
  tableLink,
  unavailableText,
  validResultId,
} from './query-result';
import { invoiceCustomerResult } from './query-result.spec-helper';

const STORE = 'http-127.0.0.1:8989';
const decoded = (overrides?: Parameters<typeof invoiceCustomerResult>[0]) =>
  decodeStoredResult(invoiceCustomerResult(overrides));

describe('result route parameters', () => {
  it('accepts only ids of the CLI grammar', () => {
    expect(validResultId('t4')).toBe(true);
    expect(validResultId('a_B-9')).toBe(true);
    expect(validResultId('..')).toBe(false);
    expect(validResultId('a/b')).toBe(false);
    expect(validResultId('')).toBe(false);
    expect(validResultId(null)).toBe(false);
    expect(validResultId('x'.repeat(129))).toBe(false);
  });

  it('reads the view, table for anything unknown', () => {
    for (const v of ['table', 'record', 'columns', 'sources', 'related'])
      expect(resultView(v)).toBe(v);
    expect(resultView('chart')).toBe('table');
    expect(resultView(null)).toBe('table');
  });

  it('reads the row as a 1-based position, 1 for anything else', () => {
    expect(resultRow('3')).toBe(3);
    expect(resultRow('0')).toBe(1);
    expect(resultRow('-2')).toBe(1);
    expect(resultRow('2x')).toBe(1);
    expect(resultRow(undefined)).toBe(1);
  });
});

describe('decodeStoredResult', () => {
  it('reads the metadata and keeps every integer digit', () => {
    const { meta, recordset } = decoded();
    expect(meta.id).toBe('t4');
    expect(meta.db.source).toBe('chinook');
    expect(meta.query.kind).toBe('dtql');
    expect(meta.participants.map((p) => p.relation)).toEqual([
      'Invoice',
      'Customer',
    ]);
    expect(meta.participants[1].join?.on).toEqual([
      { left: 'i.CustomerId', right: 'c.CustomerId' },
    ]);
    expect(meta.related).toHaveLength(2);
    expect(meta.columns[2]).toMatchObject({
      declaredType: null,
      nullable: null,
      source: null,
      cutCells: 1,
    });
    expect(cellText(recordset.rows[0][0])).toBe('9007199254740993');
  });

  it('refuses a metadata format or version it does not know', () => {
    expect(() => decoded({ meta: { version: 2 } })).toThrow(ResultVersionError);
    expect(() => decoded({ meta: { format: 'other' } })).toThrow(
      ResultVersionError,
    );
    expect(() => decodeStoredResult(null)).toThrow(ResultVersionError);
  });

  it('reads malformed parts as empty, never throwing on them', () => {
    const { meta } = decoded({
      meta: {
        columns: 'x',
        participants: [null],
        related: [{}],
        rows: null,
        unavailable: { related: 5 },
      },
    });
    expect(meta.columns).toEqual([]);
    expect(meta.participants[0].relation).toBe('');
    expect(meta.related[0].fields).toEqual([]);
    expect(meta.rows).toEqual({ kept: 0, hasMore: false, truncatedBy: '' });
    expect(meta.unavailable).toEqual({});
    expect(
      decodeRecordset({ columns: [{ name: 'a' }], rows: [[{ bad: 1 }], 'x'] }),
    ).toEqual({
      columns: [{ name: 'a', type: '' }],
      rows: [[{ type: 'null', value: null }], []],
    });
    expect(cellText(undefined)).toBe('');
    expect(cellText({ type: 'boolean', value: false })).toBe('false');
  });
});

describe('the lists', () => {
  it('links every source to its table page on the result database', () => {
    const rows = sourceRows(decoded().meta, STORE);
    expect(rows.map((r) => r.name)).toEqual(['Invoice', 'Customer']);
    expect(rows[1].join).toBe('inner on i.CustomerId = c.CustomerId');
    expect(rows[0].alias).toBe('i');
    expect(rows[1].link?.commands).toEqual([
      `/store/${STORE}/project/demo/env`,
      'local',
      'db',
      'chinook',
      'table',
      'Customer',
    ]);
    expect(rows[1].link?.recordsCommands.at(-1)).toBe('records');
    expect(rows[1].link?.queryParams).toEqual({ schema: '' });
  });

  it('lists every related table with its join columns and cardinality, unfiltered', () => {
    const rows = relatedRows(decoded().meta, STORE);
    expect(
      rows.map((r) => [
        r.name,
        r.from,
        r.joinColumns,
        r.cardinality,
        r.direction,
      ]),
    ).toEqual([
      [
        'InvoiceLine',
        'i',
        'i.InvoiceId = InvoiceLine.InvoiceId',
        'one-to-many',
        'incoming',
      ],
      [
        'Employee',
        'c',
        'c.SupportRepId = Employee.EmployeeId',
        'many-to-one',
        'outgoing',
      ],
    ]);
    expect(rows[1].link?.commands.at(-1)).toBe('Employee');
  });

  it('describes each column, its source and its references', () => {
    const rows = columnRows(decoded().meta, STORE);
    expect(rows[0]).toMatchObject({
      name: 'InvoiceId',
      declaredType: 'INTEGER',
      nullable: 'no',
      pk: '1',
    });
    expect(rows[0].source?.label).toBe('Invoice.InvoiceId');
    expect(rows[1].foreignKeys[0].label).toBe('Customer.CustomerId');
    expect(rows[1].foreignKeys[0].link?.commands.at(-1)).toBe('Customer');
    expect(rows[2]).toMatchObject({
      declaredType: '',
      nullable: '',
      pk: '',
      notes: '1 long values cut',
    });
    expect(rows[2].source).toBeUndefined();
  });

  it("names SQLite's main schema as the schemaless one in links", () => {
    const meta = decoded({
      meta: {
        participants: [
          {
            instance: 'root',
            schema: 'main',
            relation: 'Invoice',
            alias: '',
            kind: 'table',
            role: 'from',
          },
        ],
        related: [
          {
            candidateId: 'x',
            fromInstance: 'root',
            target: { schema: 'main', relation: 'Customer', kind: 'table' },
            fields: [{ sourceField: 'CustomerId', targetField: 'CustomerId' }],
          },
        ],
      },
    }).meta;
    expect(sourceRows(meta, STORE)[0]).toMatchObject({
      name: 'Invoice',
      link: { queryParams: { schema: '' } },
    });
    expect(relatedRows(meta, STORE)[0].link?.queryParams).toEqual({
      schema: '',
    });
    const pg = decoded({
      db: { driver: 'postgres' },
      meta: {
        participants: [
          {
            instance: 'root',
            schema: 'main',
            relation: 'a',
            alias: '',
            kind: 'table',
            role: 'from',
          },
        ],
      },
    }).meta;
    expect(sourceRows(pg, STORE)[0].link?.queryParams).toEqual({
      schema: 'main',
    });
  });

  it('links no name when the database is not in a project', () => {
    const meta = decoded({
      db: { ref: null, project: null, env: null, source: null },
    }).meta;
    expect(sourceRows(meta, STORE).every((r) => !r.link)).toBe(true);
    expect(relatedRows(meta, STORE).every((r) => !r.link)).toBe(true);
    expect(columnRows(meta, STORE)[0].source?.link).toBeUndefined();
  });

  it('links a participant of a query over several databases to its own database', () => {
    const meta = decoded({
      meta: {
        participants: [
          {
            instance: 'root',
            schema: 'public',
            relation: 'orders',
            alias: 'o',
            db: 'datatug://shop/pg?env=prod',
            kind: 'view',
            role: 'from',
          },
          {
            instance: 'x',
            schema: '',
            relation: 'Bad',
            alias: '',
            db: 'not-a-ref',
            kind: 'table',
            role: 'join',
          },
        ],
      },
    }).meta;
    const rows = sourceRows(meta, STORE);
    expect(rows[0].link?.commands).toEqual([
      `/store/${STORE}/project/shop/env`,
      'prod',
      'db',
      'pg',
      'view',
      'orders',
    ]);
    expect(rows[0].name).toBe('public.orders');
    expect(rows[0].database).toBe('shop/pg (prod)');
    expect(rows[1].link).toBeUndefined();
    expect(rows[1].database).toBe('not-a-ref');
  });

  it('parses datatug references and builds table links', () => {
    expect(parseDatatugRef('datatug://p/d?env=e')).toEqual({
      project: 'p',
      env: 'e',
      source: 'd',
    });
    expect(parseDatatugRef('datatug:///d')).toBeUndefined();
    expect(parseDatatugRef('datatug://p/%E0?env=e')).toBeUndefined();
    expect(parseDatatugRef(null)).toBeUndefined();
    expect(
      tableLink(
        STORE,
        { project: 'p', env: 'e', source: 'd' },
        's',
        '',
        'table',
      ),
    ).toBeUndefined();
    expect(
      tableLink(
        'github.com',
        { project: 'repo@owner@data', env: 'dev', source: 'sqlite' },
        '',
        'Orders',
        'table',
      )?.commands,
    ).toEqual([
      '/project/github.com/owner/repo/tree/HEAD/data/-/env',
      'dev',
      'db',
      'sqlite',
      'table',
      'Orders',
    ]);
    expect(
      tableLink(
        'github.com',
        { project: 'invalid@id@extra@parts@x', env: 'dev', source: 'sqlite' },
        '',
        'Orders',
        'table',
      ),
    ).toBeUndefined();
  });

  it('says why a part is missing', () => {
    expect(unavailableText(undefined, 'sources')).toBe('');
    expect(unavailableText('native-sql', 'sources')).toContain('native SQL');
    expect(
      unavailableText('no-relationship-metadata', 'related tables'),
    ).toContain('no relationship metadata');
    expect(unavailableText('schema-unreadable', 'declared types')).toContain(
      'could not be read',
    );
    expect(unavailableText('too-many', 'related tables')).toContain('first');
    expect(unavailableText('other', 'x')).toContain('other');
  });
});

describe('Run again', () => {
  it('sends the ad-hoc query text with mode live and 500 rows', () => {
    const { meta } = decoded();
    expect(rerunBlocker(meta)).toBeUndefined();
    expect(rerunRequest(meta, 'sc-1')).toEqual({
      project: 'demo',
      environment: 'local',
      securityContextId: 'sc-1',
      source: 'chinook',
      dtql: meta.query.dtql,
      parameters: {},
      bindingOrigins: [],
      mode: 'live',
      limit: 500,
    });
  });

  it('names a saved query by its id, with one manual binding origin per parameter', () => {
    const { meta } = decoded({
      query: {
        kind: 'saved',
        dtql: undefined,
        savedQueryId: 'customer-invoices',
        savedQueryType: 'dtql',
        parameters: { CustomerId: { type: 'integer', value: '2' } },
      },
    });
    const request = rerunRequest(meta, 'sc-1');
    expect(request).toMatchObject({
      queryId: 'customer-invoices',
      parameters: { CustomerId: { type: 'integer', value: '2' } },
      bindingOrigins: [{ parameterId: 'CustomerId', origin: 'manual' }],
    });
    expect(request).not.toHaveProperty('dtql');
  });

  it('is blocked, with its reason, where the agent cannot run it', () => {
    const noProject = decoded({ db: { ref: null } }).meta;
    expect(rerunBlocker(noProject)).toContain('not in a DataTug project');
    expect(rerunRequest(noProject, 'sc')).toBeUndefined();
    expect(
      rerunBlocker(
        decoded({ meta: { unavailable: { query: 'too-large' } } }).meta,
      ),
    ).toContain('too large');
    expect(
      rerunBlocker(
        decoded({
          query: {
            parameters: {
              ids: { type: 'set', values: [{ type: 'integer', value: '1' }] },
            },
          },
        }).meta,
      ),
    ).toContain('list parameter');
    const federated = decoded({
      query: { kind: 'saved', savedQueryId: 'q' },
      meta: {
        participants: [
          {
            instance: 'root',
            schema: '',
            relation: 'a',
            alias: '',
            db: 'datatug://p/d?env=e',
            kind: 'table',
            role: 'from',
          },
        ],
      },
    }).meta;
    expect(rerunBlocker(federated)).toContain('several databases');
    expect(rerunBlocker(decoded({ query: { kind: 'saved' } }).meta)).toContain(
      'not kept',
    );
    expect(
      rerunBlocker(decoded({ query: { dtql: undefined } }).meta),
    ).toContain('not kept');
  });

  it('allows a list parameter on a saved query', () => {
    const { meta } = decoded({
      query: {
        kind: 'saved',
        savedQueryId: 'q',
        parameters: { ids: { type: 'set', values: [] } },
      },
    });
    expect(rerunBlocker(meta)).toBeUndefined();
  });
});

describe('classifyResultError', () => {
  const answer = (status: number, message: string) =>
    new HttpErrorResponse({
      status,
      error: { error: { code: 'X', message, field: 'id' } },
    });

  it('names each refusal of the agent by its reason code', () => {
    expect(classifyResultError(answer(404, 'result-not-found'))).toBe(
      'result-not-found',
    );
    expect(classifyResultError(answer(400, 'bad-result-id'))).toBe(
      'result-not-found',
    );
    expect(classifyResultError(answer(404, 'result-incomplete'))).toBe(
      'result-incomplete',
    );
    expect(classifyResultError(answer(403, 'result-refused'))).toBe(
      'result-refused',
    );
    expect(classifyResultError(answer(400, 'result-version-unsupported'))).toBe(
      'version-unsupported',
    );
    expect(classifyResultError(new ResultVersionError())).toBe(
      'version-unsupported',
    );
  });

  it('classifies anything else as every agent read', () => {
    expect(classifyResultError(new HttpErrorResponse({ status: 0 }))).toBe(
      'agent-unreachable',
    );
    expect(classifyResultError(new HttpErrorResponse({ status: 401 }))).toBe(
      'link-expired',
    );
    expect(classifyResultError(answer(403, 'ACCESS_DENIED'))).toBe(
      'agent-unreachable',
    );
    expect(classifyResultError(answer(503, 'results-store-unavailable'))).toBe(
      'read-failed',
    );
    expect(
      classifyResultError(
        new HttpErrorResponse({
          status: 404,
          error: { error: { field: 'key' } },
        }),
      ),
    ).toBe('read-failed');
    expect(classifyResultError(new Error('x'))).toBe('read-failed');
  });
});
