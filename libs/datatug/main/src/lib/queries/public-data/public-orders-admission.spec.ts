import { describe, expect, it } from 'vitest';
import {
  PublicOrdersAdmissionError,
  fetchOrdersRightsPublication,
  sha256Hex,
  verifyPublishedOrders,
  type PublishedOrdersPin,
} from './public-orders-admission';

const encoder = new TextEncoder();
const sourceId = 'ovdb:https%3A%2F%2Fdemodb.dev%2Fovdb/northwind/Orders';
const serverId = 'https://demodb.dev/ovdb';
const endpoint = 'https://demodb.dev/ovdb/v1/databases/northwind/tugql';
const query = 'from: {name: Orders}\nlimit: 1000\n';
const fields = ['OrderID', 'OrderDate', 'Freight', 'ShipCountry'];
const response = {
  complete: true,
  records: [
    { data: { OrderID: 1, OrderDate: '2016-07-04T00:00:00Z', Freight: 10.5, ShipCountry: 'UK' } },
    { data: { OrderID: 2, OrderDate: '2016-07-05', Freight: 0, ShipCountry: 'USA' } },
  ],
};

async function fixture() {
  const querySha256 = await sha256Hex(encoder.encode(query));
  const canonicalRowsSha256 = await sha256Hex(encoder.encode(JSON.stringify([
    [1, '2016-07-04', '10.5', 'UK'],
    [2, '2016-07-05', '0', 'USA'],
  ])));
  const publication = {
    admission: { endpoint, querySha256, canonicalRowsSha256, rows: 2, complete: true, fields },
    sourceRights: [{
      sourceId,
      source: { serverId, databaseId: 'northwind', recordset: 'Orders' },
      declaration: { spdx: 'MIT', url: 'https://example.test/LICENSE' },
      declarationScope: 'recordset',
      declaredAt: { serverId, databaseId: 'northwind', recordset: 'Orders' },
      evidenceOrigin: 'publisher-verified',
      pins: [{
        role: 'provider', repository: 'https://github.com/demo-db/northwind',
        revision: 'a'.repeat(40), path: 'data-source/source.sqlite',
        sha256: 'b'.repeat(64), bytes: 100,
      }],
      transformations: [],
    }],
    usedSourceIds: [sourceId],
  };
  const bytes = encoder.encode(JSON.stringify(publication));
  const pin: PublishedOrdersPin = {
    publicationUrl: 'https://northwind.demodb.dev/evidence/public-orders/source-rights.json',
    publicationSha256: await sha256Hex(bytes), endpoint, querySha256,
    rows: 2, fields, canonicalRowsSha256, sourceId, serverId,
    databaseId: 'northwind', recordset: 'Orders',
  };
  return { bytes, pin, publication };
}

describe('publisher-verified Orders admission', () => {
  it('admits only the complete pinned result and canonical source', async () => {
    const { bytes, pin } = await fixture();
    const result = await verifyPublishedOrders(endpoint, query, response, bytes, pin);
    expect(result.canonicalRowsSha256).toBe(pin.canonicalRowsSha256);
    expect(result.rows).toHaveLength(2);
    expect(result.sourceRights?.[0].evidenceOrigin).toBe('publisher-verified');
    expect(result.usedSourceIds).toEqual([sourceId]);
  });

  it('rejects a changed query, incomplete page, changed row and invalid source declaration', async () => {
    const { bytes, pin, publication } = await fixture();
    await expect(verifyPublishedOrders(endpoint, `${query}#`, response, bytes, pin))
      .rejects.toThrow(PublicOrdersAdmissionError);
    await expect(verifyPublishedOrders(endpoint, query, { ...response, complete: false }, bytes, pin))
      .rejects.toThrow(/incomplete/);
    await expect(verifyPublishedOrders(endpoint, query, {
      ...response, records: [response.records[0], { data: { ...response.records[1].data, ShipCountry: 'France' } }],
    }, bytes, pin)).rejects.toThrow(/differ/);
    const wrongRights = encoder.encode(JSON.stringify({
      ...publication,
      sourceRights: [{ ...publication.sourceRights[0], source: {
        ...publication.sourceRights[0].source, serverId: 'https://other.example/ovdb',
      } }],
    }));
    await expect(verifyPublishedOrders(endpoint, query, response, wrongRights, pin))
      .rejects.toThrow(/pinned artifact/);
  });

  it('rejects duplicate OrderID and unsupported dates before attaching terms', async () => {
    const { bytes, pin } = await fixture();
    const duplicate = { ...response, records: [response.records[0], { data: { ...response.records[1].data, OrderID: 1 } }] };
    await expect(verifyPublishedOrders(endpoint, query, duplicate, bytes, pin))
      .rejects.toThrow(/duplicate/);
    const invalidDate = { ...response, records: [{ data: { ...response.records[0].data, OrderDate: '2016-02-30' } }, response.records[1]] };
    await expect(verifyPublishedOrders(endpoint, query, invalidDate, bytes, pin))
      .rejects.toThrow(/invalid OrderDate/);
  });

  it('fetches only the pinned publication; the shared TugQL transport owns query execution', async () => {
    const { bytes, pin } = await fixture();
    const calls: { url: string; init: RequestInit }[] = [];
    const transport: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(bytes, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const publication = await fetchOrdersRightsPublication({ fetch: transport, pin });
    const result = await verifyPublishedOrders(endpoint, query, response, publication, pin);
    expect(result.rows).toHaveLength(2);
    expect(calls.map((call) => call.url)).toEqual([pin.publicationUrl]);
    expect(calls.map((call) => call.init.method)).toEqual(['GET']);
    expect(calls.every((call) => call.init.credentials === 'omit' && call.init.redirect === 'error')).toBe(true);
  });
});
