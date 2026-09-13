import { provideHttpClient } from '@angular/common/http';
import {
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
            payload: { title: INCIDENT.title },
          },
        }) + '\n',
      );

      expect(result).toMatchObject({
        kind: 'ok',
        data: [{ cursor: 'cursor-1', event: { id: 'create-1', seq: 1 } }],
      });
    });

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
});
