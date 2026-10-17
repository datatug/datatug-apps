import { TestBed } from '@angular/core/testing';
import { GithubConnectionService } from './github-connection.service';
import {
  datatugApiRealProviders,
  expectDatatugApiRequest,
} from '../../base/datatug-api.test-helpers';

describe('GithubConnectionService DataTug API base URL', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GithubConnectionService, ...datatugApiRealProviders()],
    });
  });

  it('lists App repositories from the DataTug API base URL', () => {
    TestBed.inject(GithubConnectionService).appRepositories().subscribe();
    expectDatatugApiRequest('GET', 'datatug/github/repositories');
  });
});
