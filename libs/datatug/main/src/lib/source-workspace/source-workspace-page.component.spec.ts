import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import { datatugRoutes } from '../routes/datatug-routing.module';
import {
  SOURCE_ADAPTER_REGISTRATIONS,
  type SourceAdapterRegistration,
  type SourceUiEvent,
  type SourceUiScope,
  type SourceWorkspaceView,
} from './source-workspace-contract';
import { SourceWorkspacePageComponent } from './source-workspace-page.component';

const context = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../detective/detective-page-context', () => ({
  useDetectivePageContext: () => context.current,
}));
const base = '/space/S1/store/firestore/project/p';
const ref = { storeId: 'firestore', spaceID: 'S1', projectId: 'p' };
// Independent neutral descriptor fixtures prove composition only, never a second backend.
function registration(sourceId: string, title: string) {
  const instances: {
    scope: SourceUiScope;
    signal: AbortSignal;
    view: ReturnType<typeof signal<SourceWorkspaceView>>;
    handle: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }[] = [];
  const adapter: SourceAdapterRegistration = {
    sourceId,
    create(scope, abort) {
      const view = signal<SourceWorkspaceView>({
        title,
        loading: false,
        busy: false,
        actions: [{ id: 'update', title: 'Review revision', enabled: true }],
        current: {
          title: 'Current revision',
          sections: [
            {
              title: 'State',
              facts: [
                { label: 'Revision', value: '17' },
                {
                  label: 'Accepted',
                  value: '2026-10-22T06:00:00Z',
                  kind: 'time',
                },
              ],
            },
          ],
        },
        activity: {
          heading: 'Revision activity',
          actionLabel: 'Activity',
          listLabel: 'Revisions',
          loadingMessage: 'Loading revisions…',
          emptyMessage: 'No revisions.',
          loading: false,
          enabled: true,
          items: [
            {
              id: 'r17',
              title: 'Revision recorded',
              outcome: 'Recorded',
              acceptedAt: '2026-10-22T06:00:00Z',
              openLabel: 'Open revision',
            },
          ],
        },
      });
      const handle = vi.fn((event: SourceUiEvent) => {
        if (event.type === 'prepare-action')
          view.update((v) => ({
            ...v,
            interaction: {
              reviewId: 'review17',
              actionId: event.actionId,
              title: 'Review revision',
              description: 'No source change before confirmation.',
              phase: 'review',
              fields: [
                {
                  id: 'revision',
                  label: 'Revision',
                  type: 'integer',
                  required: true,
                },
              ],
              submitLabel: 'Confirm revision',
              cancelLabel: 'Cancel',
              enabled: true,
            },
          }));
        if (event.type === 'cancel-review')
          view.update((v) => ({ ...v, interaction: undefined }));
        if (event.type === 'submit-action')
          view.update((v) => ({
            ...v,
            interaction: {
              ...requiredInteraction(v),
              phase: 'uncertain',
              retryLabel: 'Retry original revision',
            },
          }));
        if (event.type === 'open-activity')
          view.update((v) => ({
            ...v,
            details: {
              title: 'Original revision',
              summary: 'Historical record only.',
              sections: [
                {
                  title: 'Identity',
                  facts: [
                    { label: 'ID', value: event.itemId },
                    { label: 'Digest', value: 'a'.repeat(64), kind: 'hash' },
                  ],
                },
              ],
            },
          }));
        if (event.type === 'close-details')
          view.update((v) => ({ ...v, details: undefined }));
      });
      const instance = { scope, signal: abort, view, handle, destroy: vi.fn() };
      instances.push(instance);
      return instance;
    },
  };
  return { adapter, instances };
}
function requiredInteraction(view: SourceWorkspaceView) {
  if (!view.interaction) throw new Error('Missing review interaction');
  return view.interaction;
}
describe('neutral source host cold navigation and owner lifetimes', () => {
  const actor = signal('A'),
    project = signal(ref),
    environment = signal({ id: 'test' }),
    changes = new Subject<void>();
  let first: ReturnType<typeof registration>,
    second: ReturnType<typeof registration>;
  beforeEach(() => {
    actor.set('A');
    project.set(ref);
    environment.set({ id: 'test' });
    context.current = {
      ref: project,
      context: () => ({ principal: actor() }),
      identity: () => JSON.stringify([project(), actor()]),
      currentEnvironment: environment,
      scopeChanges$: changes,
    };
    first = registration('dataset-copy', 'Dataset copy');
    second = registration('document-archive', 'Document archive');
    TestBed.configureTestingModule({
      providers: [
        // Use the actual signed parent, its canMatch guard and actual children.
        provideRouter(
          datatugRoutes.filter((route) => route.path?.startsWith('space/')),
        ),
        {
          provide: SOURCE_ADAPTER_REGISTRATIONS,
          useValue: [first.adapter, second.adapter],
        },
      ],
    });
  });
  it('cold opens the actual neutral route with read-only registration creation and real project exit', async () => {
    const h = await RouterTestingHarness.create(),
      component = await h.navigateByUrl(
        `${base}/sources/dataset-copy?environment=test`,
        SourceWorkspacePageComponent,
      );
    await h.fixture.whenStable();
    expect(first.instances).toHaveLength(1);
    expect(first.instances[0].handle).not.toHaveBeenCalled();
    expect(first.instances[0].scope).toEqual({
      projectRef: ref,
      actor: 'A',
      identity: JSON.stringify([ref, 'A']),
      sourceId: 'dataset-copy',
      environment: 'test',
    });
    expect(h.routeNativeElement?.textContent).toContain('Dataset copy');
    expect(h.routeNativeElement?.querySelector('a')?.getAttribute('href')).toBe(
      `${base}/overview`,
    );
    const root = h.routeNativeElement;
    if (!root) throw new Error('Missing source host');
    root.querySelector<HTMLElement>('.source-actions ion-button')?.click();
    await h.fixture.whenStable();
    root
      .querySelector('ion-input')
      ?.dispatchEvent(
        new CustomEvent('ionInput', { detail: { value: '9007199254740993' } }),
      );
    root
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await h.fixture.whenStable();
    expect(first.instances[0].handle).toHaveBeenLastCalledWith({
      type: 'submit-action',
      actionId: 'update',
      values: { revision: { type: 'integer', value: '9007199254740993' } },
    });
    expect(root.textContent).toContain('Retry original revision');
    component.dispatch({ type: 'retry-original' });
    expect(first.instances[0].handle).toHaveBeenLastCalledWith({
      type: 'retry-original',
    });
    await h.navigateByUrl(
      `${base}/sources/document-archive?environment=test`,
      SourceWorkspacePageComponent,
    );
    expect(first.instances[0].signal.aborted).toBe(true);
    expect(first.instances[0].destroy).toHaveBeenCalledOnce();
  });
  it('uses the same composition for the second source and opens only current offered activity IDs', async () => {
    const h = await RouterTestingHarness.create(),
      component = await h.navigateByUrl(
        `${base}/sources/document-archive?environment=test`,
        SourceWorkspacePageComponent,
      );
    await h.fixture.whenStable();
    expect(h.routeNativeElement?.textContent).toContain('Document archive');
    expect(first.instances).toHaveLength(0);
    component.openActivity('foreign');
    expect(second.instances[0].handle).not.toHaveBeenCalled();
    h.routeNativeElement
      ?.querySelector<HTMLElement>('sneat-activity-list li ion-button')
      ?.click();
    await h.fixture.whenStable();
    expect(h.routeNativeElement?.textContent).toContain(
      'Historical record only.',
    );
    expect(h.routeNativeElement?.querySelector('.hash')?.textContent).toContain(
      'a'.repeat(64),
    );
    expect(h.routeNativeElement?.querySelector('ion-card')).toBeNull();
    component.dispatch({ type: 'close-details' });
    await h.fixture.whenStable();
    expect(h.routeNativeElement?.textContent).not.toContain(
      'Historical record only.',
    );
  });
  it.each([
    'account',
    'project',
    'environment',
    'ambient-environment',
    'source',
  ] as const)(
    'aborts and detaches the original controller on %s replacement even if old work ignores abort',
    async (change) => {
      const h = await RouterTestingHarness.create();
      await h.navigateByUrl(
        `${base}/sources/dataset-copy?environment=test`,
        SourceWorkspacePageComponent,
      );
      await h.fixture.whenStable();
      const old = first.instances[0];
      if (change === 'account') {
        actor.set('B');
        changes.next();
        expect(old.signal.aborted).toBe(true);
      }
      if (change === 'project') {
        project.set({ ...ref, projectId: 'other' });
        changes.next();
        expect(old.signal.aborted).toBe(true);
      }
      if (change === 'environment')
        await h.navigateByUrl(
          `${base}/sources/dataset-copy?environment=other`,
          SourceWorkspacePageComponent,
        );
      if (change === 'ambient-environment') environment.set({ id: 'other' });
      if (change === 'source')
        TestBed.inject(NativeSourceInvalidationService).invalidate({
          projectRef: ref,
          actor: 'A',
          sourceId: 'dataset-copy',
          action: 'reset',
        });
      await h.fixture.whenStable();
      expect(old.signal.aborted).toBe(true);
      expect(old.destroy).toHaveBeenCalledOnce();
      old.view.update((v) => ({
        ...v,
        title: 'Late protected stale response',
      }));
      await h.fixture.whenStable();
      expect(h.routeNativeElement?.textContent).not.toContain(
        'Late protected stale response',
      );
    },
  );
  it('keeps owner errors safe, blocks disabled/busy actions and cancels an unsent review explicitly', async () => {
    const h = await RouterTestingHarness.create(),
      component = await h.navigateByUrl(
        `${base}/sources/dataset-copy?environment=test`,
        SourceWorkspacePageComponent,
      );
    await h.fixture.whenStable();
    const instance = first.instances[0];
    instance.view.update((v) => ({ ...v, busy: true }));
    component.prepare('update');
    expect(instance.handle).not.toHaveBeenCalled();
    instance.view.update((v) => ({
      ...v,
      busy: false,
      actions: [{ id: 'update', title: 'Review revision', enabled: false }],
    }));
    component.prepare('update');
    expect(instance.handle).not.toHaveBeenCalled();
    instance.view.update((v) => ({
      ...v,
      actions: [{ id: 'update', title: 'Review revision', enabled: true }],
    }));
    component.prepare('update');
    await h.fixture.whenStable();
    h.routeNativeElement
      ?.querySelector<HTMLElement>('sneat-source-action-form header ion-button')
      ?.click();
    await h.fixture.whenStable();
    expect(instance.view().interaction).toBeUndefined();
    instance.handle.mockClear();
    component.dispatch({ type: 'retry-original' });
    expect(instance.handle).not.toHaveBeenCalled();
    instance.handle.mockImplementation(() => {
      throw new Error('protected provider diagnostic');
    });
    component.prepare('update');
    await h.fixture.whenStable();
    expect(h.routeNativeElement?.textContent).toContain(
      'The action could not be confirmed.',
    );
    expect(h.routeNativeElement?.textContent).not.toContain(
      'protected provider diagnostic',
    );
  });
  it.each([
    `${base}/sources`,
    `${base}/sources/dataset-copy/extra`,
    `${base}/sources/dataset.copy`,
    `${base}/sources/${'x'.repeat(129)}`,
    `${base}/sources/%2F`,
    `${base}/sources/dataset-copy;x=1`,
    `${base};x=1/sources/dataset-copy`,
    '/space/S1/store/github.com/project/p/sources/dataset-copy',
    '/space/%2F/store/firestore/project/p/sources/dataset-copy',
  ])(
    'rejects malformed production signed source route %s before adapter creation',
    async (url) => {
      const h = await RouterTestingHarness.create();
      await expect(h.navigateByUrl(url)).rejects.toThrow(
        /NG04002|Cannot match/,
      );
      expect(first.instances).toHaveLength(0);
      expect(second.instances).toHaveLength(0);
    },
  );
  it('shows unsupported registration as unavailable without a mutation or speculative default', async () => {
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(
      `${base}/sources/not-registered`,
      SourceWorkspacePageComponent,
    );
    await h.fixture.whenStable();
    expect(h.routeNativeElement?.textContent).toContain(
      'No unique source adapter',
    );
    expect(first.instances).toHaveLength(0);
    expect(second.instances).toHaveLength(0);
  });
});
