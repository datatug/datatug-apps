import {
  heldEvidenceIdentity,
  readRetainedQueryResponse,
} from './retained-evidence-contract';
const revisionFixture = () => ({
  generation: 'g1',
  revision: 1,
  sha256: 'a'.repeat(64),
  configuration: 17,
  fixtureCommit: 'fixture',
  fixtureSHA256: 'b'.repeat(64),
  schemaSHA256: 'c'.repeat(64),
  businessClock: '2018-05-20T10:00:00Z',
  bytes: 100,
  artifacts: [{ id: 'logs/base.jsonl', sha256: 'd'.repeat(64), bytes: 40 }],
  actorId: 'sarah',
  acceptedAt: '2026-10-21T01:00:00Z',
});
const scope = {
  projectRef: { storeId: 'firestore', spaceID: 'space', projectId: 'training' },
  environment: 'demo',
  actor: 'sarah',
};
const result = {
  recordset: {
    columns: [{ name: 'order_id', type: 'integer' }],
    rows: [[{ type: 'integer', value: '11045' }]],
  },
  limitations: [],
  bindingsApplied: [],
  truncated: false,
  provenance: {
    source: 'shipping-working-copy',
    queryId: 'shipping/request-received',
    mode: 'live',
    observedAt: '2026-10-21T00:00:00Z',
    executionProfile: 'protected',
  },
  execution: {
    storeId: 'firestore',
    projectId: 'training',
    executionId: 'execution',
  },
};
const wire = () => ({
  result,
  queryRevision: 'query-revision',
  resultFingerprint: 'f'.repeat(64),
  receipt: 'operation',
  sourcePin: {
    spaceID: 'space',
    projectId: 'training',
    sourceId: 'shipping-working-copy',
    environment: 'demo',
    bindingRevision: 1,
    revision: revisionFixture(),
  },
  appliedManifestRef: 'manifest',
  attachedIncidentRef: 'incidents/INC-1',
});
describe('Authenticated retained query metadata', () => {
  it('pairs exact Result with authenticated SourcePin without conflating whole-Result and recordset digests', async () => {
    const response = await readRetainedQueryResponse(
      wire(),
      scope,
      'shipping/request-received',
      { incidentRef: 'incidents/INC-1' },
    );
    expect(response.result).toEqual(result);
    expect(heldEvidenceIdentity(response, scope)).toEqual({
      execution: result.execution,
      scope: {
        storeId: 'firestore',
        spaceID: 'space',
        projectId: 'training',
        environment: 'demo',
      },
      source: { id: 'shipping-working-copy', generation: 'g1' },
      complete: true,
      hasMore: false,
    });
  });
  it('accepts ordinary source-pinned execution without silently claiming shared retention', async () => {
    const ordinary = wire();
    Reflect.deleteProperty(ordinary, 'appliedManifestRef');
    Reflect.deleteProperty(ordinary, 'attachedIncidentRef');
    const response = await readRetainedQueryResponse(
      ordinary,
      scope,
      'shipping/request-received',
    );
    expect(response.sourcePin).toBeDefined();
    expect(heldEvidenceIdentity(response, scope)).toBeUndefined();
    await expect(
      readRetainedQueryResponse(ordinary, scope, 'shipping/request-received', {
        incidentRef: 'incidents/INC-1',
      }),
    ).rejects.toThrow(/did not confirm/);
  });
  it.each([
    'scope',
    'generation',
    'revision',
    'execution',
    'incident',
    'unknown',
    'missing-manifest',
  ] as const)(
    'rejects %s substitution before exposing held identity',
    async (change) => {
      const value = structuredClone(wire());
      if (change === 'scope') value.sourcePin.spaceID = 'other';
      else if (change === 'generation')
        value.sourcePin.revision.generation = '';
      else if (change === 'revision')
        value.sourcePin.bindingRevision = Number.MAX_SAFE_INTEGER + 1;
      else if (change === 'execution')
        value.result.execution.projectId = 'other';
      else if (change === 'incident')
        value.attachedIncidentRef = 'incidents/INC-2';
      else if (change === 'unknown') Reflect.set(value, 'inventedGrant', true);
      else Reflect.deleteProperty(value, 'appliedManifestRef');
      await expect(
        readRetainedQueryResponse(value, scope, 'shipping/request-received', {
          incidentRef: 'incidents/INC-1',
        }),
      ).rejects.toThrow();
    },
  );
});
