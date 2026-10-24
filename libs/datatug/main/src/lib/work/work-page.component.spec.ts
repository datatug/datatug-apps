import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  RouterLink,
  Router,
} from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { Firestore } from 'firebase/firestore';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { WorkPageComponent } from './work-page.component';
import { WorkApiService } from './work-api.service';
import { WorkPage } from './work.models';
import { workDetailFixture, workPageFixture } from './work.spec-helper';

describe('WorkPageComponent', () => {
  function setup(ionicProxy = false) {
    const params = new BehaviorSubject(
      convertToParamMap({
        storeId: 'firestore',
        spaceId: 'space',
        projectId: 'project',
      }),
    );
    const query = new BehaviorSubject(convertToParamMap({}));
    const auth = new BehaviorSubject({
      status: 'authenticated',
      user: { uid: 'lead' },
    });
    const route = {
      paramMap: params,
      queryParamMap: query,
      snapshot: { data: {}, queryParamMap: convertToParamMap({}) },
      pathFromRoot: [] as unknown[],
    };
    route.pathFromRoot = ionicProxy ? [] : [route];
    const api = {
      list: vi.fn(),
      read: vi.fn(),
      context: vi.fn(),
      action: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [WorkPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: Firestore, useValue: {} },
        { provide: WorkApiService, useValue: api },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: SneatUserService,
          useValue: { userState: of({ record: { spaces: { space: {} } } }) },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of({
              ref: {
                storeId: 'firestore',
                spaceID: 'space',
                projectId: 'project',
              },
              summary: { title: 'Operations' },
            }),
          },
        },
      ],
    });
    return {
      params,
      auth,
      api,
      fixture: TestBed.createComponent(WorkPageComponent),
    };
  }
  it('renders an asynchronous list without a second change detection call', async () => {
    const { fixture, api } = setup();
    let resolve!: (page: WorkPage) => void;
    api.list.mockReturnValue(new Promise<WorkPage>((r) => (resolve = r)));
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).toContain('Loading work'),
    );
    resolve(workPageFixture());
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).toContain(
        'Repair shipment allocation',
      ),
    );
    expect(fixture.nativeElement.textContent).toContain('Team Lead');
    expect(fixture.nativeElement.textContent).toContain('Developer');
  });
  it('uses inherited params exposed by an Ionic route proxy with no live ancestors', async () => {
    const { fixture, api } = setup(true);
    api.list.mockResolvedValue(workPageFixture());
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.scope()).toEqual({
      spaceID: 'space',
      projectID: 'project',
    });
    expect(fixture.componentInstance.rows()).toHaveLength(1);
  });
  it('clears held work immediately when the principal changes', async () => {
    const { fixture, api, auth } = setup();
    api.list.mockResolvedValue(workPageFixture());
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.rows()).toHaveLength(1);
    auth.next({ status: 'signedOut', user: { uid: '' } });
    expect(fixture.componentInstance.rows()).toHaveLength(0);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Sign in to Work');
  });
  it('ignores an old project response after navigation changes scope', async () => {
    const { fixture, api, params } = setup();
    let resolve!: (page: WorkPage) => void;
    api.list.mockReturnValueOnce(new Promise<WorkPage>((r) => (resolve = r)));
    fixture.detectChanges();
    await Promise.resolve();
    api.list.mockResolvedValue({ ...workPageFixture(), items: [] });
    params.next(
      convertToParamMap({
        storeId: 'firestore',
        spaceId: 'space',
        projectId: 'other',
      }),
    );
    await fixture.whenStable();
    resolve(workPageFixture());
    await fixture.whenStable();
    expect(fixture.componentInstance.rows()).toEqual([]);
  });
  it('keeps the canonical Context Bag operation ID on the HTTP mutation envelope', async () => {
    const { fixture, api } = setup();
    api.list.mockResolvedValue(workPageFixture());
    api.action.mockResolvedValue(workDetailFixture());
    api.context.mockRejectedValue({ status: 403 });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.detail.set(workDetailFixture());
    await fixture.componentInstance.contextCommand({
      action: 'renameBag',
      opId: 'same-operation',
      sessionId: 'session',
      expectedVersion: 1,
      bagId: 'bag',
      title: 'Order context',
    });
    expect(api.action.mock.calls[0][0]).toMatchObject({
      action: 'context',
      operationId: 'same-operation',
      contextCommand: { opId: 'same-operation' },
    });
  });
  it.each(['principal', 'route'] as const)(
    'clears sensitive overlay drafts synchronously on %s replacement',
    async (replacement) => {
      const { fixture, api, auth, params } = setup();
      api.list.mockResolvedValue(workPageFixture());
      fixture.detectChanges();
      await fixture.whenStable();
      const c = fixture.componentInstance;
      c.transitionOpen.set(true);
      c.linkOpen.set(true);
      c.summary.set('Sensitive investigation summary');
      c.comment.set('Private note');
      c.targetId.set('private-artifact');
      c.criteriaAccepted.set(true);
      c.selection.set([{ entryId: 'entry', revisionId: 'revision' }]);
      if (replacement === 'principal')
        auth.next({ status: 'authenticated', user: { uid: 'other' } });
      else
        params.next(
          convertToParamMap({
            storeId: 'firestore',
            spaceId: 'space',
            projectId: 'other',
          }),
        );
      expect(c.transitionOpen()).toBe(false);
      expect(c.linkOpen()).toBe(false);
      expect(c.summary()).toBe('');
      expect(c.comment()).toBe('');
      expect(c.targetId()).toBe('');
      expect(c.criteriaAccepted()).toBe(false);
      expect(c.selection()).toEqual([]);
    },
  );
  it('opens folder-qualified queries with their real query ID and environment', () => {
    const { fixture } = setup();
    const href = fixture.componentInstance.relatedHref({
      id: 'link',
      sourceId: 'task1',
      relation: 'reference',
      target: {
        kind: 'query',
        id: 'order-receipt',
        folder: 'shipping',
        environment: 'uat',
      },
      createdBy: 'lead',
      createdAt: '2026-10-23T12:00:00Z',
    });
    expect(href).toBe(
      '/space/space/store/firestore/project/project/query/shipping%2Forder-receipt?id=shipping%2Forder-receipt&environment=uat',
    );
  });
  it('purges a sensitive proposal preview after access is revoked during acceptance', async () => {
    const { fixture, api } = setup();
    api.list.mockResolvedValue(workPageFixture());
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    c.detail.set(workDetailFixture());
    c.proposalPreview.set([{ label: 'Private order', value: 'secret-value' }]);
    c.proposalReviewOpen.set(true);
    c.reviewedProposal.set('proposal');
    api.action.mockRejectedValue({ status: 403 });
    await c.acceptProposal('proposal');
    expect(c.proposalReviewOpen()).toBe(false);
    expect(c.proposalPreview()).toEqual([]);
    expect(c.reviewedProposal()).toBe('');
    expect(c.detail()).toBeUndefined();
    expect(c.error()).not.toBe('');
  });
  it('binds delegation as a URL tree so parent and type stay query parameters', async () => {
    const { fixture, api } = setup();
    api.list.mockResolvedValue(workPageFixture());
    fixture.detectChanges();
    await fixture.whenStable();
    const detail = workDetailFixture();
    detail.item = { ...detail.item, type: 'incident' };
    fixture.componentInstance.detail.set(detail);
    await fixture.whenStable();
    const link = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .find((element) =>
        element.nativeElement.textContent.includes('Delegate investigation'),
      );
    expect(link).toBeDefined();
    const tree = link?.injector.get(RouterLink).urlTree;
    if (!tree) throw new Error('Expected a delegation URL tree');
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe(
      '/space/space/store/firestore/project/project/work/new?type=case&parent=task1',
    );
  });
  it.each([409, 0])(
    'exposes recovery after a modal failure %s and retains the exact pending operation',
    async (status) => {
      const { fixture, api } = setup();
      api.list.mockResolvedValue(workPageFixture());
      fixture.detectChanges();
      await fixture.whenStable();
      const c = fixture.componentInstance;
      c.transitionOpen.set(true);
      c.linkOpen.set(true);
      c.proposalReviewOpen.set(true);
      c.summary.set('Retain this intent');
      c.notice.set('Saved.');
      api.action.mockRejectedValue({ status });
      await c.mutate({
        spaceID: 'space',
        projectID: 'project',
        itemId: 'task1',
        operationId: 'failed-modal',
        expectedVersion: 1,
        action: 'transition',
        status: 'closed',
        summary: 'Retain this intent',
      });
      await fixture.whenStable();
      expect(c.transitionOpen()).toBe(false);
      expect(c.linkOpen()).toBe(false);
      expect(c.proposalReviewOpen()).toBe(false);
      expect(c.pending()?.operationId).toBe('failed-modal');
      expect(c.summary()).toBe('Retain this intent');
      expect(c.error()).not.toBe('');
      expect(fixture.nativeElement.textContent).toContain(
        'Retry original change',
      );
    },
  );
  it('releases a known rejected migration-gated creation without suggesting a stale retry', async () => {
    const { fixture, api } = setup();
    api.list.mockResolvedValue(workPageFixture());
    fixture.detectChanges();
    await fixture.whenStable();
    api.action.mockRejectedValue({
      status: 409,
      error: { error: { code: 'work_migration_required' } },
    });
    await fixture.componentInstance.mutate({
      spaceID: 'space',
      projectID: 'project',
      operationId: 'migration-rejected',
      action: 'create',
      draft: { type: 'task', title: 'Existing project', priority: 'normal' },
    });
    expect(fixture.componentInstance.pending()).toBeUndefined();
    expect(fixture.componentInstance.error()).toContain(
      'complete the Work migration',
    );
  });
  it('labels inverse parent and blocking edges from the current item perspective', async () => {
    const { fixture, api, params } = setup();
    api.list.mockResolvedValue(workPageFixture());
    api.read.mockResolvedValue(workDetailFixture());
    api.context.mockRejectedValue({ status: 404 });
    fixture.detectChanges();
    await fixture.whenStable();
    params.next(
      convertToParamMap({
        storeId: 'firestore',
        spaceId: 'space',
        projectId: 'project',
        workItemId: 'task1',
      }),
    );
    await fixture.whenStable();
    const link = {
      id: 'relationship',
      sourceId: 'parent',
      relation: 'parent',
      target: { kind: 'work' as const, id: 'task1' },
      createdBy: 'lead',
      createdAt: '',
    };
    const detail = workDetailFixture();
    detail.relatedItems = [
      { id: 'parent', type: 'case', title: 'Investigate delayed shipment' },
    ];
    fixture.componentInstance.detail.set(detail);
    expect(fixture.componentInstance.relatedTitle(link)).toBe(
      'Investigate delayed shipment',
    );
    expect(fixture.componentInstance.relatedType(link)).toBe('Detective Case');
    expect(
      fixture.componentInstance.relatedTitle({
        ...link,
        sourceId: 'unavailable',
      }),
    ).toBe('unavailable');
    expect(fixture.componentInstance.relationLabel(link)).toBe('Parent');
    expect(
      fixture.componentInstance.relationLabel({ ...link, relation: 'blocks' }),
    ).toBe('Blocked by');
    expect(
      fixture.componentInstance.relationLabel({
        ...link,
        sourceId: 'task1',
        target: { kind: 'work', id: 'child' },
      }),
    ).toBe('Child');
    for (const relation of ['related', 'duplicates'])
      expect(
        fixture.componentInstance.relationLabel({ ...link, relation }),
      ).toBe(relation[0].toUpperCase() + relation.slice(1));
  });
  it('offers server-admitted Incident resolution without bypassing native proof checks', async () => {
    const { fixture, api } = setup();
    api.list.mockResolvedValue(workPageFixture());
    fixture.detectChanges();
    await fixture.whenStable();
    const detail = workDetailFixture();
    detail.item = { ...detail.item, type: 'incident' };
    detail.capabilities.transitions = ['resolved'];
    fixture.componentInstance.detail.set(detail);
    expect(fixture.componentInstance.availableStatuses()).toEqual(['resolved']);
  });
  it('omits resolution outcome for an active Incident transition', async () => {
    const { fixture, api } = setup();
    api.list.mockResolvedValue(workPageFixture());
    fixture.detectChanges();
    await fixture.whenStable();
    const detail = workDetailFixture();
    detail.item = { ...detail.item, type: 'incident' };
    const c = fixture.componentInstance;
    c.detail.set(detail);
    c.targetStatus.set('investigating');
    c.summary.set('Inspect actual evidence');
    api.action.mockResolvedValue(detail);
    api.context.mockRejectedValue({ status: 404 });
    await c.transition();
    expect(api.action.mock.calls[0][0]).toMatchObject({
      status: 'investigating',
      outcome: undefined,
    });
  });
  it('retries a frozen uncertain operation, not the edited draft', async () => {
    const { fixture, api } = setup();
    api.list.mockResolvedValue(workPageFixture());
    fixture.detectChanges();
    await fixture.whenStable();
    api.action
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce(workDetailFixture());
    api.context.mockRejectedValue({ status: 403 });
    const action = {
      spaceID: 'space',
      projectID: 'project',
      operationId: 'original',
      action: 'comment' as const,
      itemId: 'task1',
      expectedVersion: 1,
      comment: 'Original comment',
    };
    await fixture.componentInstance.mutate(action);
    action.comment = 'New draft';
    await fixture.componentInstance.retry();
    expect(api.action.mock.calls[1][0]).toMatchObject({
      operationId: 'original',
      comment: 'Original comment',
      expectedVersion: 1,
    });
  });
});
