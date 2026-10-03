import {
  incidentEvidenceTargets,
  incidentHypotheses,
  incidentProjectTargets,
} from './incident-evidence-targets';
import type { IncidentArtifactRef, IncidentDetail } from './models';

const AGENT = 'url-agent:8989';

describe('incidentEvidenceTargets', () => {
  it('links only query, board, and project routes that exist', () => {
    const refs: IncidentArtifactRef[] = [
      {
        kind: 'query',
        artifact: {
          storeId: 'local',
          projectId: 'billing',
          id: 'customers/invoices',
        },
      },
      {
        kind: 'board',
        artifact: { storeId: 'local', projectId: 'billing', id: 'support' },
      },
      {
        kind: 'project',
        project: {
          storeId: 'local',
          projectId: 'billing',
          environment: 'prod',
        },
      },
      {
        kind: 'execution',
        execution: {
          storeId: 'local',
          projectId: 'billing',
          executionId: 'exec-1',
        },
      },
      {
        kind: 'check',
        artifact: {
          storeId: 'local',
          projectId: 'billing',
          id: 'invoice-totals',
        },
      },
      {
        kind: 'compare',
        comparison: {
          left: {
            storeId: 'local',
            projectId: 'billing',
            executionId: 'left-1',
          },
          right: {
            storeId: 'local',
            projectId: 'billing',
            executionId: 'right-1',
          },
        },
      },
    ];

    const targets = incidentEvidenceTargets(refs, AGENT);
    expect(targets[0]).toMatchObject({
      kind: 'query',
      routerLink: [
        `/store/${AGENT}/project/billing`,
        'query',
        'customers/invoices',
      ],
      queryParams: { id: 'customers/invoices' },
    });
    expect(targets[1].routerLink).toEqual([
      `/store/${AGENT}/project/billing`,
      'board',
      'support',
    ]);
    expect(targets[2].routerLink).toEqual([`/store/${AGENT}/project/billing`]);
    expect(targets[3].routerLink).toBeUndefined();
    expect(targets[4].routerLink).toBeUndefined();
    expect(targets[5].routerLink).toBeUndefined();
  });
});

// G-A1c: the project's address is `projectUrl()`'s; the page segments after it stay raw for the router.
describe('incident links use the project address of the serving agent (G-A1c)', () => {
  it.each([
    ['http://localhost:8989', '/store/http-localhost:8989/project/billing'],
    ['http-localhost:8989', '/store/http-localhost:8989/project/billing'],
    ['localhost:8989', '/store/localhost:8989/project/billing'],
  ])('agent %s', (agent, address) => {
    expect(
      incidentProjectTargets(
        [{ storeId: 'local', projectId: 'billing' }],
        agent,
      )[0].routerLink,
    ).toEqual([address]);
    const targets = incidentEvidenceTargets(
      [
        {
          kind: 'query',
          artifact: { storeId: 'local', projectId: 'billing', id: 'a/b' },
        },
      ],
      agent,
    );
    expect(targets[0].routerLink).toEqual([address, 'query', 'a/b']);
  });

  it('links to the root for a project that has no exact address', () => {
    expect(
      incidentProjectTargets([{ storeId: 'local', projectId: '50%' }], AGENT)[0]
        .routerLink,
    ).toEqual(['/']);
    expect(
      incidentEvidenceTargets(
        [
          {
            kind: 'board',
            artifact: { storeId: 'local', projectId: '50%', id: 'support' },
          },
        ],
        AGENT,
      )[0].routerLink,
    ).toEqual(['/']);
  });
});

describe('incidentHypotheses', () => {
  it('groups overlay facts by hypothesis layer and marks rejections', () => {
    const incident: IncidentDetail = {
      ref: { storeId: 'ops', incidentId: 'INC-1' },
      uid: 'uid-1',
      title: 'Checkout',
      status: 'open',
      lastSeq: 1,
      canonicalContext: {
        facts: [
          {
            id: 'fx',
            entity: 'FxRate',
            field: 'Provider',
            value: { type: 'string', value: 'down' },
            origin: 'context',
            enabled: true,
            layer: 'hypothesis:H17',
          },
          {
            id: 'deploy',
            entity: 'Release',
            field: 'Id',
            value: { type: 'string', value: '14:17' },
            origin: 'context',
            enabled: true,
            layer: 'hypothesis:H18',
          },
        ],
      },
      contextRejections: [{ eventId: 'evt-reject', layer: 'hypothesis:H18' }],
    };

    expect(incidentHypotheses(incident)).toEqual([
      {
        id: 'H17',
        layer: 'hypothesis:H17',
        state: 'proposed',
        facts: [incident.canonicalContext.facts[0]],
      },
      {
        id: 'H18',
        layer: 'hypothesis:H18',
        state: 'rejected',
        facts: [incident.canonicalContext.facts[1]],
      },
    ]);
  });
});

describe('incidentProjectTargets', () => {
  it('builds the existing project overview route from the serving agent', () => {
    expect(
      incidentProjectTargets(
        [{ storeId: 'local', projectId: 'billing', environment: 'prod' }],
        AGENT,
      ),
    ).toEqual([
      {
        project: {
          storeId: 'local',
          projectId: 'billing',
          environment: 'prod',
        },
        routerLink: [`/store/${AGENT}/project/billing`],
      },
    ]);
  });
});
