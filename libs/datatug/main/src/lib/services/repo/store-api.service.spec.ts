import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { StoreApiService } from './store-api.service';
import {
  datatugApiRealProviders,
  datatugApiTestBaseUrl,
  datatugApiTestToken,
} from '../base/datatug-api.test-helpers';

describe('StoreApiService DataTug API base URL', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StoreApiService, ...datatugApiRealProviders()],
    });
  });

  it('sends PUT through the DataTug API base URL', () => {
    TestBed.inject(StoreApiService).put('agent', 'projects/p', {}).subscribe();
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne(
      (req) =>
        req.method === 'PUT' && req.url.startsWith(datatugApiTestBaseUrl),
    );
    expect(request.request.headers.get('Authorization')).toBe(
      `Bearer ${datatugApiTestToken}`,
    );
    http.verify();
  });
});
