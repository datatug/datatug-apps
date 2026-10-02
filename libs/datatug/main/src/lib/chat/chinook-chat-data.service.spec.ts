import 'fake-indexeddb/auto';
import { parseDTQL } from '@dalgo/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveChatJoin, discoverChatJoinCandidates } from './chat-joins';
import { CHINOOK_SCHEMA } from './chat.types';
import { CHINOOK_FIXTURE_VERSION, ChinookChatDataService } from './chinook-chat-data.service';

const tables = {
  Artist: [], Album: [], Track: [], Genre: [], MediaType: [], Playlist: [], PlaylistTrack: [], Employee: [], InvoiceLine: [],
  Customer: [
    { CustomerId: 1, FirstName: 'Luís', Country: 'Brazil', Company: 'Embraer' },
    { CustomerId: 2, FirstName: 'Leonie', Country: 'Germany', Company: null },
    { CustomerId: 3, FirstName: 'François', Country: 'Canada', Company: null },
    { CustomerId: 4, FirstName: 'Bjørn', Country: 'Norway', Company: 'Telenor' },
  ],
  Invoice: [
    { InvoiceId: 1, CustomerId: 2, BillingCountry: 'Germany', Total: 1.98 },
    { InvoiceId: 2, CustomerId: 4, BillingCountry: 'Norway', Total: 3.96 },
    { InvoiceId: 3, CustomerId: 1, BillingCountry: 'Brazil', Total: 5.94 },
    { InvoiceId: 4, CustomerId: 3, BillingCountry: 'Canada', Total: 8.91 },
    { InvoiceId: 5, CustomerId: 3, BillingCountry: 'Canada', Total: 0.99 },
  ],
};

const scope = 'store:datatug-demo-project';
const invoiceToCustomer = `from:
  schema: main
  name: Invoice
  alias: i
  joins:
    - from: {schema: main, name: Customer, alias: c}
      on: [{left: {field: CustomerId, source: i}, op: '==', right: {field: CustomerId, source: c}}]
`;

