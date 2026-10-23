import { describe, expect, it, vi } from 'vitest';
import {
  sha256,
  type MetadataObject,
} from '../queries/public-data/canonical-metadata';
import { JsonNumberToken } from '../queries/public-data/strict-json';
import {
  listNativeDataModels,
  readNativeDataModel,
} from './native-data-models-reader';
import {
  A,
  B,
  C,
  modelAST,
  nativeFixture,
} from './native-data-models.spec-helper';
const signal = (): AbortSignal => new AbortController().signal;

describe('immutable native logical model reader', () => {
  it('loads an empty/model-only catalog without any semantic or Directory fetch', async () => {
    const f = await nativeFixture();
    expect(
      await listNativeDataModels(await f.publish(), f.http, signal()),
    ).toEqual([]);
    await f.retain({
      alias: 'Inventory',
      original: modelAST('Inventory', {
        Item: { fields: { id: { type: 'uuid' } } },
      }),
    });
    const pin = await f.publish(),
      list = await listNativeDataModels(pin, f.http, signal());
    expect(list).toMatchObject([
      {
        id: 'inventory',
        moduleId: 'github.com/acme/inventory/model',
        moduleVersion: '1.0.0',
        commit: A,
      },
    ]);
    const detail = await readNativeDataModel(
      pin,
      'inventory',
      A,
      f.http,
      signal(),
    );
    expect(detail.records[0]).toMatchObject({
      name: 'Item',
      key: [],
      fields: [{ name: 'id', type: 'uuid' }],
    });
    expect(detail.sourceFiles).toHaveLength(3);
    for (const [url, init] of f.http.mock.calls) {
      expect(String(url)).toContain(`/meaninggraph/registry/${C}/`);
      expect(init).toMatchObject({
        credentials: 'omit',
        redirect: 'error',
        method: 'GET',
      });
    }
  });
  it('resolves historical paths and exact foreign composition, overrides own fields and retains all inherited origins', async () => {
    const f = await nativeFixture();
    const old = await f.retain({
      alias: 'Common',
      selected: false,
      original: modelAST(
        'Common',
        {},
        {
          Identified: {
            fields: { id: { type: 'uuid' }, shared: { type: 'string' } },
          },
          Other: { fields: { shared: { type: 'int' } } },
          Recursive: { fields: { next: { component: 'Recursive' } } },
        },
        { Status: { values: ['old'] } },
      ),
    });
    await f.retain({
      alias: 'Common',
      commit: B,
      original: modelAST(
        'Common',
        {},
        { Identified: { fields: { replacement: { type: 'bool' } } } },
      ),
    });
    const ast = modelAST('Orders', {
      Order: {
        use: ['Common.Identified', 'Common.Other'],
        key: ['id'],
        fields: {
          id: { type: 'string' },
          status: { type: 'string', enum: 'Common.Status', required: true },
          address: { component: 'Common.Recursive' },
          next: { record: 'Order' },
        },
      },
    });
    await f.retain({
      alias: 'Orders',
      original: ast,
      locks: [{ alias: 'Common', revision_id: old }],
      graph: {
        effective_fields: [{ name: 'FORGED', owner: 'Order', type: 'secret' }],
      },
    });
    const pin = await f.publish(),
      detail = await readNativeDataModel(pin, 'orders', A, f.http, signal());
    const fields = detail.records[0].fields;
    expect(fields.filter((f) => f.name === 'id')).toHaveLength(1);
    expect(fields.find((f) => f.name === 'id')?.type).toBe('string');
    expect(fields.filter((f) => f.name === 'shared')).toHaveLength(2);
    expect(
      fields
        .filter((f) => f.name === 'shared')
        .every((f) => f.origin?.includes(`@${A}`)),
    ).toBe(true);
    expect(
      fields.some((f) => f.name === 'FORGED' || f.name === 'replacement'),
    ).toBe(false);
    expect(fields.find((f) => f.name === 'address')?.type).toBe(
      'component Common.Recursive',
    );
    expect(fields.find((f) => f.name === 'status')?.constraints['enum']).toBe(
      'Common.Status',
    );
    const historical = await readNativeDataModel(
      pin,
      'common',
      A,
      f.http,
      signal(),
    );
    expect(historical.components.some((c) => c.name === 'Identified')).toBe(
      true,
    );
    expect(historical.commit).toBe(A);
    await expect(
      readNativeDataModel(pin, 'common', 'e'.repeat(40), f.http, signal()),
    ).rejects.toThrow(/no latest fallback/);
  });
  it('preserves each repeated identical component use with its source occurrence origin', async () => {
    const f = await nativeFixture();
    const ast = modelAST(
      'Repeated',
      {
        Order: {
          use: ['Repeated.Shared', 'Repeated.Shared'],
          fields: {},
        },
      },
      { Shared: { fields: { sharedField: { type: 'string' } } } },
    );
    await f.retain({ alias: 'Repeated', original: ast });
    const detail = await readNativeDataModel(
      await f.publish(),
      'repeated',
      A,
      f.http,
      signal(),
    );
    const fields = detail.records[0].fields;
    const address = 'modelspec://github.com/acme/repeated/Repeated';
    expect(detail.records[0].uses).toEqual([
      'Repeated.Shared',
      'Repeated.Shared',
    ]);
    expect(fields.map((field) => field.name)).toEqual([
      'sharedField',
      'sharedField',
    ]);
    expect(fields.map((field) => field.type)).toEqual(['string', 'string']);
    expect(fields.map((field) => field.origin)).toEqual([
      `${address}@${A} components Shared.sharedField via ${address}@${A} Order.use[0]=Repeated.Shared`,
      `${address}@${A} components Shared.sharedField via ${address}@${A} Order.use[1]=Repeated.Shared`,
    ]);
  });
  it('preserves punctuation, slash, percent and Unicode model names with exact source-derived types and origins', async () => {
    const f = await nativeFixture();
    const recordName = 'Record/100%Δ',
      componentName = 'Component/100%Δ',
      fieldName = 'field/100%Δ',
      ast = modelAST(
        'SourceNames',
        {
          [recordName]: {
            fields: {
              [fieldName]: { component: componentName },
            },
          },
        },
        {
          [componentName]: {
            fields: {
              'plain%/Δ': { type: 'string' },
            },
          },
        },
      );
    await f.retain({ alias: 'SourceNames', original: ast });
    const detail = await readNativeDataModel(
      await f.publish(),
      'sourcenames',
      A,
      f.http,
      signal(),
    );
    const record = detail.records.find((value) => value.name === recordName);
    if (!record) throw new Error(`Expected record ${recordName}`);
    const field = record.fields.find((value) => value.name === fieldName);
    if (!field) throw new Error(`Expected field ${fieldName}`);
    const address = 'modelspec://github.com/acme/sourcenames/SourceNames';
    expect(record.name).toBe(recordName);
    expect(field.type).toBe(`component ${componentName}`);
    expect(field.origin).toBe(
      `${address}@${A} records ${recordName}.${fieldName}; references component ${componentName} => ${address}@${A}`,
    );
    expect(detail.components[0].fields[0]).toMatchObject({
      name: 'plain%/Δ',
      type: 'string',
      origin: `${address}@${A} components ${componentName}.plain%/Δ`,
    });
  });
  it('preserves Go-valid FEFF keys and record references without applying JavaScript trim', async () => {
    const f = await nativeFixture(), name = '\uFEFF';
    await f.retain({alias: 'Names', original: modelAST('Names', {
      [name]: {key: [name], fields: {
        [name]: {type: 'int', required: true}, self: {record: name},
      }},
    })});
    const detail = await readNativeDataModel(await f.publish(), 'names', A, f.http, signal());
    expect(detail.records[0].name).toBe(name);
    expect(detail.records[0].key).toEqual([name]);
    expect(detail.records[0].fields.find(field => field.name === 'self')?.type).toBe(`record ${name}`);
  });
  it('preserves every constraint, keyless records, named/literal enums and integers beyond Number precision', async () => {
    const f = await nativeFixture(),
      big = new JsonNumberToken('9007199254740993');
    const ast = modelAST(
      'Values',
      {
        Keyless: {
          fields: {
            value: {
              type: 'int',
              required: false,
              unique: true,
              min_len: new JsonNumberToken('1'),
              max_len: big,
              pattern: '[0-9]+',
              format: 'identifier',
              enum: [big, new JsonNumberToken('2')],
            },
            status: { type: 'int', enum: 'Code' },
          },
        },
      },
      {},
      { Code: { values: [big] } },
    );
    await f.retain({ alias: 'Values', original: ast });
    const d = await readNativeDataModel(
        await f.publish(),
        'values',
        A,
        f.http,
        signal(),
      ),
      field = d.records[0].fields.find((field) => field.name === 'value');
    expect(field?.required).toBe(false);
    expect(field?.constraints).toMatchObject({
      required: 'false',
      unique: 'true',
      min_len: '1',
      max_len: '9007199254740993',
      pattern: '[0-9]+',
      format: 'identifier',
      enum: '[9007199254740993,2]',
    });
    expect(d.enums).toEqual([{ name: 'Code', values: ['9007199254740993'] }]);
    expect(d.records[0].key).toEqual([]);
  });
  it('normalizes only original legacy vocabulary and rejects a changed native AST even with a valid definition hash', async () => {
    const f = await nativeFixture(),
      current = modelAST('Old', {
        Item: { fields: { next: { record: 'Item' } } },
      });
    const original = {
      modelspec: '1.0-draft',
      module: current['module'],
      entities: { Item: { properties: { next: { entity: 'Item' } } } },
    };
    await f.retain({ alias: 'Old', original, native: current });
    const pin = await f.publish();
    expect(
      (await readNativeDataModel(pin, 'old', A, f.http, signal())).records[0]
        .fields[0].type,
    ).toBe('record Item');
    const bad = await nativeFixture();
    await bad.retain({
      alias: 'Old',
      original,
      native: modelAST('Old', {
        Item: { fields: { invented: { type: 'string' } } },
      }),
    });
    await expect(
      readNativeDataModel(await bad.publish(), 'old', A, bad.http, signal()),
    ).rejects.toThrow(/differs from the archived original/);
  });
  it('refuses bad pins, path traversal, tampered bytes and missing exact closure without fallback', async () => {
    const f = await nativeFixture();
    await f.retain({
      alias: 'Root',
      original: modelAST('Root', {
        Item: { fields: { other: { record: 'Foreign.Target' } } },
      }),
      locks: [{ alias: 'Foreign', revision_id: 'f'.repeat(64) }],
    });
    const pin = await f.publish();
    await expect(
      listNativeDataModels(
        { ...pin, repository: 'https://github.com/acme/evil' },
        f.http,
        signal(),
      ),
    ).rejects.toThrow(/shared registry/);
    await expect(
      listNativeDataModels({ ...pin, revision: 'main' }, f.http, signal()),
    ).rejects.toThrow(/immutable/);
    await expect(
      listNativeDataModels(
        { ...pin, sha256: '0'.repeat(64) },
        f.http,
        signal(),
      ),
    ).rejects.toThrow(/digest mismatch/);
    await expect(
      readNativeDataModel(pin, 'root', A, f.http, signal()),
    ).rejects.toThrow(/Missing exact model dependency/);
    const row = f.rows[0];
    row['path'] = '../escape';
    await expect(
      listNativeDataModels(await f.publish(), f.http, signal()),
    ).rejects.toThrow(/identity\/path/);
  });
  it('refuses source registration/definition/artifact mismatches and canonical repository pin conflicts', async () => {
    for (const which of ['artifact', 'definition', 'registration']) {
      const f = await nativeFixture(),
        id = await f.retain({
          alias: 'Root',
          original: modelAST('Root', { Item: { fields: {} } }),
        });
      const r = f.receipts.get(id) ?? {},
        files = r['files'] as MetadataObject[];
      const path =
        which === 'artifact'
          ? files[0]['artifactPath']
          : which === 'definition'
            ? (r['definition'] as MetadataObject)['path']
            : (r['source_record'] as MetadataObject)['artifactPath'];
      f.put(String(path), 'tampered');
      await expect(
        readNativeDataModel(await f.publish(), 'root', A, f.http, signal()),
      ).rejects.toThrow(/digest mismatch/);
    }
    const f = await nativeFixture();
    await f.retain({ alias: 'Root', original: modelAST('Root') });
    f.publisherPins['https://github.com/ACME/ROOT'] = B;
    await expect(
      listNativeDataModels(await f.publish(), f.http, signal()),
    ).rejects.toThrow(/pin disagreement/);
  });
  it('rejects duplicate JSON names and enforces streaming bytes, redirects and a ten second deadline', async () => {
    const f = await nativeFixture(),
      pin = await f.publish();
    f.put('catalog.json', '{"format":1,"format":2}');
    await expect(
      listNativeDataModels(
        { ...pin, sha256: await sha256('{"format":1,"format":2}') },
        f.http,
        signal(),
      ),
    ).rejects.toThrow(/Duplicate/);
    await expect(
      listNativeDataModels(
        pin,
        async () => new Response('x'.repeat(5 * 1024 * 1024 + 1)),
        signal(),
      ),
    ).rejects.toThrow(/byte bound/);
    const redirect = new Response('{}');
    Object.defineProperty(redirect, 'redirected', { value: true });
    await expect(
      listNativeDataModels(pin, async () => redirect, signal()),
    ).rejects.toThrow(/redirect/);
    vi.useFakeTimers();
    try {
      const stalled = listNativeDataModels(
        pin,
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener(
              'abort',
              () => reject(init.signal?.reason),
              { once: true },
            ),
          ),
        signal(),
      );
      const failed = expect(stalled).rejects.toThrow(/deadline/);
      await vi.advanceTimersByTimeAsync(10_000);
      await failed;
    } finally {
      vi.useRealTimers();
    }
  });
  it('never fetches configured meanings in a mixed catalog', async () => {
    const f = await nativeFixture();
    await f.retain({ alias: 'Root', original: modelAST('Root') });
    const address = 'meaning://github.com/acme/meanings',
      id = await sha256(
        JSON.stringify(['meaninggraph-revision/v1', 'meaning', address, B]),
      );
    f.rows.push({
      kind: 'meaning',
      id,
      address,
      commit: B,
      path: `revisions/$records/${id}.yaml`,
    });
    f.publisherPins['https://github.com/acme/meanings'] = B;
    const pin = await f.publish([
      {
        id: 'meanings',
        address,
        repository: 'https://github.com/acme/meanings',
        commit: B,
        revision_id: id,
        definition: { path: `definitions/${id}.json`, sha256: 'e'.repeat(64) },
      },
    ]);
    expect(await listNativeDataModels(pin, f.http, signal())).toHaveLength(1);
    await readNativeDataModel(pin, 'root', A, f.http, signal());
    expect(f.http.mock.calls.some(([url]) => String(url).includes(id))).toBe(
      false,
    );
  });

  it('bounds the complete closure at 96 files and refuses repeated composition amplification', async () => {
    const f = await nativeFixture(),
      locks: { alias: string; revision_id: string }[] = [];
    for (let i = 0; i < 25; i++) {
      const alias = `D${i}`;
      locks.push({
        alias,
        revision_id: await f.retain({ alias, original: modelAST(alias) }),
      });
    }
    await f.retain({ alias: 'Root', original: modelAST('Root'), locks });
    await expect(
      readNativeDataModel(await f.publish(), 'root', A, f.http, signal()),
    ).rejects.toThrow(/96 immutable files/);
    expect(f.http.mock.calls.length).toBeLessThanOrEqual(96);
    const wide = await nativeFixture(),
      fields: MetadataObject = {},
      records: MetadataObject = {};
    for (let i = 0; i < 150; i++) fields[`field${i}`] = { type: 'string' };
    for (let i = 0; i < 500; i++)
      records[`R${i}`] = { use: ['Shared'], fields: {} };
    await wide.retain({
      alias: 'Wide',
      original: modelAST('Wide', records, { Shared: { fields } }),
    });
    await expect(
      readNativeDataModel(await wide.publish(), 'wide', A, wide.http, signal()),
    ).rejects.toThrow(/bounded projection budget/);
  });
  it('charges catalog and definition bodies against one cumulative five MiB budget', async () => {
    const f = await nativeFixture();
    await f.retain({
      alias: 'Root',
      original: modelAST('Root'),
      graph: { padding: 'x'.repeat(3 * 1024 * 1024) },
    });
    f.models[0]['description'] = 'x'.repeat(3 * 1024 * 1024);
    await expect(
      readNativeDataModel(await f.publish(), 'root', A, f.http, signal()),
    ).rejects.toThrow(/byte bound/);
  });
});
