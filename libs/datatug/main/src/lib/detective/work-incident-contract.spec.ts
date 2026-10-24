import wire from './testdata/backend-resolve.http.go.json';
import {
  validateHostedCriterionView,
  validateHostedCriterionEvent,
} from './hosted-criterion-contract';
import { isIncidentResolution } from '../incidents/resolution-proof';
import { decodeIncidentEvent } from '../incidents/incident-client.service';
import {
  HostedIncidentResponse,
  HostedIncidentView,
} from './hosted-linkage.models';
import { IncidentEvent } from '../incidents/models';
const context = {
  kind: 'cloud' as const,
  storage: 'firestore' as const,
  spaceID: wire.request.spaceID,
  project: wire.request.project,
  principal: wire.request.recovery.receiptActorId,
};
const ref = wire.request.incidentRef,
  environment = wire.request.environment;
function current(): HostedIncidentView {
  const view = structuredClone(wire.success.incident) as HostedIncidentView;
  const resolution = view.resolution;
  if (!resolution)
    throw new Error('Actual Go fixture must contain a resolution');
  return {
    ...view,
    workItemId: 'work_canonical',
    resolutionEpoch: 1,
    reopenedAt: new Date(
      Date.parse(resolution.proof.evaluatedAt) - 1000,
    ).toISOString(),
    resolution: {
      ...resolution,
      lifecycleVersion: 1,
      proof: { ...resolution.proof, resolutionEpoch: 1 },
    },
  };
}
describe('canonical Work native Incident wire extensions', () => {
  it.each(['resolved', 'watching', 'closed'])(
    'admits current epoch proof retained in %s while preserving legacy wire',
    (status) => {
      const view = { ...current(), status };
      expect(() =>
        validateHostedCriterionView(view, ref, context, environment),
      ).not.toThrow();
      expect(() =>
        validateHostedCriterionView(
          wire.success.incident as HostedIncidentResponse['incident'],
          ref,
          context,
          environment,
        ),
      ).not.toThrow();
    },
  );
  it.each([
    'id',
    'negative epoch',
    'fractional epoch',
    'unsafe epoch',
    'null epoch',
    'missing time',
    'non UTC time',
    'stale proof',
    'wrong proof epoch',
    'active proof',
    'unknown key',
  ])('rejects malformed %s', (kind) => {
    const view = current() as unknown as Record<string, unknown>;
    if (kind === 'id') view['workItemId'] = '../other';
    if (kind === 'fractional epoch') view['resolutionEpoch'] = 1.5;
    if (kind === 'negative epoch') view['resolutionEpoch'] = -1;
    if (kind === 'unsafe epoch')
      view['resolutionEpoch'] = Number.MAX_SAFE_INTEGER + 1;
    if (kind === 'null epoch') view['resolutionEpoch'] = null;
    if (kind === 'missing time') delete view['reopenedAt'];
    if (kind === 'non UTC time')
      view['reopenedAt'] = '2026-10-01T00:00:00+01:00';
    const resolution = current().resolution;
    if (!resolution) throw new Error('Missing proof');
    if (kind === 'stale proof')
      view['reopenedAt'] = resolution.proof.evaluatedAt;
    if (kind === 'wrong proof epoch') view['resolutionEpoch'] = 2;
    if (kind === 'active proof') view['status'] = 'investigating';
    if (kind === 'unknown key') view['resolutionEventId'] = 'private-event';
    expect(() =>
      validateHostedCriterionView(
        view as unknown as HostedIncidentView,
        ref,
        context,
        environment,
      ),
    ).toThrow();
  });
  it('keeps optional resolution lifecycle/proof epoch keys closed and typed', () => {
    const resolution = current().resolution;
    expect(isIncidentResolution(resolution)).toBe(true);
    expect(isIncidentResolution({ ...resolution, lifecycleVersion: 2 })).toBe(
      false,
    );
    expect(isIncidentResolution({ ...resolution, unexpected: true })).toBe(
      false,
    );
    expect(
      isIncidentResolution({
        ...resolution,
        proof: { ...resolution?.proof, resolutionEpoch: '1' },
      }),
    ).toBe(false);
  });
  it('decodes explicit reopening and version-one ordinary status events without accepting unknown payload fields', () => {
    const reopened = {
      ...structuredClone(wire.success.event),
      type: 'incident.reopened',
      refs: [],
      payload: {
        reason: 'Fresh evidence requires investigation',
        expectedResolutionEpoch: 0,
      },
    };
    expect(() => decodeIncidentEvent(reopened)).not.toThrow();
    expect(() =>
      validateHostedCriterionEvent(
        reopened as IncidentEvent,
        ref,
        context,
        environment,
      ),
    ).not.toThrow();
    expect(() =>
      decodeIncidentEvent({
        ...reopened,
        payload: { ...reopened.payload, expectedResolutionEpoch: -1 },
      }),
    ).toThrow();
    expect(() =>
      decodeIncidentEvent({
        ...reopened,
        payload: { ...reopened.payload, unexpected: true },
      }),
    ).toThrow();
    const status = {
      ...reopened,
      type: 'incident.status',
      payload: { status: 'investigating', lifecycleVersion: 1 },
    };
    expect(() => decodeIncidentEvent(status)).not.toThrow();
    expect(() =>
      decodeIncidentEvent({
        ...status,
        payload: { ...status.payload, lifecycleVersion: 2 },
      }),
    ).toThrow();
  });
});
