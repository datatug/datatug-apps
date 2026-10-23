import wire from './testdata/backend-resolve.http.go.json';
import {
  isHostedResolveAction,
  validateHostedResolveScope,
  validateHostedResolveSuccess,
} from './hosted-resolve-contract';
import {
  validateHostedCriterionView,
  validateHostedCriterionHistory,
} from './hosted-criterion-contract';
import type { HostedIncidentResponse } from './hosted-linkage.models';
import { decodeIncidentEvent } from '../incidents/incident-client.service';

// Verbatim registered HTTP source fixture at Backend60b9; SHA256 dbe4748a8300ae2dc9d9bdcb065db3884b8a38eddcac49f20dbc459b48ec1753.
const context = {
  kind: 'cloud' as const,
  storage: 'firestore' as const,
  spaceID: wire.request.spaceID,
  project: wire.request.project,
  principal: wire.request.recovery.receiptActorId,
};
function action() {
  const {
    storage: _storage,
    spaceID: _spaceID,
    project: _project,
    operationId: _operationId,
    ...value
  } = wire.request;
  void [_storage, _spaceID, _project, _operationId];
  if (!isHostedResolveAction(value))
    throw new Error('Actual Go Resolve action failed decoding');
  return value;
}
function response() {
  return structuredClone(wire.success) as HostedIncidentResponse;
}
function requireValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required fixture value is unavailable');
  return value;
}

describe('actual human Resolve closed wire and immutable success', () => {
  it('admits actual Go action/current projection/event and exact original success and historical replay', () => {
    validateHostedResolveScope(action(), context);
    for (const result of [wire.success, wire.retry]) {
      validateHostedResolveSuccess(
        result as HostedIncidentResponse,
        action(),
        context,
        wire.request.operationId,
      );
      validateHostedCriterionView(
        result.incident as HostedIncidentResponse['incident'],
        wire.request.incidentRef,
        context,
        wire.request.environment,
      );
      decodeIncidentEvent(result.event);
      validateHostedCriterionHistory(
        {
          events: [result.event],
          nextAfterSeq: result.event.seq,
          hasMore: false,
        },
        wire.request.incidentRef,
        context,
        wire.request.environment,
        wire.request.expectedSeq,
        50,
      );
    }
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      validateHostedResolveSuccess(
        wire.retry as HostedIncidentResponse,
        action(),
        context,
        wire.request.operationId,
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    (v: Record<string, unknown>) => {
      delete v['run'];
    },
    (v: Record<string, unknown>) => {
      v['outcome'] = 'pass';
    },
    (v: Record<string, unknown>) => {
      v['humanNote'] = ' ';
    },
    (v: Record<string, unknown>) => {
      v['humanNote'] = 'é'.repeat(2001);
    },
    (v: Record<string, unknown>) => {
      v['criterionVersion'] = 0;
    },
    (v: Record<string, unknown>) => {
      v['expectedSeq'] = 1.5;
    },
    (v: Record<string, unknown>) => {
      v['run'] = { ...action().run, checkID: action().run.checkId };
    },
    (v: Record<string, unknown>) => {
      v['recovery'] = { ...action().recovery, result: null };
    },
    (v: Record<string, unknown>) => {
      v['type'] = 'append-message';
    },
  ])(
    'rejects missing/mixed/malformed/null/alias client fields %#',
    (mutate) => {
      const value = structuredClone(action()) as unknown as Record<
        string,
        unknown
      >;
      mutate(value);
      expect(isHostedResolveAction(value)).toBe(false);
    },
  );
  it.each([
    [
      'receipt',
      (v: HostedIncidentResponse) => {
        v.receipt = 'different';
      },
    ],
    [
      'note',
      (v: HostedIncidentResponse) => {
        v.incident.resolution = {
          ...requireValue(v.incident.resolution),
          humanNote: 'Substituted note',
        };
      },
    ],
    [
      'actor',
      (v: HostedIncidentResponse) => {
        v.event = {
          ...requireValue(v.event),
          actor: { kind: 'human', id: 'other', via: 'web' },
        };
      },
    ],
    [
      'sequence',
      (v: HostedIncidentResponse) => {
        v.event = {
          ...requireValue(v.event),
          seq: wire.request.expectedSeq + 2,
        };
      },
    ],
    [
      'proof refs',
      (v: HostedIncidentResponse) => {
        v.event = { ...requireValue(v.event), refs: [] };
      },
    ],
    [
      'digest',
      (v: HostedIncidentResponse) => {
        v.incident.resolution = {
          ...requireValue(v.incident.resolution),
          proof: {
            ...requireValue(v.incident.resolution).proof,
            definitionDigest: 'a'.repeat(64),
          },
        };
      },
    ],
    [
      'private field',
      (v: HostedIncidentResponse) => {
        Object.assign(v.incident, {
          resolutionEventId: requireValue(v.event).id,
        });
      },
    ],
    [
      'outcome',
      (v: HostedIncidentResponse) => {
        Object.assign(requireValue(v.incident.resolution).proof, {
          outcome: 'fail',
        });
      },
    ],
    [
      'future evaluation',
      (v: HostedIncidentResponse) => {
        Object.assign(requireValue(v.incident.resolution).proof, {
          evaluatedAt: '2026-10-21T12:00:00.000000001Z',
        });
        Object.assign(requireValue(v.event).payload, {
          proof: requireValue(v.incident.resolution).proof,
        });
      },
    ],
  ] as const)(
    'rejects an unconfirmed %s instead of reporting Resolved',
    (_name, mutate) => {
      const value = response();
      mutate(value);
      expect(() =>
        validateHostedResolveSuccess(
          value,
          action(),
          context,
          wire.request.operationId,
        ),
      ).toThrow();
    },
  );
  it('denies cross-account/Space/project/environment lookup scope', () => {
    for (const changed of [
      { principal: 'other' },
      { spaceID: 'other' },
      { project: 'other' },
    ])
      expect(() =>
        validateHostedResolveScope(action(), { ...context, ...changed }),
      ).toThrow();
    expect(() =>
      validateHostedResolveScope(
        { ...action(), environment: 'other' },
        context,
      ),
    ).toThrow();
  });
});