describe('ChinookChatDataService on the DTQL engine bundled with @dalgo/core', () => {
  const service = new ChinookChatDataService();

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: CHINOOK_FIXTURE_VERSION, tables }), { status: 200 })));
    await service.ensureSeed('store', 'datatug-demo-project');
  });
  afterAll(() => vi.unstubAllGlobals());

  const customers = async (where: string): Promise<unknown[]> => {
    const { rows } = await service.query(scope, `${invoiceToCustomer}where: ${where}
columns: [{field: FirstName, source: c}]
orderBy: [{field: FirstName, source: c}]
`);
    return rows.map((row) => row['FirstName']);
  };

  describe('chat queries that worked before keep working', () => {
    it('runs a single-source filter, order and limit as the chat prompt describes them', async () => {
      const { rows } = await service.query(scope, JSON.stringify({
        from: { schema: 'main', name: 'Customer' }, where: { op: '==', left: { field: 'Country' }, right: { value: 'Canada' } }, limit: 10,
      }));
      expect(rows.map((row) => row['CustomerId'])).toEqual([3]);
      const ordered = await service.query(scope, JSON.stringify({
        from: { schema: 'main', name: 'Customer' }, orderBy: [{ field: 'CustomerId', desc: true }], limit: 2,
      }));
      expect(ordered.rows.map((row) => row['CustomerId'])).toEqual([4, 3]);
    });

    it('runs a single-source IN filter', async () => {
      const { rows } = await service.query(scope, JSON.stringify({
        from: { schema: 'main', name: 'Customer' }, where: { op: 'In', left: { field: 'Country' }, right: { values: ['Brazil', 'Norway'] } },
        orderBy: [{ field: 'CustomerId' }], limit: 10,
      }));
      expect(rows.map((row) => row['CustomerId'])).toEqual([1, 4]);
    });

    it('runs a join derived from a foreign key', async () => {
      const invoice = parseDTQL({ from: { schema: 'main', name: 'Invoice' }, limit: 10 }, CHINOOK_SCHEMA);
      const edge = discoverChatJoinCandidates(invoice).find((item) => item.targetTable === 'Customer' && item.direction === 'forward');
      const derived = deriveChatJoin(invoice, edge?.id ?? '', CHINOOK_SCHEMA);
      const { rows } = await service.query(scope, derived.dtql);
      expect(rows).toHaveLength(5);
      expect(rows[0]).toMatchObject({ InvoiceId: 1, 'Customer.FirstName': 'Leonie' });
    });
  });

  describe('null semantics match the Go engine', () => {
    it('never matches a comparison with null, and treats != null as "is not null"', async () => {
      expect(await customers(`{op: '==', left: {field: Company, source: c}, right: {value: null}}`)).toEqual([]);
      expect(await customers(`{op: '!=', left: {field: Company, source: c}, right: {value: null}}`)).toEqual(['Bjørn', 'Luís']);
    });

    it('excludes null from ordering comparisons', async () => {
      expect(await customers(`{op: '<', left: {field: Company, source: c}, right: {value: Zzz}}`)).toEqual(['Bjørn', 'Luís']);
    });

    it('matches an In list only by its non-null members, and a NotIn list holding null matches nothing', async () => {
      expect(await customers(`{op: In, left: {field: Company, source: c}, right: {values: [Embraer, null]}}`)).toEqual(['Luís']);
      expect(await customers(`{op: NotIn, left: {field: Company, source: c}, right: {values: [Embraer, null]}}`)).toEqual([]);
      expect(await customers(`{op: NotIn, left: {field: Company, source: c}, right: {values: [Embraer]}}`)).toEqual(['Bjørn']);
    });

    it('evaluates and/or groups over those semantics', async () => {
      expect(await customers(`{or: [{op: ==, left: {field: Company, source: c}, right: {value: Embraer}}, {op: ==, left: {field: Country, source: c}, right: {value: Canada}}]}`))
        .toEqual(['François', 'François', 'Luís']);
    });
  });

  describe('a join derived from a result filtered on null', () => {
    const customerFilter = (op: string): string => JSON.stringify({
      from: { schema: 'main', name: 'Customer' }, where: { op, left: { field: 'Company' }, right: { value: null } }, orderBy: [{ field: 'CustomerId' }], limit: 10,
    });
    /** Runs the filtered Customer result, then the join the Chat derives from it to Invoice. */
    const joinInvoices = async (op: string): Promise<{ parent: unknown[]; joined: unknown[] }> => {
      const parent = await service.query(scope, customerFilter(op));
      const edge = discoverChatJoinCandidates(parent.query).find((item) => item.targetTable === 'Invoice' && item.direction === 'reverse');
      const derived = deriveChatJoin(parent.query, edge?.id ?? '', CHINOOK_SCHEMA);
      const { rows } = await service.query(scope, derived.dtql);
      return {
        parent: parent.rows.map((row) => row['CustomerId']),
        joined: rows.map((row) => `${row['CustomerId']}:${row['Invoice.InvoiceId']}`).sort(),
      };
    };

    it('keeps the customers without a company when the filter was == null', async () => {
      expect(await joinInvoices('==')).toEqual({ parent: [2, 3], joined: ['2:1', '3:4', '3:5'] });
    });

    it('keeps the customers with a company when the filter was != null', async () => {
      expect(await joinInvoices('!=')).toEqual({ parent: [1, 4], joined: ['1:3', '4:2'] });
    });

    it('returns no rows from a join that keeps the comparison with null, which is why it is rewritten', async () => {
      const rows = (await service.query(scope, `from:
  schema: main
  name: Customer
  alias: Customer
  joins:
    - from: {schema: main, name: Invoice, alias: Invoice}
      on: [{left: {field: CustomerId, source: Customer}, op: '==', right: {field: CustomerId, source: Invoice}}]
where: {op: '==', left: {field: Company, source: Customer}, right: {value: null}}
columns: [{field: CustomerId, source: Customer}]
`)).rows;
      expect(rows).toEqual([]);
    });
  });

  describe('grouped queries', () => {
    const grouped = `${invoiceToCustomer}columns:
  - {field: Country, source: c, as: country}
  - {aggregate: {function: sum, args: [{field: Total, source: i}]}, as: totalSales}
groupBy: [{field: Country, source: c}]
`;

    it('orders by an expression and by a select alias', async () => {
      const byExpression = await service.query(scope, grouped + `orderBy:
  - binary: {op: '*', left: {aggregate: {function: sum, args: [{field: Total, source: i}]}}, right: {value: -1}}
`);
      expect(byExpression.rows.map((row) => row['country'])).toEqual(['Canada', 'Brazil', 'Norway', 'Germany']);
      const byAlias = await service.query(scope, grouped + 'orderBy: [{field: totalSales, desc: true}]\n');
      expect(byAlias.rows.map((row) => row['country'])).toEqual(['Canada', 'Brazil', 'Norway', 'Germany']);
      expect(byAlias.rows[0]['totalSales']).toBeCloseTo(9.9);
    });

    it('filters groups with a HAVING and/or group', async () => {
      const { rows } = await service.query(scope, grouped + `having:
  and:
    - {op: '>', left: {field: totalSales}, right: {value: 3}}
    - or:
      - {op: ==, left: {field: country}, right: {value: Norway}}
      - {op: ==, left: {field: country}, right: {value: Brazil}}
orderBy: [{field: country}]
`);
      expect(rows.map((row) => row['country'])).toEqual(['Brazil', 'Norway']);
    });

    it('rejects a column that is neither aggregated nor grouped when the query is parsed', async () => {
      await expect(service.query(scope, `${invoiceToCustomer}columns:
  - {aggregate: {function: sum, args: [{field: Total, source: i}]}, as: totalSales}
  - {field: Country, source: c}
`)).rejects.toThrow(/join_aggregate at columns\[1\]: c\.Country is neither aggregated nor present in GROUP BY/);
    });
  });
});
