import fixture from './testdata/backend-criterion-v069.json';
import { isIncidentResolutionCriterion } from '../incidents/resolution-criterion';
import { decodeIncidentEvent } from '../incidents/incident-client.service';
import {
  validateHostedCriterionSuccess,
  validateHostedCriterionView,
} from './hosted-criterion-contract';
import {
  isPendingIncidentOperation,
  isHostedCriterionAction,
} from './incident-message-presentation';
import type {
  HostedCriterionAction,
  HostedIncidentResponse,
} from './hosted-linkage.models';
const context = {
  kind: 'cloud' as const,
  storage: 'firestore' as const,
  spaceID: 'space',
  project: fixture.draftRequest.project,
  principal: 'actor',
};
const action = (which: 'draft' | 'finalize'): HostedCriterionAction => {
  const {
    storage: _s,
    spaceID: _i,
    project: _p,
    operationId: _o,
    ...value
  } = which === 'draft' ? fixture.draftRequest : fixture.finalizeRequest;
  return value as HostedCriterionAction;
};
describe('Hosted criterion frozen Core69 transport', () => {
  it('admits real DAL draft and finalized next-version responses without confusing native and membership projects', () => {
    for (const which of ['draft', 'finalize'] as const) {
      const response = fixture[
        which === 'draft' ? 'draftSuccess' : 'finalizeSuccess'
      ] as HostedIncidentResponse;
      expect(
        isIncidentResolutionCriterion(response.incident.resolutionCriterion),
      ).toBe(true);
      expect(() => decodeIncidentEvent(response.event)).not.toThrow();
      expect(() =>
        validateHostedCriterionSuccess(response, action(which), context),
      ).not.toThrow();
    }
    expect(fixture.finalizeSuccess.incident.resolutionCriterion.version).toBe(
      fixture.draftSuccess.incident.resolutionCriterion.version + 1,
    );
    expect(fixture.draftSuccess.incident.projects[0].projectId).not.toBe(
      context.project,
    );
  });
  it.each(['digest', 'timestamp', 'scope', 'input', 'unknown', 'version'])(
    'rejects malformed %s rather than treating it as an empty criterion',
    (kind) => {
      const value = structuredClone(
        fixture.finalizeSuccess.incident.resolutionCriterion,
      ) as unknown as Record<string, unknown>;
      if (kind === 'digest') value['definitionDigest'] = '0'.repeat(63);
      if (kind === 'timestamp')
        value['finalizedAt'] = '2026-10-21T12:00:00+01:00';
      if (kind === 'scope')
        (value['scope'] as Record<string, unknown>)['project'] =
          fixture.draftSuccess.incident.projects[0];
      if (kind === 'input')
        (value['scope'] as Record<string, unknown>)['affectedInputs'] = {
          order_id: { redacted: true },
        };
      if (kind === 'unknown') value['pass'] = true;
      if (kind === 'version') value['version'] = Number.MAX_SAFE_INTEGER + 1;
      const view = {
        ...fixture.finalizeSuccess.incident,
        resolutionCriterion: value,
      };
      expect(() =>
        validateHostedCriterionView(
          view as unknown as HostedIncidentResponse['incident'],
          fixture.draftRequest.incidentRef,
          context,
          'demo',
        ),
      ).toThrow();
    },
  );
  it('rejects replay with a replaced selected Session or wrong actor', () => {
    const response = structuredClone(
      fixture.draftSuccess,
    ) as HostedIncidentResponse;
    const a = action('draft');
    if (a.type === 'criterion-draft')
      a.evidence = {
        ...a.evidence,
        context: {
          ...a.evidence.context,
          sessionId: 'different-session-same-order',
        },
      };
    expect(() =>
      validateHostedCriterionSuccess(response, a, context),
    ).toThrow();
    expect(() =>
      validateHostedCriterionSuccess(response, action('draft'), {
        ...context,
        principal: 'other',
      }),
    ).toThrow();
  });
  it('keeps strict disjoint complete journal intents and legacy body-only messages', () => {
    const a = action('draft'),
      pending = {
        operationId: 'operation-native-1',
        expectedSeq: a.expectedSeq,
        action: a,
      };
    expect(isPendingIncidentOperation(pending)).toBe(true);
    expect(
      isPendingIncidentOperation({ ...pending, message: { body: 'smuggled' } }),
    ).toBe(false);
    expect(isPendingIncidentOperation({ ...pending, expectedSeq: 2 })).toBe(
      false,
    );
    expect(
      isPendingIncidentOperation({
        operationId: 'operation-legacy',
        expectedSeq: 1,
        message: { body: 'exact old text' },
      }),
    ).toBe(true);
    expect(
      isHostedCriterionAction({
        ...action('finalize'),
        evidence: fixture.draftRequest.evidence,
      }),
    ).toBe(false);
    expect(
      isHostedCriterionAction({
        ...a,
        evidence: { ...fixture.draftRequest.evidence, caseId: null },
      }),
    ).toBe(false);
    expect(
      isHostedCriterionAction({
        ...a,
        evidence: {
          ...fixture.draftRequest.evidence,
          incidentRef: 'other/INC-1',
        },
      }),
    ).toBe(false);
  });
});
