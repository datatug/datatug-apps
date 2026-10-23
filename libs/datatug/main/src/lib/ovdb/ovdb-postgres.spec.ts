// The native PostgreSQL mount of cloud.openvaultdb.com: opaque collection ids named by `source`, reads by TugQL,
// nothing writable (descriptor `query: false`, `read: false`, `write: false`).
import { OpenVaultDbHttpError } from '@dalgo/ovdb/client';
import { describe, expect, it } from 'vitest';
import {
  ALBUM_ID,
  ARTIST_ID,
  fakeCloudFetch,
  postgresDescriptor,
} from '../demo-postgresql/demo-postgresql.spec-helper';
import {
  fetchOvdbDescriptor,
  ovdbCollections,
  ovdbCollectionSchema,
  ovdbCollectionTarget,
  ovdbRecordActions,
  ovdbUiCapabilities,
  type OvdbConnection,
} from './ovdb-connection';
import { ovdbFormFields } from './ovdb-record-form';
import {
  describeOvdbError,
  listOvdbRows,
  ovdbTugqlDocument,
  ovdbReadsWithTugql,
} from './ovdb-records';

function connectionOver(fetch: typeof globalThis.fetch): OvdbConnection {
  return {
    id: 'chinook-postgresql',
    title: 'Chinook',
    baseUrl: 'https://cloud.openvaultdb.com',
    databaseId: 'chinook-postgresql',
    fetch,
    descriptor: postgresDescriptor,
  };
}

describe('descriptor of a native PostgreSQL mount', () => {
  it('names tables by their source, not by the opaque collection id', () => {
    expect(ovdbCollections(postgresDescriptor)).toEqual(['Album', 'Artist']);
    expect(ovdbCollectionSchema(postgresDescriptor, 'Artist')).toBe(
      postgresDescriptor.schemas?.collections?.[ARTIST_ID],
    );
    expect(ovdbCollectionSchema(postgresDescriptor, ARTIST_ID)).toBe(
      postgresDescriptor.schemas?.collections?.[ARTIST_ID],
    );
    expect(ovdbCollectionSchema(postgresDescriptor, 'Nope')).toBeUndefined();
    expect(
      ovdbCollectionSchema(
        { ...postgresDescriptor, schemas: undefined },
        'Artist',
      ),
    ).toBeUndefined();
    expect(ovdbCollectionTarget(postgresDescriptor, 'Album')).toEqual({
      id: ALBUM_ID,
      source: { schema: 'chinook', name: 'Album' },
    });
    expect(ovdbCollectionTarget(postgresDescriptor, 'Nope')).toEqual({
      id: 'Nope',
      source: undefined,
    });
    expect(ovdbCollectionTarget(undefined, 'Nope')).toEqual({
      id: 'Nope',
      source: undefined,
    });
  });

  it('can be browsed but offers no edit, delete or reset', () => {
    expect(ovdbUiCapabilities(postgresDescriptor)).toEqual({
      browse: true,
      edit: false,
      delete: false,
      reset: false,
      persistent: true,
    });
    expect(ovdbRecordActions(postgresDescriptor, 'Artist')).toEqual({
      edit: false,
      delete: false,
    });
  });

  it('shows the native column types and keys', () => {
    const fields = ovdbFormFields(
      ovdbCollectionSchema(postgresDescriptor, 'Artist'),
      { ArtistId: 1, Name: 'AC/DC' },
    );
    expect(
      fields.map((f) => [f.name, f.declaredType, f.key, f.nullable]),
    ).toEqual([
      ['ArtistId', 'bigint', true, false],
      ['Name', 'text', false, true],
    ]);
    const album = ovdbFormFields(
      ovdbCollectionSchema(postgresDescriptor, 'Album'),
      {},
    );
    expect(album.find((f) => f.name === 'Title')?.nullable).toBe(false);
  });
});

