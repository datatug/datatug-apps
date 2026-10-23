import { webcrypto } from 'node:crypto';
import {
  decodeMappingJournal,
  encodeMappingJournal,
  decodeRows,
  decodeResolution,
  validateMapping,
  NativeMapping,
} from './native-semantic-contract';
const scope = JSON.stringify([
  'sarah',
  'firestore',
  'space',
  'training',
  'demo',
  'shipping-working-copy',
]);
export const mappingFixture = (): NativeMapping => ({
  spaceID: 'space',
  projectId: 'training',
  environment: 'demo',
  sourceId: 'shipping-working-copy',
  evidence: {
    retention: 'project-pinned',
    incidentRef: 'detective-incidents/incident-order',
    context: {
      sessionId: 'session-order',
      expectedSessionVersion: 3,
      expectedContextSetId: 'applied-order',
      scope: { environmentId: 'demo', identityDomain: 'shipping-domain' },
      bindings: [
        { inputName: 'order_id', entryId: 'order', revisionId: 'order-r1' },
      ],
    },
  },
  selection: {
    schemaToken: 'a'.repeat(64),
    collection: 'current_routes',
    rowToken: 'b'.repeat(64),
    column: 'request_id',
  },
  operationId: 'operation-original',
  entityId: 'ShippingRequest',
  fieldId: 'id',
  ifMatch: 'entity1-' + 'c'.repeat(64),
});
describe('Native mapping frozen journal boundaries', () => {
  beforeEach(() => vi.stubGlobal('crypto', webcrypto));
  afterEach(() => vi.unstubAllGlobals());
  it('restores the exact request across reload without rebasing its original tokens', async () => {
    const request = mappingFixture(),
      raw = await encodeMappingJournal(scope, request);
    expect(await decodeMappingJournal(raw, scope)).toEqual(request);
    await expect(
      decodeMappingJournal(raw, scope.replace('sarah', 'maya')),
    ).rejects.toThrow();
  });
  it.each(['operation-/bad', 'x'.repeat(129), ''])(
    'refuses unsafe operation identity %s',
    (id) => {
      expect(() =>
        validateMapping({ ...mappingFixture(), operationId: id }),
      ).toThrow();
    },
  );
  it('refuses corrupt, changed, foreign and noncanonical intents without sanitizing them', async () => {
    await expect(decodeMappingJournal('{', scope)).rejects.toThrow();
    const raw = JSON.parse(await encodeMappingJournal(scope, mappingFixture()));
    raw.request.selection.rowToken = 'd'.repeat(64);
    await expect(
      decodeMappingJournal(JSON.stringify(raw), scope),
    ).rejects.toThrow();
    const changed = { ...mappingFixture(), projectId: 'foreign' };
    await expect(
      decodeMappingJournal(await encodeMappingJournal(scope, changed), scope),
    ).rejects.toThrow();
    for (const extra of [
      { actor: 'sarah' },
      { storage: 'firestore' },
      { project: 'training' },
    ])
      expect(() =>
        validateMapping({ ...mappingFixture(), ...extra }),
      ).toThrow();
    const absent = mappingFixture();
    (absent.evidence.context as { bindings: unknown }).bindings = null;
    expect(() => validateMapping(absent)).toThrow();
  });
  it('keeps NULL distinct from empty string and refuses malformed row widths/identities', () => {
    const row = {
      schemaToken: 'a'.repeat(64),
      collection: 'requests',
      columns: [{ name: 'partner_id', type: 'TEXT', nullable: true }],
      rows: [
        { rowToken: 'b'.repeat(64), cells: [{ type: 'null', value: null }] },
      ],
      truncated: false,
    };
    expect(decodeRows(row).rows[0].cells[0]).toEqual({
      type: 'null',
      value: null,
    });
    expect(() =>
      decodeRows({ ...row, rows: [{ ...row.rows[0], cells: [] }] }),
    ).toThrow();
    expect(() =>
      decodeRows({ ...row, rows: [{ ...row.rows[0], rowToken: 'invented' }] }),
    ).toThrow();
    expect(() =>
      decodeResolution({
        column: 'request_id',
        value: { type: 'string', value: 'actual' },
        entity: 'ShippingRequest',
      }),
    ).toThrow();
  });
});
