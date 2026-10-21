import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { QuickSearchPageComponent } from './quick-search-page.component';
import { QuickSearchApiService } from './quick-search-api.service';
import { QuickSearchSnapshotService } from './quick-search-snapshot.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { SearchDocument } from './quick-search-model';

const check = (id: string): SearchDocument => ({
  kind: 'check',
  id,
  name: 'Check ' + id,
  tags: ['customers'],
  reference: { objectId: id },
});
function setup(
  queryString = 'detailKind=check&objectId=a',
  publicScope = false,
) {
  const query = new BehaviorSubject(
    convertToParamMap(Object.fromEntries(new URLSearchParams(queryString))),
  );
  const ref = {
    storeId: 'github.com',
    projectId: 'repo@owner@folder',
    ...(publicScope ? {} : { projectApi: 'cloud' as const, branch: 'main' }),
  };
  const project = new BehaviorSubject({ ref }),
    environment = new BehaviorSubject<{ id: string } | undefined>(undefined),
    auth = new BehaviorSubject({
      status: 'authenticated',
      user: { uid: 'first' },
    });
  const api = {
    status: vi.fn(() =>
      of({
        state: 'ready',
        eligible: true,
        audience: publicScope ? 'public' : 'private',
        canManage: true,
      }),
    ),
    preview: vi.fn(() =>
      of({
        documents: [check('a'), check('b'), { ...check('a'), kind: 'table' }],
        sourceCoverage: [],
      }),
    ),
    search: vi.fn(),
    enable: vi.fn(),
    refresh: vi.fn(),
    disable: vi.fn(),
  };
  const publicCheckMetadata = vi.fn(async () => check('a'));
  TestBed.configureTestingModule({
    imports: [QuickSearchPageComponent],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            data: {},
            paramMap: convertToParamMap({}),
            queryParamMap: query.value,
          },
          queryParamMap: query,
        },
      },
      { provide: SneatAuthStateService, useValue: { authState: auth } },
      {
        provide: DatatugNavContextService,
        useValue: { currentProject: project, currentEnv: environment },
      },
      { provide: QuickSearchApiService, useValue: api },
      {
        provide: QuickSearchSnapshotService,
        useValue: { publicCheckMetadata, preview: vi.fn() },
      },
    ],
  });
  return { query, project, environment, auth, api, publicCheckMetadata };
}
describe('typed Check metadata mode', () => {
  it('filters the exact canonical kind and object reference and updates on same-route A to B navigation', async () => {
    const { query, api, publicCheckMetadata } = setup();
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    await fixture.whenStable();
    expect(page.items()).toEqual([check('a')]);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Check metadata');
    expect(text).toContain('customers');
    for (const absent of [
      'Index settings',
      'Run check',
      'Search project names and tags',
    ])
      expect(text).not.toContain(absent);
    query.next(convertToParamMap({ detailKind: 'check', objectId: 'b' }));
    await fixture.whenStable();
    expect(page.items()).toEqual([check('b')]);
    expect(publicCheckMetadata).not.toHaveBeenCalled();
    expect(api.search).not.toHaveBeenCalled();
    page.enable();
    page.refresh();
    page.disable();
    expect(api.enable).not.toHaveBeenCalled();
    expect(api.refresh).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });
  it('does not turn an invalid metadata query into a normal search', async () => {
    const { api, publicCheckMetadata } = setup(
      'detailKind=table&objectId=a&q=secret',
    );
    const fixture = TestBed.createComponent(QuickSearchPageComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance.error()).toBe(
      'Invalid Check metadata link.',
    );
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.search).not.toHaveBeenCalled();
    expect(publicCheckMetadata).not.toHaveBeenCalled();
  });
  it('never falls back to browser metadata after private preview denial', async () => {
    const { api, publicCheckMetadata } = setup();
    api.preview.mockReturnValue(throwError(() => ({ status: 403 })));
    const fixture = TestBed.createComponent(QuickSearchPageComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance.items()).toEqual([]);
    expect(fixture.componentInstance.error()).toContain(
      'Could not read this Check',
    );
    expect(publicCheckMetadata).not.toHaveBeenCalled();
  });
  it('uses the public read-only metadata path without an anonymous API preview attempt', async () => {
    const { api, publicCheckMetadata } = setup(undefined, true);
    const fixture = TestBed.createComponent(QuickSearchPageComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance.items()).toEqual([check('a')]);
    expect(publicCheckMetadata).toHaveBeenCalledOnce();
    expect(api.preview).not.toHaveBeenCalled();
  });
  it.each(['actor', 'project', 'environment', 'target'])(
    'discards delayed metadata after %s changes',
    async (change) => {
      const { api, query, auth, project, environment } = setup();
      const pending = new Subject<{
        documents: SearchDocument[];
        sourceCoverage: never[];
      }>();
      api.preview
        .mockReturnValueOnce(pending as never)
        .mockReturnValue(of({ documents: [], sourceCoverage: [] }));
      const fixture = TestBed.createComponent(QuickSearchPageComponent);
      await fixture.whenStable();
      if (change === 'actor')
        auth.next({ status: 'authenticated', user: { uid: 'second' } });
      if (change === 'project')
        project.next({
          ref: {
            storeId: 'github.com',
            projectId: 'other@owner@',
            projectApi: 'cloud',
            branch: 'main',
          },
        });
      if (change === 'environment') environment.next({ id: 'other' });
      if (change === 'target')
        query.next(convertToParamMap({ detailKind: 'check', objectId: 'b' }));
      pending.next({ documents: [check('a')], sourceCoverage: [] });
      pending.complete();
      await fixture.whenStable();
      expect(fixture.componentInstance.items()).toEqual([]);
      expect(fixture.componentInstance.snapshot()).toBeUndefined();
      expect(fixture.componentInstance.consent()).toBe(false);
    },
  );
});
