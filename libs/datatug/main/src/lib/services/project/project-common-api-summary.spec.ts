import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { DatatugApiService } from '../base/datatug-api.service';
import {
  PrivateTokenStoreService,
  SneatAuthStateService,
} from '@sneat/auth-core';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject, Subject, firstValueFrom, of } from 'rxjs';
import { ProjectEnvironmentStateService } from './project-environment-state.service';
import { EnvironmentState } from '../../models/definition/environment-state';
import { ProjectService } from './project.service';
import { ProjectQueryApiService } from './project-query-api.service';
import { DatatugStoreServiceFactory } from '../repo/datatug-store-service-factory.service';

it('keeps registered private summaries separate, cancels revoked auth, and refuses project_full fallback', async () => {
  const auth = new BehaviorSubject({
    status: 'authenticated',
    user: { uid: 'actor' },
  });
  let pending = new Subject<{
    id: string;
    title: string;
    access: 'protected';
  }>();
  const summary = vi.fn(() => pending);
  let environmentRead = new Subject<EnvironmentState>();
  const environmentState = vi.fn(() => environmentRead);
  const getProjectSummary = vi.fn(() =>
    of({ id: 'public', title: 'Public', access: 'public' }),
  );
  const http = { get: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      ProjectService,
      { provide: ProjectQueryApiService, useValue: { summary, environmentState, environmentReference: (ref: unknown) => ref } },
      { provide: SneatAuthStateService, useValue: { authState: auth } },
      { provide: PrivateTokenStoreService, useValue: {} },
      { provide: ErrorLogger, useValue: { logError: vi.fn() } },
      { provide: HttpClient, useValue: http },
      { provide: DatatugApiService, useValue: {} },
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
  expect((values.at(-1) as { environments?: unknown }).environments).toBeUndefined();
  const state: EnvironmentState = {
    contract: 'environment-state/1', scope: { ...ref, authorityId: 'private' },
    scopeBinding: 'a'.repeat(64), revision: 'r1',
    environments: [{ id: 'local', title: 'Local' }, { id: 'prod', title: 'Prod' }],
    savedOrder: ['prod', 'local'], order: ['prod', 'local'], needsRepair: false,
    capabilities: { canReadOrder: true, canWriteOrder: false, canCreateEnvironment: false },
  };
  environmentRead.next(state);
  expect((values.at(-1) as { environments: { id: string }[] }).environments.map(e => e.id)).toEqual(['prod', 'local']);
  environmentRead.error({ status: 403 });
  expect(values.at(-1)).toMatchObject({ title: 'Private' });
  expect((values.at(-1) as { environments?: unknown }).environments).toBeUndefined();
  environmentRead = new Subject<EnvironmentState>();
  TestBed.inject(ProjectEnvironmentStateService).changed(ref);
  expect(environmentState).toHaveBeenCalledTimes(2);
  expect((values.at(-1) as { environments?: unknown }).environments).toBeUndefined();
  environmentRead.next({ ...state, revision: 'r2', environments: [], savedOrder: [], order: [] });
  expect((values.at(-1) as { environments?: unknown }).environments).toEqual([]);
  expect(values.at(-1)).toMatchObject({ title: 'Private' });
  const revokedRead = environmentRead;
  auth.next({ status: 'notAuthenticated', user: { uid: 'actor' } });
  pending.next({
    id: ref.projectId,
    title: 'Late private response',
    access: 'protected',
  });
  revokedRead.next(state);
  expect(values.at(-1)).toBeUndefined();
  const priorMetadata = pending;
  pending = new Subject<{ id: string; title: string; access: 'protected' }>();
  environmentRead = new Subject<EnvironmentState>();
  auth.next({ status: 'authenticated', user: { uid: 'bob' } });
  expect(values.at(-1)).toBeUndefined();
  priorMetadata.next({ id: ref.projectId, title: 'Late actor title', access: 'protected' });
  revokedRead.next(state);
  expect(values.at(-1)).toBeUndefined();
  pending.next({ id: ref.projectId, title: 'Bob title', access: 'protected' });
  expect(values.at(-1)).toMatchObject({ title: 'Bob title' });
  expect((values.at(-1) as { environments?: unknown }).environments).toBeUndefined();
  environmentRead.next({ ...state, revision: 'bob', environments: [{ id: 'bob', title: 'Bob environment' }], savedOrder: ['bob'], order: ['bob'] });
  expect((values.at(-1) as { environments: { id: string }[] }).environments.map(e => e.id)).toEqual(['bob']);
  expect(getProjectSummary).not.toHaveBeenCalled();
  expect(http.get).not.toHaveBeenCalled();
  await expect(firstValueFrom(service.getFull(ref))).rejects.toThrow(
    'unavailable',
  );
  subscription.unsubscribe();
});
