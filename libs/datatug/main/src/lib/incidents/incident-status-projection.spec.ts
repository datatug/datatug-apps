import { incidentStatusProjection } from './incident-status-projection';
import type {
  IncidentDetail,
  IncidentFactView,
  IncidentStreamItem,
} from './models';

const incident = (overrides: Partial<IncidentDetail> = {}): IncidentDetail => ({
  ref: { storeId: 'ops', incidentId: 'INC-1' },
  uid: 'uid-1',
  title: 'Checkout errors',
  status: 'investigating',
  canonicalContext: { facts: [] },
  lastSeq: 2,
  ...overrides,
});

const item = (
  event: Partial<IncidentStreamItem['event']> &
    Pick<IncidentStreamItem['event'], 'id' | 'seq' | 'type' | 'payload'>,
): IncidentStreamItem => ({
  cursor: `cursor-${event.id}`,
  event: {
    at: '2026-09-13T08:00:00Z',
    visibleAt: '2026-09-13T08:00:00Z',
    incident: { storeId: 'ops', incidentId: 'INC-1' },
    actor: { kind: 'human', id: 'alex', via: 'web' },
    assertion: { kind: 'claim' },
    ...event,
  },
});

const affectedFact = (
  overrides: Partial<IncidentFactView> = {},
): IncidentFactView => ({
  id: 'invoice-42',
  entity: 'Invoice',
  field: 'ID',
  value: { type: 'string', value: '42' },
  origin: 'context',
  enabled: true,
  role: 'affected',
  ...overrides,
});

describe('incidentStatusProjection', () => {
  it('cites the visible status event and never words a hypothesis as a fact', () => {
    const hypothesisFact: IncidentFactView = {
      id: 'fx-rate',
      entity: 'FxRate',
      field: 'Provider',
      value: { type: 'string', value: 'down' },
      origin: 'context',
      enabled: true,
      role: 'suspected',
      layer: 'hypothesis:H17',
    };
    const events = [
      item({
        id: 'evt-created',
        seq: 1,
        type: 'incident.created',
        payload: {
          uid: 'uid-1',
          title: 'Checkout errors',
          description: '',
          reporter: { kind: 'human', id: 'alex', via: 'web' },
          canonicalContext: { facts: [] },
        },
      }),
      item({
        id: 'evt-status',
        seq: 2,
        type: 'incident.status',
        payload: { status: 'investigating' },
      }),
      item({
        id: 'evt-hypothesis',
        seq: 3,
        type: 'context.fact.added',
        payload: { fact: hypothesisFact },
      }),
    ];
    const sentences = incidentStatusProjection(
      incident({
        canonicalContext: { facts: [hypothesisFact] },
        lastSeq: 3,
      }),
      events,
    );

    expect(sentences).toEqual([
      {
        text: 'Status is investigating.',
        eventIds: ['evt-status'],
      },
      {
        text: '1 hypothesis is proposed.',
        eventIds: ['evt-hypothesis'],
      },
    ]);
    expect(sentences.map((sentence) => sentence.text).join(' ')).not.toMatch(
      /fx-rate provider is down|Provider is down|hypothesis:H17 is down/iu,
    );
    for (const sentence of sentences) {
      for (const eventId of sentence.eventIds) {
        expect(events.some((entry) => entry.event.id === eventId)).toBe(true);
      }
    }
  });

  it('omits a status sentence when the supporting event is not visible', () => {
    expect(
      incidentStatusProjection(incident({ status: 'mitigating' }), []),
    ).toEqual([]);
  });

  it('cites promotion events for affected canonical facts', () => {
    const sentences = incidentStatusProjection(
      incident({
        canonicalContext: { facts: [affectedFact()] },
      }),
      [
        item({
          id: 'evt-promoted',
          seq: 4,
          type: 'context.fact.promoted',
          payload: {
            fact: {
              scope: {
                storeId: 'local',
                projectId: 'billing',
                environment: 'prod',
              },
              id: 'invoice-42',
              layer: 'hypothesis:H17',
            },
            role: 'affected',
          },
        }),
      ],
    );

    expect(sentences).toContainEqual({
      text: '1 affected fact is recorded in canonical context.',
      eventIds: ['evt-promoted'],
    });
  });
});
