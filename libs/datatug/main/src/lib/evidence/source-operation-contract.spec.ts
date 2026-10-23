import { decodeEvidenceArtifactRef } from '@sneat/datatug-semantic';
import { decodeIncidentEvent } from '../incidents/incident-client.service';
import { incidentEvidenceTargets } from '../incidents/incident-evidence-targets';
import fixture from './testdata/source-operation.facade.go.json';
import httpFixture from './testdata/source-operation.http.go.json';
import {
  readSourceOperation,
  readSourceOperationHistory,
} from './source-operation-contract';

// Actual Go facade/registered HTTP fixtures emitted at Backend0eff12bd, rerun under corrected b791 source admission.
// SHA256 d0ed44103959da788b0f9554cf3179a9fa6d61089515f330c6da5c01c9a9b3bf / 16972a2a4a58f719917aa064f57c435cf54e2cd4aad07bf4f079211dcad07b03.
const scope = {
  projectRef: {
    storeId: 'firestore',
    spaceID: fixture.request.spaceID,
    projectId: fixture.request.projectId,
  },
  environment: fixture.request.environment,
  actor: fixture.request.reference.receiptActorId,
};
const arm = () => ({
  kind: 'source-operation',
  sourceOperation: structuredClone(fixture.request.reference),
});
describe('published Core070 source operation and actual Go receipt wire', () => {
  it('accepts actual facade and registered HTTP discovery/open without comparing the current pointer or granting recovery', () => {
    expect(readSourceOperationHistory(fixture.discovery, scope)).toEqual(
      fixture.discovery.operations,
    );
    expect(
      readSourceOperation(fixture.open, scope, fixture.request.reference),
    ).toEqual(fixture.open);
    const httpScope = {
      projectRef: {
        storeId: 'firestore',
        spaceID: httpFixture.request.spaceID,
        projectId: httpFixture.request.projectId,
      },
      environment: httpFixture.request.environment,
      actor: httpFixture.request.reference.receiptActorId,
    };
    expect(
      readSourceOperationHistory(httpFixture.discovery, httpScope),
    ).toEqual(httpFixture.discovery.operations);
    expect(
      readSourceOperation(
        httpFixture.open,
        httpScope,
        httpFixture.request.reference,
      ),
    ).toEqual(httpFixture.open);
    expect(
      readSourceOperationHistory(fixture.discovery, scope).find(
        (v) => v.reference.operationId === 'source-op-noop',
      )?.outcome,
    ).toBe('already-applied');
  });
  it('admits only the disjoint exact Core reference arm with canonical bounded identities and hashes', () => {
    expect(decodeEvidenceArtifactRef(arm())).toEqual(arm());
    const invalid: unknown[] = [];
    for (const field of Object.keys(fixture.request.reference)) {
      const value = arm() as unknown as {
        sourceOperation: Record<string, unknown>;
      };
      delete value.sourceOperation[field];
      invalid.push(value);
    }
    for (const patch of [
      { environment: 'demo' },
      { storeId: '../wrong' },
      { receiptActorId: ' ' },
      { operationId: 'é'.repeat(129) },
      { requestSHA256: 'A'.repeat(64) },
      { result: { generation: 'g', revision: 0, sha256: 'a'.repeat(64) } },
    ]) {
      const value = arm();
      Object.assign(value.sourceOperation, patch);
      invalid.push(value);
    }
    invalid.push(
      { ...arm(), id: 'event' },
      {
        ...arm(),
        execution: {
          storeId: 'firestore',
          projectId: 'project',
          executionId: 'execution',
        },
      },
      { kind: 'event', sourceOperation: fixture.request.reference },
    );
    for (const value of invalid)
      expect(() => decodeEvidenceArtifactRef(value)).toThrow();
  });
  it('refuses forged scope, unknown/disjoint fields, duplicate/oversized history and corrupt receipt crosslinks', () => {
    for (const altered of [
      { ...scope, actor: 'other' },
      { ...scope, environment: '' },
      { ...scope, projectRef: { ...scope.projectRef, projectId: 'other' } },
      { ...scope, projectRef: { ...scope.projectRef, spaceID: 'other' } },
    ])
      expect(() =>
        readSourceOperation(fixture.open, altered, fixture.request.reference),
      ).toThrow();
    const invalid: unknown[] = [];
    for (const field of Object.keys(fixture.open.receipt)) {
      const value = structuredClone(fixture.open) as unknown as {
        receipt: Record<string, unknown>;
      };
      delete value.receipt[field];
      invalid.push(value);
    }
    for (const patch of [
      { actorId: 'other' },
      { operationId: 'other' },
      { requestSHA256: 'a'.repeat(64) },
      { action: 'execute' },
      { outcome: 'pass' },
      { acceptedAt: 'not-time' },
      { acceptedAt: '0001-01-01T00:00:00.000000000Z' },
      { acceptedAt: '2026-10-21T12:00:00+00:00' },
      { trusted: true },
    ]) {
      const value = structuredClone(fixture.open);
      Object.assign(value.receipt, patch);
      invalid.push(value);
    }
    for (const patch of [
      { sha256: 'a'.repeat(64) },
      { generation: 'other' },
      { revision: 2 },
      { actorId: 'other' },
      { acceptedAt: '2026-10-21T11:00:00Z' },
      { bytes: 524289 },
      { artifacts: [] },
      { configuration: '18' },
    ]) {
      const value = structuredClone(fixture.open);
      Object.assign(value.receipt.revision, patch);
      invalid.push(value);
    }
    invalid.push({ ...fixture.open, actor: 'actor' });
    for (const value of invalid)
      expect(() =>
        readSourceOperation(value, scope, fixture.request.reference),
      ).toThrow();
    for (const history of [
      { operations: Array(129).fill(fixture.discovery.operations[0]) },
      {
        operations: [
          fixture.discovery.operations[0],
          fixture.discovery.operations[0],
        ],
      },
      { ...fixture.discovery, total: 5 },
      { operations: null },
    ])
      expect(() => readSourceOperationHistory(history, scope)).toThrow();
    const other = structuredClone(fixture.discovery);
    other.operations[0].reference.receiptActorId = 'other';
    expect(() => readSourceOperationHistory(other, scope)).toThrow();
  });
  it('allows a no-op receipt to point to an earlier different revision producer but never a future revision', () => {
    const value = structuredClone(fixture.open);
    value.receipt.outcome = 'already-applied';
    value.receipt.revision.actorId = 'original-producer';
    value.receipt.revision.acceptedAt = '2026-10-21T11:00:00Z';
    expect(
      readSourceOperation(value, scope, fixture.request.reference).receipt
        .outcome,
    ).toBe('already-applied');
    value.receipt.revision.acceptedAt = '2026-10-21T12:00:00.000000001Z';
    expect(() =>
      readSourceOperation(value, scope, fixture.request.reference),
    ).toThrow();
  });
  it('keeps typed Incident refs available without inventing a URL target', () => {
    const event = {
      id: 'event-1',
      seq: 1,
      at: '2026-10-21T12:00:00Z',
      visibleAt: '2026-10-21T12:00:00Z',
      incident: { storeId: 'store', incidentId: 'INC-1' },
      actor: { kind: 'human', id: 'actor', via: 'web' },
      type: 'note.added',
      assertion: { kind: 'observation' },
      refs: [arm()],
      payload: { body: 'Original operation' },
    };
    expect(decodeIncidentEvent(event).refs).toEqual([arm()]);
    const decoded = decodeIncidentEvent(event);
    expect(
      incidentEvidenceTargets(decoded.refs || [], 'agent')[0].routerLink,
    ).toBeUndefined();
    expect(() =>
      decodeIncidentEvent({ ...event, refs: [{ ...arm(), id: 'event' }] }),
    ).toThrow();
  });
});
