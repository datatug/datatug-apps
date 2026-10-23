import {
  fromProjectQueryWire,
  toProjectQueryWire,
} from './project-query-contract';
import { projectQueryMetadataForSave } from './project-query-metadata';
import { QueryType } from '../models/definition/query-def';

function diagnosticWire() {
  return {
    folderPath: '~',
    id: 'q',
    title: 'Shipping event diagnostic',
    type: QueryType.SQL,
    text: 'SELECT e.event_id FROM events e JOIN attempts a ON a.attempt_id=e.attempt_id JOIN requests r ON r.request_id=a.request_id WHERE r.order_id=@order_id',
    connectionId: 'shipping-working-copy',
    parameters: [
      {
        id: 'order_id',
        type: 'integer',
        isRequired: true,
        defaultValue: 0,
        minLength: 0,
        maxLength: 20,
        meta: { entity: 'ShippingRequest', field: 'id' },
        lookup: {
          db: 'shipping',
          sql: 'SELECT order_id FROM requests',
          keyFields: ['order_id'],
        },
      },
      {
        id: 'include_archived',
        type: 'boolean',
        defaultValue: false,
        isRequired: false,
        isMultiValue: false,
      },
      {
        id: 'label',
        type: 'string',
        defaultValue: '',
        title: '',
        meta: null,
        lookup: null,
      },
      { id: 'optional', type: 'integer', defaultValue: null },
    ],
    recordsets: [
      {
        columns: [
          {
            name: 'event_id',
            type: 'string',
            required: true,
            meta: { entity: 'ShippingEvent', field: 'id' },
            hideIf: { parameters: ['include_archived'] },
          },
        ],
      },
    ],
  };
}
const encode = (metadata: object) =>
  toProjectQueryWire(
    fromProjectQueryWire({ ...diagnosticWire(), ...metadata }),
  );
describe('ordinary common query metadata', () => {
  it('round-trips every supported parameter/column value without comparison or client recordset name', () => {
    const original = diagnosticWire();
    const definition = fromProjectQueryWire(original);
    expect(definition).not.toHaveProperty('comparison');
    const wire = toProjectQueryWire(definition);
    expect(wire).toEqual(original);
    expect(wire.parameters).not.toBe(definition.parameters);
    expect(wire.recordsets).not.toBe(definition.recordsets);
    expect(toProjectQueryWire(fromProjectQueryWire({ ...wire }))).toEqual(
      original,
    );
  });
  it.each([
    {},
    { parameters: [], recordsets: [] },
    { parameters: null, recordsets: null },
    { recordsets: [{}] },
    { recordsets: [{ type: '', columns: [] }] },
  ])('keeps QueryDef optional metadata semantics %j', (metadata) => {
    expect(projectQueryMetadataForSave(metadata)).toEqual(metadata);
  });
  it('preserves optional project-item, empty hideIf and explicit null values without normalizing them', () => {
    const metadata = {
      parameters: [
        {
          id: 'p',
          type: 'number',
          title: null,
          defaultValue: 1e20,
          isRequired: null,
          maxLength: null,
        },
      ],
      recordsets: [
        {
          id: '',
          title: '',
          folder: '',
          type: '',
          tags: [],
          userIds: null,
          access: null,
          columns: [
            {
              name: 'x',
              type: 'number',
              required: false,
              meta: null,
              hideIf: {},
            },
          ],
        },
      ],
    };
    expect(encode(metadata)).toMatchObject(metadata);
  });
  it.each([
    { parameters: [{ id: 'p', type: 'integer', futurePermission: true }] },
    {
      parameters: [
        {
          id: 'p',
          type: 'string',
          meta: { entity: 'E', field: 'f', spaceID: 'other' },
        },
      ],
    },
    {
      parameters: [
        {
          id: 'p',
          type: 'string',
          lookup: {
            db: 'db',
            sql: 'SELECT id',
            keyFields: ['id'],
            sourceToken: 'invented',
          },
        },
      ],
    },
    { recordsets: [{ name: 'browser-only', columns: [] }] },
    { recordsets: [{ checks: [] }] },
    { recordsets: [{ primaryKey: { fields: ['id'] } }] },
    {
      recordsets: [{ columns: [{ name: 'id', type: 'integer', checks: [] }] }],
    },
    {
      recordsets: [
        {
          columns: [
            {
              name: 'id',
              type: 'integer',
              hideIf: { parameters: ['id'], sql: 'SELECT 1' },
            },
          ],
        },
      ],
    },
    { relationshipBindings: [] },
    { capture: {} },
    { inventedAuthority: true },
  ])(
    'refuses richer unsupported fields without dropping them %j',
    (metadata) => {
      const original = fromProjectQueryWire({
        ...diagnosticWire(),
        ...metadata,
      });
      const before = structuredClone(original);
      expect(() => toProjectQueryWire(original)).toThrow('cannot preserve');
      expect(original).toEqual(before);
    },
  );
  it.each([
    { id: '', type: 'integer' },
    { id: 'p', type: '' },
    { id: 'p', type: 'integer', defaultValue: 1.5 },
    { id: 'p', type: 'integer', defaultValue: Number('9223372036854775807') },
    { id: 'p', type: 'integer', defaultValue: '11045' },
    { id: 'p', type: 'boolean', defaultValue: 0 },
    { id: 'p', type: 'string', defaultValue: false },
    { id: 'p', type: 'number', defaultValue: '1' },
    { id: 'p', type: 'number', defaultValue: Infinity },
    { id: 'p', type: 'number', defaultValue: NaN },
    { id: 'p', type: 'integer', maxLength: 1.5 },
    { id: 'p', type: 'integer', isRequired: 'true' },
    { id: 'p', type: 'integer', lookup: { keyFields: [1] } },
  ])('refuses nonrepresentable or wrong-type metadata %j', (parameter) => {
    expect(() => encode({ parameters: [parameter] })).toThrow(
      'cannot preserve',
    );
  });
  it.each(['', 'Read synthetic shipping records — no execution authority.'])(
    'preserves purpose text %j',
    (purpose) => {
      expect(encode({ purpose }).purpose).toBe(purpose);
    },
  );
  it.each([null, false, {}, []])('refuses malformed purpose %j', (purpose) => {
    expect(() => encode({ purpose })).toThrow('cannot preserve');
  });
  it('preserves exact safe signed integer defaults and finite number magnitudes', () => {
    for (const value of [
      -Number.MAX_SAFE_INTEGER,
      -1,
      0,
      Number.MAX_SAFE_INTEGER,
    ])
      expect(
        encode({
          parameters: [{ id: 'p', type: 'integer', defaultValue: value }],
        }).parameters?.[0].defaultValue,
      ).toBe(value);
    for (const value of [-1e100, 0.125, 1e100])
      expect(
        encode({
          parameters: [{ id: 'p', type: 'number', defaultValue: value }],
        }).parameters?.[0].defaultValue,
      ).toBe(value);
  });
  it('refuses non-JSON defaults and sparse arrays rather than silently coercing them', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    for (const defaultValue of [
      undefined,
      BigInt(1),
      new Date(),
      cycle,
      [undefined],
    ])
      expect(() =>
        projectQueryMetadataForSave({
          parameters: [{ id: 'p', type: 'custom', defaultValue }],
        }),
      ).toThrow();
    const sparse = Object.assign(new Array<unknown>(1), { extra: 'hidden' });
    expect(() =>
      projectQueryMetadataForSave({
        parameters: [{ id: 'p', type: 'custom', defaultValue: sparse }],
      }),
    ).toThrow();
  });
});
