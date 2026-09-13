import { provideHttpClient } from '@angular/common/http';
import {
  AppendIncidentEventRequest,
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IncidentClientService } from './incident-client.service';
import {
  CreateIncidentRequest,
  IncidentDetail,
  IncidentSummary,
} from './models';

const STORE_ID = 'localhost:8989';
const INCIDENT_STORE_ID = 'ops';
const BASE_URL = '//localhost:8989/datatug/incidents';
const CONTEXT = {
  agentStoreId: STORE_ID,
  scope: {
    storeId: INCIDENT_STORE_ID,
    project: 'billing',
    environment: 'prod',
    securityContextId: 'ctx-1',
  },
} as const;
const INCIDENT: IncidentDetail = {
  ref: { storeId: INCIDENT_STORE_ID, incidentId: 'INC-1' },
  uid: '6ddfe079-d5fe-4d77-b322-11b9a31a9766',
  title: 'Checkout errors spike',
  status: 'open',
  canonicalContext: { facts: [] },
  lastSeq: 1,
};
const CREATE_REQUEST: CreateIncidentRequest = {
  storeId: INCIDENT_STORE_ID,
  project: 'billing',
  environment: 'prod',
  securityContextId: 'ctx-1',
  mutationId: 'mutation-create-1',
  title: 'Houston, we have a problem',
  canonicalContext: { facts: [] },
};

const CREATED_PAYLOAD = {
  uid: INCIDENT.uid,
  title: INCIDENT.title,
  description: '',
  projects: [{ storeId: 'local', projectId: 'billing', environment: 'prod' }],
  reporter: { kind: 'human', id: 'alice', via: 'web' },
  canonicalContext: { facts: [] },
} as const;

const eventFixture = (
  type: string,
  payload: unknown,
  overrides: Record<string, unknown> = {},
) => ({
  id: 'event-1',
  seq: 1,
  at: '2026-09-13T08:00:00Z',
  visibleAt: '2026-09-13T08:00:00Z',
  incident: INCIDENT.ref,
  actor: { kind: 'human', id: 'alice', via: 'web' },
  type,
  assertion: { kind: 'observation' },
  payload,
  ...overrides,
});

