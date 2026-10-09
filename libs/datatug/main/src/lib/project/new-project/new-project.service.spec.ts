import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ErrorLogger } from '@sneat/core';

import {
  NewProjectService,
  safeNewProjectReturnUrl,
} from './new-project.service';

describe('NewProjectService', () => {
  let service: NewProjectService;
  const navigate = vi.fn(() => Promise.resolve(true));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NewProjectService,
        { provide: Router, useValue: { url: '/store/firestore', navigate } },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
      ],
    });
    service = TestBed.inject(NewProjectService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('navigates to a route with only the optional store and a safe return path', () => {
    service.navigateToNewProjectPage('github', '/store/github.com?code=secret');
    expect(navigate).toHaveBeenCalledWith(['/new-project'], {
      queryParams: { store: 'github', returnUrl: '/store/github.com' },
    });
  });

  it.each([
    ['https://evil.example', '/'],
    ['//evil.example/path', '/'],
    ['/new-project?returnUrl=/new-project', '/'],
    ['/store/firestore?code=secret#fragment', '/store/firestore'],
  ])('validates return URL %s to %s', (value, expected) => {
    expect(safeNewProjectReturnUrl(value)).toBe(expected);
  });
});
