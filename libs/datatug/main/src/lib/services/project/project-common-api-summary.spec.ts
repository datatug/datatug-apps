import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { SneatApiService } from '@sneat/api';
import {
  PrivateTokenStoreService,
  SneatAuthStateService,
} from '@sneat/auth-core';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject, Subject, firstValueFrom, of } from 'rxjs';
import { ProjectService } from './project.service';
import { ProjectQueryApiService } from './project-query-api.service';
import { DatatugStoreServiceFactory } from '../repo/datatug-store-service-factory.service';

it('keeps registered private summaries separate, cancels revoked auth, and refuses project_full fallback', async () => {
  const auth = new BehaviorSubject({
    status: 'authenticated',
    user: { uid: 'actor' },
  });
  const pending = new Subject<{
    id: string;
    title: string;
    access: 'protected';
  }>();
  const summary = vi.fn(() => pending);
  const getProjectSummary = vi.fn(() =>
    of({ id: 'public', title: 'Public', access: 'public' }),
  );
  const http = { get: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      ProjectService,
      { provide: ProjectQueryApiService, useValue: { summary } },
      { provide: SneatAuthStateService, useValue: { authState: auth } },
      { provide: PrivateTokenStoreService, useValue: {} },
      { provide: ErrorLogger, useValue: { logError: vi.fn() } },
      { provide: HttpClient, useValue: http },
      { provide: SneatApiService, useValue: {} },
      {
        provide: DatatugStoreServiceFactory,
        useValue: { getDatatugStoreService: () => ({ getProjectSummary }) },
      },
    ],
  });
  const service = TestBed.inject(ProjectService);
  const ref = {
    storeId: 'github.com',
    projectId: 'repo@owner@folder',
    projectApi: 'cloud' as const,
    branch: 'work',
  };
  const values: unknown[] = [];
  const subscription = service
    .watchProjectSummary(ref)
    .subscribe((value) => values.push(value));
  expect(values).toEqual([undefined]);
  pending.next({ id: ref.projectId, title: 'Private', access: 'protected' });
  expect(values.at(-1)).toMatchObject({ title: 'Private' });
  auth.next({ status: 'notAuthenticated', user: { uid: 'actor' } });
  pending.next({
    id: ref.projectId,
    title: 'Late private response',
    access: 'protected',
  });
  expect(values.at(-1)).toBeUndefined();
  expect(getProjectSummary).not.toHaveBeenCalled();
  expect(http.get).not.toHaveBeenCalled();
  await expect(firstValueFrom(service.getFull(ref))).rejects.toThrow(
    'unavailable',
  );
  subscription.unsubscribe();
});
