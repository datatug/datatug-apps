import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { immutableUrl, sha256 } from './canonical-metadata';
import {
  createBoundedFederationFetch,
  type BoundedFederation,
} from './bounded-federation';
import { nativeFixture } from './native-fixture.spec-helper';
import { PublicDataService } from './public-data.service';
import { runFederatedQuery } from '../federated-query-executor';

const base = 'https://demodb.dev/ovdb';
async function setup(
  rows: unknown = [
    { affiliation_id: 'a', ror_id: 'https://ror.org/03yrm5c26' },
    { affiliation_id: 'b', ror_id: 'https://ror.org/03yrm5c26' },
    { affiliation_id: 'c', ror_id: 'https://ror.org/100000096' },
    { affiliation_id: 'd', ror_id: 'https://ror.org/000000098' },
  ],
) {
  const text = JSON.stringify(rows);
  const bounds: BoundedFederation = {
    driver: {
      kind: 'https-json',
      database: 'declared_user',
      name: 'affiliations',
      data: {
        repository: 'https://github.com/datatug/datatug-apps',
        revision: 'e7362033ec79c6663d7dbe0483b62fab01f7b9cd',
        path: 'source/affiliations.json',
        sha256: await sha256(text),
      },
      key: 'affiliation_id',
      fields: [
        {
          name: 'affiliation_id',
          property: 'affiliation_id',
          datatype: 'string',
          nullable: false,
        },
        {
          name: 'ror_id',
          property: 'ror_id',
          datatype: 'string',
          nullable: true,
          namespace: 'ROR:URL',
        },
      ],
    },
    userRows: 1000,
    userOffset: 0,
    identifierKind: 'ror',
    nativeNamespace: 'ROR:URL',
    identifierLimit: 50,
    resultRows: 5000,
    bytes: 5 * 1024 * 1024,
    timeoutMs: 10000,
    sources: [
      { database: 'declared_user', name: 'affiliations', keyField: 'ror_id' },
      {
        database: 'ror',
        name: 'Organization',
        keyField: 'id',
        parent: {
          database: 'declared_user',
          name: 'affiliations',
          field: 'ror_id',
        },
      },
    ],
  };
  const calls: { url: string; init?: RequestInit }[] = [];
  const http: typeof fetch = vi.fn(async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).startsWith('https://raw.githubusercontent.com/'))
      return new Response(text);
    return new Response(
      JSON.stringify({
        records: [{ key: 'ror', data: { id: 'https://ror.org/03yrm5c26' } }].filter(row => JSON.parse(String(init?.body)).where.right.values.includes(row.data.id)),
      }),
    );
  });
  const transport = () =>
    createBoundedFederationFetch(
      base,
      bounds,
      http,
      new AbortController().signal,
    );
  const request = (
    transport: ReturnType<typeof createBoundedFederationFetch>,
    database = 'ror',
    name = 'Organization',
  ) =>
    transport.fetch(`${base}/v1/databases/${database}/dtql`, {
      method: 'POST',
      body: JSON.stringify({ from: { name } }),
      headers: { Authorization: 'never-forward-source-secret' },
    });
  return {
    bounds,
    text,
    http,
    calls,
    transport,
    request,
    dataUrl: immutableUrl(
      bounds.driver?.data ??
        (() => {
          throw new Error('Missing driver.');
        })(),
    ),
  };
}
describe('bounded declared source with real OVDB target transport', () => {
  it('does not read before run, verifies full bytes before page selection, preserves raw repeated affiliations, and never queries invalid IDs', async () => {
    const state = await setup(),
      transport = state.transport();
    expect(state.http).not.toHaveBeenCalled();
    await state.request(transport);
    expect(state.calls.map((call) => call.url)).toEqual([
      state.dataUrl,
      `${base}/v1/databases/ror/dtql`,
    ]);
    expect(state.calls[0].init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
    });
    expect(state.calls[0].init?.headers).toBeUndefined();
    const target = JSON.parse(String(state.calls[1].init?.body));
    expect(target.where.right.values).toEqual([
      'https://ror.org/03yrm5c26',
      'https://ror.org/000000098',
    ]);
    expect(
      transport.receipt.sources
        .get('declared_user.affiliations')
        ?.map((row) => row.data['ror_id']),
    ).toEqual([
      'https://ror.org/03yrm5c26',
      'https://ror.org/03yrm5c26',
      'https://ror.org/100000096',
      'https://ror.org/000000098',
    ]);
  });
  it.each(
    [
      [],
      [{ affiliation_id: 'a', ror_id: null }],
      [{ affiliation_id: 'a', ror_id: '' }],
      [{ affiliation_id: 'a', ror_id: 'https://ror.org/100000096' }],
    ].map((rows) => [rows]),
  )(
    'performs no public target request for an empty/null/empty-string/invalid-only driver page',
    async (rows) => {
      const state = await setup(rows);
      await state.request(state.transport());
      expect(state.calls).toHaveLength(1);
    },
  );
  it.each(
    [
      [
        { affiliation_id: 'a', ror_id: null },
        { affiliation_id: 'a', ror_id: null },
      ],
      [{ affiliation_id: 'a', ror_id: 42 }],
      { affiliation_id: 'a' },
      Array.from({ length: 1001 }, (_, i) => ({
        affiliation_id: String(i),
        ror_id: null,
      })),
    ].map((rows) => [rows]),
  )(
    'rejects malformed grain/type/array/whole-file row limits before a target request',
    async (rows) => {
      const state = await setup(rows);
      await expect(state.request(state.transport())).rejects.toThrow();
      expect(state.calls).toHaveLength(1);
    },
  );
  it('refuses wrong bytes, redirected responses, aggregate byte overflow, and unknown target relations', async () => {
    const state = await setup();
    Object.assign(state.bounds.driver?.data ?? {}, { sha256: '0'.repeat(64) });
    await expect(state.request(state.transport())).rejects.toThrow(/checksum/);
    expect(state.calls).toHaveLength(1);
    const other = await setup();
    Object.assign(other.bounds, { bytes: 1 });
    await expect(other.request(other.transport())).rejects.toThrow(
      /byte bound/,
    );
    const unknown = await setup();
    await expect(
      unknown.request(unknown.transport(), 'other', 'Organization'),
    ).rejects.toThrow();
    expect(unknown.http).not.toHaveBeenCalled();
    const redirected = await setup();
    const response = new Response(redirected.text);
    Object.defineProperty(response, 'redirected', { value: true });
    vi.mocked(redirected.http).mockResolvedValue(response);
    await expect(redirected.request(redirected.transport())).rejects.toThrow(
      /redirect/,
    );
  });
  it('applies an explicit source page only after full-file verification and refuses an identifier overflow before target access', async () => {
    const state = await setup();
    Object.assign(state.bounds, { userRows: 1, userOffset: 3 });
    const transport = state.transport();
    await state.request(transport);
    expect(
      transport.receipt.sources
        .get('declared_user.affiliations')
        ?.map((row) => row.key),
    ).toEqual(['d']);
    const over = await setup();
    Object.assign(over.bounds, { identifierLimit: 1 });
    await expect(over.request(over.transport())).rejects.toThrow(
      /identifier bound/,
    );
    expect(over.calls).toHaveLength(1);
  });
  it('cancels a streaming source before hashing or any target access', async () => {
    const state = await setup(),
      controller = new AbortController();
    let cancelled = false;
    vi.mocked(state.http).mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
    const transport = createBoundedFederationFetch(
      base,
      state.bounds,
      state.http,
      controller.signal,
    );
    const pending = state.request(transport);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new Error('cancelled by user'));
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(cancelled).toBe(true);
    expect(state.http).toHaveBeenCalledTimes(1);
  });
  it('runs the accepted immutable affiliation bytes through existing DALgo while its saved production plan remains closed', async () => {
    const fixture = await nativeFixture('ror');
    vi.stubGlobal('fetch', fixture.http);
    try {
      const metadata = new PublicDataService(),
        pins = await fixture.publish();
      const discovery = await metadata.discoverDeclared(
        fixture.context,
        new AbortController().signal,
        pins,
      );
      const definition = metadata.scenario(
        fixture.contract.source,
        discovery,
        discovery.suggestions[0],
        { userRows: 1000, userOffset: 0 },
        discovery.declaredSources?.[0],
      );
      fixture.http.mockClear();
      await expect(
        runFederatedQuery(definition, () => undefined),
      ).rejects.toThrow();
      expect(fixture.http).not.toHaveBeenCalled();
      // Transport mechanics are tested independently of closed product admission.
      const data = fixture.files.get(immutableUrl(fixture.data));
      const http = vi.fn(async (input) =>
        String(input) === immutableUrl(fixture.data)
          ? new Response(data)
          : new Response(
              JSON.stringify({
                records: [
                  {
                    key: 'ror',
                    data: {
                      id: 'https://ror.org/000025p04',
                      status: 'active',
                      locations: [{ geonames_id: 1 }, { geonames_id: 2 }],
                    },
                  },
                ],
              }),
            ),
      );
      const result = await runFederatedQuery(
        { ...definition, publicData: undefined },
        () => undefined,
        '',
        undefined,
        new AbortController().signal,
        'full',
        undefined,
        undefined,
        { fetch: http },
      );
      expect(result.recordset.rows).toHaveLength(8);
      expect(result.publicDataExceptions).toMatchObject({
        matched: 2,
        unmatched: 1,
        null: 1,
        empty: 1,
        invalid: 3,
        multiplied: 0,
      });
      expect(http).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