describe('reading rows of a native PostgreSQL mount', () => {
  it('reads with TugQL (never /query) and gives rows keys of their own', async () => {
    expect(ovdbReadsWithTugql(postgresDescriptor)).toBe(true);
    expect(
      ovdbReadsWithTugql({
        ...postgresDescriptor,
        capabilities: { query: true, tugql: true },
      }),
    ).toBe(false);
    expect(ovdbReadsWithTugql({ ...postgresDescriptor, capabilities: {} })).toBe(
      false,
    );
    expect(ovdbReadsWithTugql(undefined)).toBe(false);
    const { fetch, requests } = fakeCloudFetch();
    const rows = await listOvdbRows(connectionOver(fetch), 'Artist');
    expect(rows).toEqual([
      { key: '#0', data: { ArtistId: 1, Name: 'AC/DC' } },
      { key: '#1', data: { ArtistId: 2, Name: 'Accept' } },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe(
      'https://cloud.openvaultdb.com/v1/databases/chinook-postgresql/tugql',
    );
    expect(JSON.parse(requests[0].body ?? '')).toEqual({
      query: 'from:\n  schema: "chinook"\n  name: "Artist"\nlimit: 100\n',
    });
  });

  it('keeps a key the server sends and tolerates a record without data', async () => {
    const fetch = (async () =>
      new Response(
        JSON.stringify({ records: [{ key: 'Artist/1', data: { a: 1 } }, {}] }),
        { status: 200 },
      )) as typeof globalThis.fetch;
    expect(await listOvdbRows(connectionOver(fetch), 'Artist', 2)).toEqual([
      { key: 'Artist/1', data: { a: 1 } },
      { key: '#1', data: {} },
    ]);
  });

  it('quotes every name, so a name cannot change the document', () => {
    expect(
      ovdbTugqlDocument(
        { id: 'x', source: { schema: 'adventureworks', name: 'Sales.Store' } },
        5,
      ),
    ).toBe(
      'from:\n  schema: "adventureworks"\n  name: "Sales.Store"\nlimit: 5\n',
    );
    expect(
      ovdbTugqlDocument({ id: 'x', source: { name: 'a"\nlimit: 9' } }, 5),
    ).toBe('from:\n  name: "a\\"\\nlimit: 9"\nlimit: 5\n');
    expect(ovdbTugqlDocument({ id: 'plain' }, 1)).toBe(
      'from:\n  name: "plain"\nlimit: 1\n',
    );
  });

  it('fails with the server error code when the read is refused or the answer is not rows', async () => {
    const refused = (async () =>
      new Response(
        JSON.stringify({
          error: { code: 'database_unavailable', message: 'mounting' },
        }),
        { status: 503 },
      )) as typeof globalThis.fetch;
    await expect(
      listOvdbRows(connectionOver(refused), 'Artist'),
    ).rejects.toMatchObject({ status: 503, code: 'database_unavailable' });
    const notJson = (async () =>
      new Response('<html>', { status: 500 })) as typeof globalThis.fetch;
    await expect(
      listOvdbRows(connectionOver(notJson), 'Artist'),
    ).rejects.toMatchObject({
      status: 500,
      code: 'unknown',
      message: expect.stringContaining('read failed'),
    });
    const noRecords = (async () =>
      new Response('{}', { status: 200 })) as typeof globalThis.fetch;
    await expect(
      listOvdbRows(connectionOver(noRecords), 'Artist'),
    ).rejects.toThrow('without records');
  });

  it('reads the descriptor and reports a failure as an OVDB error', async () => {
    const { fetch } = fakeCloudFetch();
    expect(
      await fetchOvdbDescriptor(
        fetch,
        'https://cloud.openvaultdb.com',
        'chinook-postgresql',
      ),
    ).toEqual(postgresDescriptor);
    const down = fakeCloudFetch({ statuses: [503] });
    const failure = await fetchOvdbDescriptor(
      down.fetch,
      'https://cloud.openvaultdb.com',
      'chinook-postgresql',
    ).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(OpenVaultDbHttpError);
    expect(describeOvdbError(failure, 'load')).toMatch(/waking up/);
  });
});

describe('describing hosted-database failures', () => {
  const failure = (status: number, code: string) =>
    new OpenVaultDbHttpError(status, code, 'x');

  it('says a database that is still mounting will be back shortly', () => {
    expect(
      describeOvdbError(failure(503, 'database_unavailable'), 'load'),
    ).toMatch(/waking up or temporarily unavailable/);
    expect(describeOvdbError(failure(503, 'unknown'), 'load')).toMatch(
      /waking up or temporarily unavailable/,
    );
  });

  it('says what a read-only hosted database cannot do', () => {
    expect(
      describeOvdbError(failure(501, 'operation_unsupported'), 'load'),
    ).toMatch(/does not support this operation: it is read-only/);
    expect(
      describeOvdbError(failure(501, 'query_unsupported'), 'load'),
    ).toMatch(/read-only/);
    expect(describeOvdbError(failure(501, 'unknown'), 'load')).toBe(
      'The hosted database does not support this operation.',
    );
    expect(describeOvdbError(failure(403, 'read_only'), 'save')).toBe(
      'This database is read-only: changes are not allowed.',
    );
  });
});
