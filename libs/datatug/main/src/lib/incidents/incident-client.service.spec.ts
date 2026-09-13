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
const BASE_URL = '//localhost:8989/datatug/incidents';
const INCIDENT: IncidentDetail = {
  ref: { storeId: STORE_ID, incidentId: 'INC-1' },
  uid: '6ddfe079-d5fe-4d77-b322-11b9a31a9766',
  title: 'Checkout errors spike',
  status: 'open',
  lastSeq: 1,
};
const CREATE_REQUEST: CreateIncidentRequest = {
  storeId: STORE_ID,
  project: 'billing',
  environment: 'prod',
  securityContextId: 'ctx-1',
  mutationId: 'mutation-create-1',
  title: 'Houston, we have a problem',
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
      service.list(STORE_ID).subscribe((r) => (result = r));

      const req = httpMock.expectOne((r) => r.url === BASE_URL);
      expect(req.request.method).toBe('GET');
      req.flush({ incidents: fixture });

      expect(result).toEqual({ kind: 'ok', data: fixture });
    });

    it('sends repeated status filters as query params', () => {
      service.list(STORE_ID, { status: ['open', 'investigating'] }).subscribe();

      const req = httpMock.expectOne((r) => r.url === BASE_URL);
      expect(req.request.params.getAll('status')).toEqual([
        'open',
        'investigating',
      ]);
      req.flush({ incidents: [] });
    });

    it('reports "unavailable" on a 404 (route not registered yet)', () => {
      let result: unknown;
      service.list(STORE_ID).subscribe((r) => (result = r));

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
      service.list(STORE_ID).subscribe((r) => (result = r));

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
      service.list(STORE_ID).subscribe((r) => (result = r));

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
      service.list(STORE_ID).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush(
          { error: { code: 'INTERNAL', message: 'boom', requestId: 'r1' } },
          { status: 500, statusText: 'Internal Server Error' },
        );

      expect(result).toEqual({ kind: 'error', message: 'boom' });
    });

    it('rejects a success response that is missing the frozen envelope', () => {
      let result: unknown;
      service.list(STORE_ID).subscribe((r) => (result = r));

      httpMock.expectOne((r) => r.url === BASE_URL).flush({});

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident list response.',
      });
    });

    it('rejects malformed incidents inside a valid list envelope', () => {
      let result: unknown;
      service.list(STORE_ID).subscribe((r) => (result = r));

      httpMock.expectOne((r) => r.url === BASE_URL).flush({ incidents: [{}] });

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('rejects path-shaped qualified incident ids', () => {
      let result: unknown;
      service.list(STORE_ID).subscribe((r) => (result = r));

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
      service.list(STORE_ID).subscribe((r) => (result = r));

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
  });

  describe('get', () => {
    it('GETs /datatug/incidents/{id}', () => {
      const fixture: IncidentDetail = {
        ...INCIDENT,
        description: '5xx rate above baseline',
      };

      let result: unknown;
      service.get(STORE_ID, 'INC-1').subscribe((r) => (result = r));

      const req = httpMock.expectOne((r) => r.url === `${BASE_URL}/INC-1`);
      expect(req.request.method).toBe('GET');
      req.flush({ incident: fixture });

      expect(result).toEqual({ kind: 'ok', data: fixture });
    });

    it('sends ?at= for a historical projection', () => {
      service.get(STORE_ID, 'INC-1', '2026-09-11T10:43:40Z').subscribe();

      const req = httpMock.expectOne((r) => r.url === `${BASE_URL}/INC-1`);
      expect(req.request.params.get('at')).toBe('2026-09-11T10:43:40Z');
      req.flush({ incident: INCIDENT });
    });

    it('reports "unavailable" on 404', () => {
      let result: unknown;
      service.get(STORE_ID, 'INC-1').subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === `${BASE_URL}/INC-1`)
        .flush('not found', { status: 404, statusText: 'Not Found' });

      expect(result).toEqual({
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      });
    });

    it('rejects a success response without an incident envelope', () => {
      let result: unknown;
      service.get(STORE_ID, 'INC-1').subscribe((r) => (result = r));

      httpMock.expectOne((r) => r.url === `${BASE_URL}/INC-1`).flush({});

      expect(result).toEqual({
        kind: 'error',
        message: 'Invalid incident response.',
      });
    });

    it('rejects a malformed incident inside a valid envelope', () => {
      let result: unknown;
      service.get(STORE_ID, 'INC-1').subscribe((r) => (result = r));

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
        ref: { storeId: STORE_ID, incidentId: 'INC-2' },
        title: 'Houston, we have a problem',
      };

      let result: unknown;
      service.create(CREATE_REQUEST).subscribe((r) => (result = r));

      const req = httpMock.expectOne((r) => r.url === BASE_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(CREATE_REQUEST);
      req.flush({ incident: fixture });

      expect(result).toEqual({ kind: 'ok', data: fixture });
    });

    it('reports "unavailable" on 404, keeping the caller free to retry with the same draft', () => {
      let result: unknown;
      service.create(CREATE_REQUEST).subscribe((r) => (result = r));

      httpMock
        .expectOne((r) => r.url === BASE_URL)
        .flush('not found', { status: 404, statusText: 'Not Found' });

      expect(result).toEqual({
        kind: 'unavailable',
        message: 'The incident store is not available on this server yet.',
      });
    });
  });
});
