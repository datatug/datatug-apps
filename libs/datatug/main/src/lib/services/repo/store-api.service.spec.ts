import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { StoreApiService } from './store-api.service';
import { datatugApiRealProviders } from '../base/datatug-api.test-helpers';

describe('StoreApiService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StoreApiService, ...datatugApiRealProviders()],
    });
  });

  it('sends PUT to the agent URL as built, without the DataTug API base URL or a Bearer token', () => {
    TestBed.inject(StoreApiService)
      .put('localhost:8989', 'projects/p', { title: 't' })
      .subscribe();
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne('//localhost:8989/datatug/projects/p');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ title: 't' });
    expect(request.request.headers.has('Authorization')).toBe(false);
    http.verify();
  });
});