describe('IncidentClientService', () => {
  let service: IncidentClientService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(IncidentClientService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('list', () => {
    it('GETs /datatug/incidents and wraps the response as an ok result', () => {
      const fixture: IncidentSummary[] = [INCIDENT];

      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      const req = httpMock.expectOne((r) => r.url === BASE_URL);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('storeId')).toBe(INCIDENT_STORE_ID);
      expect(req.request.params.get('project')).toBe('billing');
      expect(req.request.params.get('environment')).toBe('prod');
      expect(req.request.params.get('securityContextId')).toBe('ctx-1');
      req.flush({ incidents: fixture });

      expect(result).toEqual({ kind: 'ok', data: fixture });
    });

    it('sends repeated status filters as query params', () => {
      service
        .list(CONTEXT, {
          status: ['open', 'investigating'],
          query: 'customer-invoices',
          check: 'invoice-totals',
          board: 'support',
        })
        .subscribe();

      const req = httpMock.expectOne((r) => r.url === BASE_URL);
      expect(req.request.params.getAll('status')).toEqual([
        'open',
        'investigating',
      ]);
      expect(req.request.params.get('query')).toBe('customer-invoices');
      expect(req.request.params.get('check')).toBe('invoice-totals');
      expect(req.request.params.get('board')).toBe('support');
      req.flush({ incidents: [] });
    });

    it('reports "unavailable" for an older server route-level 404', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush('not found', { status: 404, statusText: 'Not Found' });

      expect(result).toEqual({
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      });
    });

    it('reports "unavailable" on a 501 (explicit not-implemented)', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush('not implemented', {
          status: 501,
          statusText: 'Not Implemented',
        });

      expect(result).toEqual({
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      });
    });

    it('reports a network failure (status 0) distinctly from "unavailable"', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .error(new ProgressEvent('error'), { status: 0 });

      expect(result).toEqual({
        kind: 'error',
        message: 'Could not reach the DataTug server.',
      });
    });

    it('reports a generic error result for a 500', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush(
          { error: { code: 'INTERNAL', message: 'boom', requestId: 'r1' } },
          { status: 500, statusText: 'Internal Server Error' },
        );

      expect(result).toEqual({ kind: 'error', message: 'boom' });
    });

    it('preserves the structured STALE_CONTEXT code for caller recovery', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush(
          {
            error: {
              code: 'STALE_CONTEXT',
              message: 'Refresh agent info and retry.',
              requestId: 'r-stale',
            },
          },
          { status: 409, statusText: 'Conflict' },
        );

      expect(result).toEqual({
        kind: 'error',
        code: 'STALE_CONTEXT',
        message: 'Refresh agent info and retry.',
      });
    });

    it('rejects a success response that is missing the frozen envelope', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock.expectOne((r) => r.url === BASE_URL).flush({});

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident list response.',
      });
    });

    it('rejects malformed incidents inside a valid list envelope', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock.expectOne((r) => r.url === BASE_URL).flush({ incidents: [{}] });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('rejects path-shaped qualified incident ids', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush({
          incidents: [
            {
              ...INCIDENT,
              ref: { storeId: STORE_ID, incidentId: '../agent-info' },
            },
          ],
        });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('rejects malformed optional qualified references', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush({
          incidents: [
            {
              ...INCIDENT,
              mergedInto: { storeId: 'ops', incidentId: 'INC/2' },
              projects: [{ storeId: ' ops', projectId: 'billing' }],
            },
          ],
        });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('accepts the complete visible fact view and a deliberately redacted fact', () => {
      const facts = [
        {
          id: 'customer-5',
          entity: 'Customer',
          field: 'ID',
          value: { type: 'integer', value: '5' },
          origin: 'context',
          physical: {
            source: 'billing-db',
            collection: 'customers',
            column: 'id',
          },
          mapping: 'declared',
          enabled: true,
          condition: '>=',
          role: 'affected',
          layer: 'canonical',
          scope: {
            storeId: 'local',
            projectId: 'billing',
            environment: 'prod',
          },
        },
        {
          id: 'customer-secret',
          entity: 'Customer',
          value: { redacted: true },
          origin: 'manual',
          enabled: true,
          role: 'suspected',
          layer: 'hypothesis:root-cause',
          scope: { storeId: 'local', projectId: 'billing' },
        },
      ];
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush({ incidents: [{ ...INCIDENT, canonicalContext: { facts } }] });

      expect(result).toEqual({
        kind: 'ok',
        data: [{ ...INCIDENT, canonicalContext: { facts } }],
      });
    });

    it.each([
      ['visible field', { field: '' }],
      [
        'noncanonical integer value',
        { value: { type: 'integer', value: '05' } },
      ],
      [
        'invalid calendar date value',
        { value: { type: 'date', value: '2026-02-30' } },
      ],
      [
        'non-normalized datetime value',
        { value: { type: 'datetime', value: '2026-09-11T10:43:40+01:00' } },
      ],
      [
        'extra typed-value key',
        { value: { type: 'string', value: 'five', trusted: true } },
      ],
      [
        'physical ref',
        { physical: { source: '', collection: 'c', column: 'x' } },
      ],
      ['mapping', { mapping: 'guessed' }],
      ['condition', { condition: 'contains' }],
      ['role', { role: 'owner' }],
      ['layer', { layer: 'hypothesis: ' }],
      [
        'scope',
        {
          scope: {
            storeId: '../local',
            projectId: 'billing',
            environment: 'prod',
          },
        },
      ],
    ])('rejects a malformed fact %s', (_name, malformed) => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush({
          incidents: [
            {
              ...INCIDENT,
              canonicalContext: {
                facts: [
                  {
                    id: 'customer-5',
                    entity: 'Customer',
                    field: 'ID',
                    value: { type: 'integer', value: '5' },
                    origin: 'context',
                    enabled: true,
                    ...malformed,
                  },
                ],
              },
            },
          ],
        });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('rejects physical provenance on a value-redacted fact', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush({
          incidents: [
            {
              ...INCIDENT,
              canonicalContext: {
                facts: [
                  {
                    id: 'customer-secret',
                    entity: 'Customer',
                    value: { redacted: true },
                    origin: 'context',
                    enabled: true,
                    physical: {
                      source: 'billing-db',
                      collection: 'customers',
                      column: 'secret',
                    },
                  },
                ],
              },
            },
          ],
        });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('rejects a self-referential mergedInto projection', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush({
          incidents: [{ ...INCIDENT, mergedInto: INCIDENT.ref }],
        });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('rejects malformed assetRefs in a projection', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush({
          incidents: [
            {
              ...INCIDENT,
              assetRefs: [
                {
                  kind: 'check',
                  artifact: {
                    storeId: 'ops',
                    projectId: 'billing',
                    id: '../check',
                  },
                },
              ],
            },
          ],
        });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('accepts every structured assetRef identity in a projection', () => {
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush({
          incidents: [
            {
              ...INCIDENT,
              assetRefs: [
                { kind: 'event', id: 'event-1' },
                { kind: 'incident', incident: INCIDENT.ref },
                {
                  kind: 'project',
                  project: {
                    storeId: 'ops',
                    projectId: 'billing',
                    environment: 'prod',
                  },
                },
                {
                  kind: 'execution',
                  execution: {
                    storeId: 'ops',
                    projectId: 'billing',
                    executionId: 'run-1',
                  },
                },
                {
                  kind: 'check',
                  artifact: {
                    storeId: 'ops',
                    projectId: 'billing',
                    environment: 'prod',
                    id: 'invoice-health',
                  },
                },
                {
                  kind: 'compare',
                  comparison: {
                    left: {
                      storeId: 'ops',
                      projectId: 'billing',
                      executionId: 'run-1',
                    },
                    right: {
                      storeId: 'ops',
                      projectId: 'billing',
                      executionId: 'run-2',
                    },
                  },
                },
              ],
            },
          ],
        });

      expect(result).toMatchObject({ kind: 'ok' });
    });

    it('rejects duplicate fact ids within one project scope', () => {
      const fact = {
        id: 'customer-5',
        entity: 'Customer',
        field: 'ID',
        value: { type: 'integer', value: '5' },
        origin: 'context',
        enabled: true,
        scope: {
          storeId: 'local',
          projectId: 'billing',
          environment: 'prod',
        },
      };
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush({
          incidents: [
            { ...INCIDENT, canonicalContext: { facts: [fact, { ...fact }] } },
          ],
        });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('allows the same fact id in different project scopes', () => {
      const fact = {
        id: 'customer-5',
        entity: 'Customer',
        field: 'ID',
        value: { type: 'integer', value: '5' },
        origin: 'context',
        enabled: true,
        scope: {
          storeId: 'local',
          projectId: 'billing',
          environment: 'prod',
        },
      };
      let result: unknown;
      service.list(CONTEXT).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush({
          incidents: [
            {
              ...INCIDENT,
              canonicalContext: {
                facts: [
                  fact,
                  {
                    ...fact,
                    scope: { ...fact.scope, projectId: 'warehouse' },
                  },
                ],
              },
            },
          ],
        });

      expect(result).toMatchObject({ kind: 'ok' });
    });
  });

  describe('get', () => {
    it('GETs /datatug/incidents/{id}', () => {
      const fixture: IncidentDetail = {
        ...INCIDENT,
        description: '5xx rate above baseline',
      };

      let result: unknown;
      service.get(CONTEXT, 'INC-1').subscribe((r) => (result = r));

      const req = httpMock.expectOne((r) => r.url === `${BASE_URL}/INC-1`);
      expect(req.request.method).toBe('GET');
      req.flush({ incident: fixture });

      expect(result).toEqual({ kind: 'ok', data: fixture });
    });

    it('sends ?at= for a historical projection', () => {
      service.get(CONTEXT, 'INC-1', '2026-09-11T10:43:40Z').subscribe();

      const req = httpMock.expectOne((r) => r.url === `${BASE_URL}/INC-1`);
      expect(req.request.params.get('at')).toBe('2026-09-11T10:43:40Z');
      expect(req.request.params.get('storeId')).toBe(INCIDENT_STORE_ID);
      expect(req.request.params.get('project')).toBe('billing');
      expect(req.request.params.get('environment')).toBe('prod');
      expect(req.request.params.get('securityContextId')).toBe('ctx-1');
      req.flush({ incident: INCIDENT });
    });

    it('reports an unstructured route-level 404 as unavailable for an old server', () => {
      let result: unknown;
      service.get(CONTEXT, 'INC-1').subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === `${BASE_URL}/INC-1`)
        .flush('not found', { status: 404, statusText: 'Not Found' });

      expect(result).toEqual({
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      });
    });

    it('reports a structured current-server NOT_FOUND error truthfully', () => {
      let result: unknown;
      service.get(CONTEXT, 'INC-404').subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === `${BASE_URL}/INC-404`)
        .flush(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Incident INC-404 was not found.',
              requestId: 'request-1',
            },
          },
          { status: 404, statusText: 'Not Found' },
        );

      expect(result).toEqual({
        kind: 'error',
        message: 'Incident INC-404 was not found.',
      });
    });

    it('rejects a success response without an incident envelope', () => {
      let result: unknown;
      service.get(CONTEXT, 'INC-1').subscribe((r) => (result = r));

      httpMock.expectOne((r) => r.url === `${BASE_URL}/INC-1`).flush({});

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('rejects a malformed incident inside a valid envelope', () => {
      let result: unknown;
      service.get(CONTEXT, 'INC-1').subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === `${BASE_URL}/INC-1`)
        .flush({ incident: {} });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });
  });

  describe('create', () => {
    it('POSTs the title/description to /datatug/incidents', () => {
      const fixture: IncidentDetail = {
        ...INCIDENT,
        ref: { storeId: INCIDENT_STORE_ID, incidentId: 'INC-2' },
        title: 'Houston, we have a problem',
      };

      let result: unknown;
      service.create(STORE_ID, CREATE_REQUEST).subscribe((r) => (result = r));

      const req = httpMock.expectOne((r) => r.url === BASE_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(CREATE_REQUEST);
      req.flush({ incident: fixture });

      expect(result).toEqual({ kind: 'ok', data: fixture });
    });

    it('reports "unavailable" on 404, keeping the caller free to retry with the same draft', () => {
      let result: unknown;
      service.create(STORE_ID, CREATE_REQUEST).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush('not found', { status: 404, statusText: 'Not Found' });

      expect(result).toEqual({
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      });
    });
  });

  describe('events', () => {
    it('GETs the finite incident NDJSON stream with the full read scope', () => {
      let result: unknown;
      service.events(CONTEXT, 'INC-1').subscribe((r) => (result = r));

      const req = httpMock.expectOne(
        (r) => r.url === `${BASE_URL}/INC-1/events`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('storeId')).toBe(INCIDENT_STORE_ID);
      expect(req.request.params.get('project')).toBe('billing');
      expect(req.request.params.get('environment')).toBe('prod');
      expect(req.request.params.get('securityContextId')).toBe('ctx-1');
      expect(req.request.params.get('follow')).toBe('false');
      req.flush(
        JSON.stringify({
          cursor: 'cursor-1',
          event: {
            id: 'create-1',
            seq: 1,
            at: '2026-09-13T08:00:00Z',
            visibleAt: '2026-09-13T08:00:00Z',
            incident: INCIDENT.ref,
            actor: { kind: 'human', id: 'alice', via: 'web' },
            type: 'incident.created',
            assertion: { kind: 'observation' },
            payload: CREATED_PAYLOAD,
          },
        }) + '\n',
      );

      expect(result).toMatchObject({
        kind: 'ok',
        data: [{ cursor: 'cursor-1', event: { id: 'create-1', seq: 1 } }],
      });
    });

    it.each([
      ['incident.created', CREATED_PAYLOAD],
      ['incident.status', { status: 'investigating' }],
      ['incident.outcome', { outcome: 'resolved' }],
      [
        'incident.merged',
        {
          into: { storeId: 'ops', incidentId: 'INC-2' },
          mergeId: 'merge-1',
        },
      ],
      ['note.added', { body: 'Payment API is slow' }],
      [
        'context.fact.added',
        {
          fact: {
            id: 'customer-secret',
            entity: 'Customer',
            value: { redacted: true },
            origin: 'context',
            enabled: true,
            role: 'suspected',
            layer: 'hypothesis:H17',
            scope: {
              storeId: 'local',
              projectId: 'billing',
              environment: 'prod',
            },
          },
        },
      ],
      [
        'context.fact.promoted',
        {
          fact: {
            scope: {
              storeId: 'local',
              projectId: 'billing',
              environment: 'prod',
            },
            id: 'customer-11',
            layer: 'hypothesis:H17',
          },
          role: 'affected',
        },
      ],
      ['context.fact.rejected', { layer: 'hypothesis:H17' }],
      ['context.fact.rejected', { layer: 'hypothesis:checkout / EU west' }],
    ])('accepts a valid %s event view', (type, payload) => {
      let result: unknown;
      service.events(CONTEXT, 'INC-1').subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === `${BASE_URL}/INC-1/events`)
        .flush(
          JSON.stringify({
            cursor: `cursor-${type}`,
            event: eventFixture(type, payload, {
              ...(type === 'incident.created' ? {} : { seq: 2 }),
            }),
          }),
        );

      expect(result).toMatchObject({ kind: 'ok' });
    });

    it('accepts a valid imported event view with strict provenance and refs', () => {
      let result: unknown;
      service.events(CONTEXT, 'INC-1').subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === `${BASE_URL}/INC-1/events`)
        .flush(
          JSON.stringify({
            cursor: 'cursor-imported',
            event: eventFixture(
              'note.added',
              { body: 'Imported evidence' },
              {
                seq: 2,
                importedFrom: {
                  incident: { storeId: 'ops', incidentId: 'INC-source' },
                  eventId: 'source-note-1',
                  seq: 2,
                  mergeId: 'merge-1',
                },
                refs: [{ kind: 'event', id: 'source-note-1' }],
              },
            ),
          }),
        );

      expect(result).toMatchObject({ kind: 'ok' });
    });

    it.each([
      [
        'created policy view',
        eventFixture('incident.created', {
          ...CREATED_PAYLOAD,
          canonicalContext: {
            facts: [
              {
                id: 'secret',
                entity: 'Customer',
                value: { redacted: true },
                origin: 'context',
                enabled: true,
              },
              {
                id: 'secret',
                entity: 'Customer',
                value: { redacted: true },
                origin: 'context',
                enabled: true,
              },
            ],
          },
        }),
      ],
      [
        'assertion provenance',
        eventFixture(
          'note.added',
          { body: 'Inference' },
          {
            seq: 2,
            assertion: { kind: 'inference' },
          },
        ),
      ],
      [
        'nested artifact ref',
        eventFixture(
          'note.added',
          { body: 'Bad ref' },
          {
            seq: 2,
            refs: [{ kind: 'check', id: 'check-1' }],
          },
        ),
      ],
      [
        'import provenance',
        eventFixture(
          'note.added',
          { body: 'Bad import' },
          {
            seq: 2,
            importedFrom: {
              incident: INCIDENT.ref,
              eventId: 'source-note-1',
              seq: 1,
              mergeId: 'merge-1',
            },
          },
        ),
      ],
      [
        'type-specific payload',
        eventFixture('incident.status', { body: 'not a status' }, { seq: 2 }),
      ],
      [
        'payload extra key',
        eventFixture(
          'note.added',
          { body: 'Visible note', policyBypass: true },
          { seq: 2 },
        ),
      ],
      [
        'trimmed overlay owner id',
        eventFixture(
          'context.fact.rejected',
          { layer: 'hypothesis: leading-space' },
          { seq: 2 },
        ),
      ],
    ])('rejects malformed %s in an event view', (_name, event) => {
      let result: unknown;
      service.events(CONTEXT, 'INC-1').subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === `${BASE_URL}/INC-1/events`)
        .flush(JSON.stringify({ cursor: 'cursor-bad', event }));

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident events response.',
      });
    });

    it('preserves structured STALE_CONTEXT from a text-mode events request', () => {
      let result: unknown;
      service.events(CONTEXT, 'INC-1').subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === `${BASE_URL}/INC-1/events`)
        .flush(
          JSON.stringify({
            error: {
              code: 'STALE_CONTEXT',
              message: 'Refresh agent info and retry.',
              requestId: 'request-events-stale',
            },
          }),
          { status: 409, statusText: 'Conflict' },
        );

      expect(result).toEqual({
        kind: 'error',
        code: 'STALE_CONTEXT',
        message: 'Refresh agent info and retry.',
      });
    });

    it.each([
      ['malformed JSON', '{not-json'],
      [
        'unknown error code',
        JSON.stringify({
          error: {
            code: 'SOMETHING_NEW',
            message: 'Unknown response.',
            requestId: 'request-unknown',
          },
        }),
      ],
      [
        'targets on a non-target error',
        JSON.stringify({
          error: {
            code: 'STALE_CONTEXT',
            message: 'Refresh agent info and retry.',
            requestId: 'request-targets',
            targets: [{ source: 'db', label: 'Database' }],
          },
        }),
      ],
    ])(
      'does not trust a %s text error as a structured envelope',
      (_name, body) => {
        let result: unknown;
        service.events(CONTEXT, 'INC-1').subscribe((r) => (result = r));

        httpMock
          .expectOne((r) => r.url === `${BASE_URL}/INC-1/events`)
          .flush(body, { status: 409, statusText: 'Conflict' });

        expect(result).toMatchObject({ kind: 'error' });
        expect(result).not.toMatchObject({ code: 'STALE_CONTEXT' });
      },
    );

    it('rejects malformed NDJSON truthfully', () => {
      let result: unknown;
      service.events(CONTEXT, 'INC-1').subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === `${BASE_URL}/INC-1/events`)
        .flush('{not-json}\n');

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident events response.',
      });
    });
  });

  describe('append', () => {
    const request: AppendIncidentEventRequest = {
      ...CONTEXT.scope,
      mutationId: 'mutation-context-promote-1',
      incident: INCIDENT.ref,
      expectedSeq: 1,
      event: {
        at: '2026-09-13T08:01:00Z',
        type: 'context.fact.promoted',
        assertion: { kind: 'claim', confidence: 'confirmed' },
        refs: [{ kind: 'hypothesis', id: 'H17' }],
        payload: {
          fact: {
            scope: {
              storeId: 'local',
              projectId: 'billing',
              environment: 'prod',
            },
            id: 'customer-11',
            layer: 'hypothesis:H17',
          },
          role: 'affected',
        },
      },
    };

    it('POSTs the frozen append request and strictly decodes the committed event and projection', () => {
      let result: unknown;
      service
        .append(CONTEXT, 'INC-1', request)
        .subscribe((value) => (result = value));

      const httpRequest = httpMock.expectOne(`${BASE_URL}/INC-1/events`);
      expect(httpRequest.request.method).toBe('POST');
      expect(httpRequest.request.body).toEqual(request);
      const event = eventFixture(
        'context.fact.promoted',
        request.event.payload,
        {
          seq: 2,
          assertion: request.event.assertion,
          refs: request.event.refs,
        },
      );
      const projection = {
        ...INCIDENT,
        lastSeq: 2,
        contextPromotions: [
          {
            eventId: 'event-1',
            fact: request.event.payload.fact,
            role: 'affected',
          },
        ],
      };
      httpRequest.flush({ event, projection, replayed: false });

      expect(result).toEqual({
        kind: 'ok',
        data: { event, projection, replayed: false },
      });
    });

    it('rejects an append response with unknown projection fields', () => {
      let result: unknown;
      service
        .append(CONTEXT, 'INC-1', request)
        .subscribe((value) => (result = value));
      httpMock.expectOne(`${BASE_URL}/INC-1/events`).flush({
        event: eventFixture('context.fact.promoted', request.event.payload, {
          seq: 2,
          assertion: request.event.assertion,
          refs: request.event.refs,
        }),
        projection: { ...INCIDENT, policyBypass: true },
        replayed: false,
      });
      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('rejects duplicate promotions for the same qualified fact identity', () => {
      let result: unknown;
      service
        .append(CONTEXT, 'INC-1', request)
        .subscribe((value) => (result = value));
      const duplicate = {
        eventId: 'event-2',
        fact: request.event.payload.fact,
        role: 'affected' as const,
      };
      httpMock.expectOne(`${BASE_URL}/INC-1/events`).flush({
        event: eventFixture('context.fact.promoted', request.event.payload, {
          seq: 2,
          assertion: request.event.assertion,
          refs: request.event.refs,
        }),
        projection: {
          ...INCIDENT,
          contextPromotions: [{ ...duplicate, eventId: 'event-1' }, duplicate],
        },
        replayed: false,
      });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('rejects promotion and rejection histories that contradict on one layer', () => {
      let result: unknown;
      service
        .append(CONTEXT, 'INC-1', request)
        .subscribe((value) => (result = value));
      httpMock.expectOne(`${BASE_URL}/INC-1/events`).flush({
        event: eventFixture('context.fact.promoted', request.event.payload, {
          seq: 2,
          assertion: request.event.assertion,
          refs: request.event.refs,
        }),
        projection: {
          ...INCIDENT,
          contextPromotions: [
            {
              eventId: 'event-1',
              fact: request.event.payload.fact,
              role: 'affected',
            },
          ],
          contextRejections: [{ eventId: 'event-2', layer: 'hypothesis:H17' }],
        },
        replayed: false,
      });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });
  });
});
