import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IncidentClientService } from './incident-client.service';
import { IncidentDetail, IncidentSummary } from './models';

const STORE_ID = 'localhost:8989';
const BASE_URL = '//localhost:8989/datatug/incidents';

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
      const fixture: IncidentSummary[] = [
        { id: 'localhost:8989/INC-1', title: 'Checkout errors spike', status: 'open' },
      ];

      let result: unknown;
      service.list(STORE_ID).subscribe((r) => (result = r));

      const req = httpMock.expectOne((r) => r.url === BASE_URL);
      expect(req.request.method).toBe('GET');
      req.flush(fixture);

      expect(result).toEqual({ kind: 'ok', data: fixture });
    });

    it('sends repeated status filters as query params', () => {
      service
        .list(STORE_ID, { status: ['open', 'investigating'] })
        .subscribe();

      const req = httpMock.expectOne((r) => r.url === BASE_URL);
      expect(req.request.params.getAll('status')).toEqual([
        'open',
        'investigating',
      ]);
      req.flush([]);
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
  });

  describe('get', () => {
    it('GETs /datatug/incidents/{id}', () => {
      const fixture: IncidentDetail = {
        id: 'localhost:8989/INC-1',
        title: 'Checkout errors spike',
        status: 'open',
        description: '5xx rate above baseline',
      };

      let result: unknown;
      service.get(STORE_ID, 'INC-1').subscribe((r) => (result = r));

      const req = httpMock.expectOne((r) => r.url === `${BASE_URL}/INC-1`);
      expect(req.request.method).toBe('GET');
      req.flush(fixture);

      expect(result).toEqual({ kind: 'ok', data: fixture });
    });

    it('sends ?at= for a historical projection', () => {
      service.get(STORE_ID, 'INC-1', '2026-09-11T10:43:40Z').subscribe();

      const req = httpMock.expectOne(
        (r) => r.url === `${BASE_URL}/INC-1`,
      );
      expect(req.request.params.get('at')).toBe('2026-09-11T10:43:40Z');
      req.flush({});
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
  });

  describe('create', () => {
    it('POSTs the title/description to /datatug/incidents', () => {
      const fixture: IncidentDetail = {
        id: 'localhost:8989/INC-2',
        title: 'Houston, we have a problem',
        status: 'open',
      };

      let result: unknown;
      service
        .create(STORE_ID, { title: 'Houston, we have a problem' })
        .subscribe((r) => (result = r));

      const req = httpMock.expectOne((r) => r.url === BASE_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        title: 'Houston, we have a problem',
      });
      req.flush(fixture);

      expect(result).toEqual({ kind: 'ok', data: fixture });
    });

    it('reports "unavailable" on 404, keeping the caller free to retry with the same draft', () => {
      let result: unknown;
      service
        .create(STORE_ID, { title: 'Houston, we have a problem' })
        .subscribe((r) => (result = r));

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
