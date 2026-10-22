import { DatatugApiService } from '../services/base/datatug-api.service';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { ShippingSourceAdapterService } from './shipping-source-adapter.service';
import { ShippingApiService, type ShippingAck } from './shipping-api.service';
import {
  ShippingComponentApiService,
  SHIPPING_COMPONENT_COMMIT,
} from './shipping-component-api.service';
import { DetectiveClientService } from '../detective/detective-client.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { NativeSemanticApiService } from './native-semantic-api.service';
import { ProjectAssetsApiService } from '../services/project/project-assets-api.service';
import { RetainedEvidenceApiService } from '../evidence/retained-evidence-api.service';
import { RetainedEvidenceViewerComponent } from '../evidence/retained-evidence-viewer.component';
import { SourceWorkspacePageComponent } from '../source-workspace/source-workspace-page.component';
import { SourceEntriesComponent } from '../source-workspace/source-entries.component';
import {
  datatugRoutes,
  DatatugRoutingModule,
} from '../routes/datatug-routing.module';
import { SOURCE_ADAPTER_REGISTRATIONS } from '../source-workspace/source-workspace-contract';
import { SOURCE_ADAPTER_PROVIDERS } from '../routes/source-adapter-providers';
import { readSourceOperationHistory } from '../evidence/source-operation-contract';
import wire from '../evidence/testdata/source-operation.facade.go.json';
const context = vi.hoisted(() => ({ page: undefined as unknown }));
vi.mock('../detective/detective-page-context', () => ({
  useDetectivePageContext: () => context.page,
}));
@Component({
  selector: 'sneat-datatug-retained-evidence-viewer',
  template: 'Retained evidence selected',
})
class EvidenceSelectionFixture {
  readonly projectRef = input<unknown>();
  readonly environment = input('');
  readonly target = input<unknown>();
}
const ref = {
  storeId: 'firestore',
  spaceID: wire.request.spaceID,
  projectId: wire.request.projectId,
};
const actor = wire.request.reference.receiptActorId;
const base = `/space/${ref.spaceID}/store/firestore/project/${ref.projectId}`;
const revision = (n = 1) => ({
  generation: 'g1',
  revision: n,
  sha256: 'a'.repeat(64),
  configuration: 17,
  artifacts: [],
  fixtureCommit: 'fixture',
  fixtureSHA256: 'b'.repeat(64),
  schemaSHA256: 'c'.repeat(64),
  businessClock: '2018-05-20T10:00:00Z',
  bytes: 100,
  actorId: actor,
  acceptedAt: '2026-10-21T12:00:00Z',
});
describe('actual source adapter with neutral production route and owner discovery', () => {
  const changes = new Subject<string | undefined>(),
    api = {
      revision: vi.fn(),
      action: vi.fn(),
      publication: vi.fn(),
      publish: vi.fn(),
    },
    components = { current: vi.fn(), install: vi.fn() },
    detective = { state: vi.fn() },
    evidence = { sourceOperations: vi.fn() };
  const identity = () => JSON.stringify([ref, actor]);
  beforeEach(() => {
    sessionStorage.clear();
    context.page = {
      ref: signal(ref),
      identity,
      context: () => ({
        kind: 'cloud',
        storage: 'firestore',
        spaceID: ref.spaceID,
        project: ref.projectId,
        principal: actor,
      }),
      currentEnvironment: () => undefined,
      scopeChanges$: changes,
    };
    api.revision.mockReset().mockReturnValue(of(revision()));
    api.action.mockReset();
    api.publication.mockReset().mockReturnValue(of({ exists: false }));
    api.publish.mockReset();
    components.current.mockReset().mockReturnValue(
      of({
        available: {
          componentId: 'shipping-investigation',
          version: 1,
          digest: 'a'.repeat(64),
          sourceCommit: SHIPPING_COMPONENT_COMMIT,
        },
        exists: false,
      }),
    );
    components.install.mockReset();
    detective.state.mockReset().mockReturnValue(
      of({
        capabilities: { canRead: true, canWrite: true },
        environments: ['demo'],
      }),
    );
    evidence.sourceOperations.mockReset().mockResolvedValue(
      readSourceOperationHistory(wire.discovery, {
        projectRef: ref,
        environment: 'demo',
        actor,
      }),
    );
    TestBed.configureTestingModule({
      imports: [SourceEntriesComponent],
      providers: [
        provideRouter(
          datatugRoutes.filter((route) => route.path?.startsWith('space/')),
        ),
        ...SOURCE_ADAPTER_PROVIDERS,
        { provide: ShippingApiService, useValue: api },
        { provide: ShippingComponentApiService, useValue: components },
        { provide: DetectiveClientService, useValue: detective },
        {
          provide: DatatugNavContextService,
          useValue: { currentEnv: of(undefined) },
        },
        { provide: NativeSemanticApiService, useValue: {} },
        { provide: ProjectAssetsApiService, useValue: {} },
        { provide: RetainedEvidenceApiService, useValue: evidence },
      ],
    });
    TestBed.overrideComponent(SourceWorkspacePageComponent, {
      remove: { imports: [RetainedEvidenceViewerComponent] },
      add: { imports: [EvidenceSelectionFixture] },
    });
  });
  async function mount() {
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(
      `${base}/sources/shipping-working-copy?environment=demo`,
      SourceWorkspacePageComponent,
    );
    await h.fixture.whenStable();
    return h;
  }
  function click(h: RouterTestingHarness, text: string) {
    const button = Array.from(
      h.routeNativeElement?.querySelectorAll<HTMLElement>('ion-button') ?? [],
    ).find((item) => item.textContent?.trim() === text);
    if (!button) throw new Error('Missing actual action ' + text);
    button.click();
  }
  function submit(h: RouterTestingHarness) {
    const form = h.routeNativeElement?.querySelector(
      'sneat-source-action-form form',
    );
    if (!form) throw new Error('Missing review form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  }
  it('offers the source only after current read capability and strict owner metadata, with no creation/publication/install/discovery mutation', async () => {
    const f = TestBed.createComponent(SourceEntriesComponent);
    f.detectChanges();
    await f.whenStable();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).toContain('Shipping working copy'),
    );
    expect(f.nativeElement.querySelector('a')?.getAttribute('href')).toBe(
      `${base}/sources/shipping-working-copy`,
    );
    expect(api.action).not.toHaveBeenCalled();
    expect(api.publish).not.toHaveBeenCalled();
    expect(components.install).not.toHaveBeenCalled();
    expect(evidence.sourceOperations).not.toHaveBeenCalled();
    detective.state.mockReturnValue(
      of({
        capabilities: { canRead: false, canWrite: true },
        environments: ['demo'],
      }),
    );
    const adapter = TestBed.inject(ShippingSourceAdapterService),
      abort = new AbortController();
    expect(
      await adapter.registration.discover?.(
        {
          projectRef: ref,
          sourceId: 'shipping-working-copy',
          actor,
          identity: identity(),
        },
        abort.signal,
      ),
    ).toBeUndefined();
    components.current.mockReturnValue(
      throwError(() => new Error('private owner failure')),
    );
    const denied = TestBed.createComponent(SourceEntriesComponent);
    denied.detectChanges();
    await denied.whenStable();
    await vi.waitFor(() =>
      expect(denied.nativeElement.textContent).toContain('unavailable'),
    );
    expect(denied.nativeElement.querySelector('a')).toBeNull();
    expect(denied.nativeElement.textContent).toContain('unavailable');
    expect(denied.nativeElement.textContent).not.toContain(
      'private owner failure',
    );
  });
  it('uses explicit neutral review/cancel/replay input and exact original-intent retry, then refreshes authoritative state', async () => {
    const h = await mount();
    expect(api.action).not.toHaveBeenCalled();
    expect(components.install).not.toHaveBeenCalled();
    click(h, 'Correct routing configuration');
    await h.fixture.whenStable();
    expect(api.action).not.toHaveBeenCalled();
    click(h, 'Cancel');
    await h.fixture.whenStable();
    expect(api.action).not.toHaveBeenCalled();
    click(h, 'Replay selected order');
    await h.fixture.whenStable();
    submit(h);
    await h.fixture.whenStable();
    expect(api.action).not.toHaveBeenCalled();
    h.routeNativeElement
      ?.querySelector('sneat-source-action-form ion-select')
      ?.dispatchEvent(
        new CustomEvent('ionChange', { detail: { value: '11062' } }),
      );
    api.action.mockReturnValueOnce(throwError(() => new Error('lost reply')));
    submit(h);
    await h.fixture.whenStable();
    const original = api.action.mock.calls[0][1];
    expect(original).toMatchObject({
      action: 'replay',
      orderId: 11062,
      expected: { generation: 'g1', revision: 1 },
    });
    expect(h.routeNativeElement?.textContent).toContain(
      'Retry original operation',
    );
    api.revision.mockReturnValue(of(revision(4)));
    api.action.mockReturnValueOnce(of({} as ShippingAck));
    click(h, 'Retry original operation');
    await h.fixture.whenStable();
    expect(api.action.mock.calls[1][1]).toEqual(original);
    await vi.waitFor(() =>
      expect(h.routeNativeElement?.textContent).toContain('4'),
    );
    expect(api.publish).not.toHaveBeenCalled();
    expect(components.install).not.toHaveBeenCalled();
    expect(
      h.routeNativeElement?.querySelector(
        'sneat-datatug-shipping-query-access',
      ),
    ).toBeNull();
    expect(
      h.routeNativeElement?.querySelector('sneat-shipping-component-installer'),
    ).toBeNull();
  });
  it('lets the actual API acknowledgement retire its journal even when its synchronous invalidation clears source reads', async () => {
    let current = revision();
    const transport = {
      get: vi.fn((path: string) =>
        of(path.endsWith('/publication') ? { exists: false } : current),
      ),
      post: vi.fn(
        (_path: string, intent: { operationId: string; action: string }) => {
          current = revision(2);
          return of({
            receipt: {
              operationId: intent.operationId,
              actorId: actor,
              action: intent.action,
              outcome: 'applied',
              revision: current,
              acceptedAt: '2026-10-21T12:00:00Z',
              requestSHA256: 'e'.repeat(64),
            },
            current,
          });
        },
      ),
    };
    TestBed.overrideProvider(ShippingApiService, {
      useFactory: () => new ShippingApiService(),
    });
    TestBed.overrideProvider(DatatugApiService, { useValue: transport });
    const adapter = TestBed.inject(ShippingSourceAdapterService),
      created = vi.spyOn(adapter, 'create');
    const h = await mount();
    click(h, 'Correct routing configuration');
    await h.fixture.whenStable();
    submit(h);
    await vi.waitFor(() =>
      expect(sessionStorage.getItem('datatug.shipping.intent.v1')).toBeNull(),
    );
    await vi.waitFor(() =>
      expect(h.routeNativeElement?.textContent).toMatch(/Revision\s*2/),
    );
    expect(created).toHaveBeenCalledOnce();
    expect(transport.post).toHaveBeenCalledOnce();
    expect(h.routeNativeElement?.textContent).not.toContain(
      'Retry original operation',
    );
  });
  it('rejects a review after source movement and clears retained source presentation after current read denial', async () => {
    const h = await mount();
    click(h, 'Correct routing configuration');
    await h.fixture.whenStable();
    api.revision.mockReturnValue(of(revision(2)));
    click(h, 'Refresh');
    await vi.waitFor(() =>
      expect(h.routeNativeElement?.textContent).toMatch(/Revision\s*2/),
    );
    submit(h);
    await h.fixture.whenStable();
    expect(api.action).not.toHaveBeenCalled();
    expect(h.routeNativeElement?.textContent).toContain('Source state changed');
    click(h, 'Activity');
    await h.fixture.whenStable();
    click(h, 'Open receipt');
    await h.fixture.whenStable();
    expect(h.routeNativeElement?.textContent).toContain(
      'Retained evidence selected',
    );
    api.revision.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    click(h, 'Refresh');
    await vi.waitFor(() =>
      expect(h.routeNativeElement?.textContent).not.toContain(
        'Retained evidence selected',
      ),
    );
    expect(h.routeNativeElement?.textContent).not.toContain(
      'Routing configuration17',
    );
    expect(
      h.routeNativeElement?.querySelector('.source-actions ion-button'),
    ).toBeNull();
    expect(
      h.routeNativeElement?.querySelector('sneat-native-semantic-browser'),
    ).toBeNull();
  });
  it('opens only explicitly discovered actual Go receipt refs through existing retained evidence composition', async () => {
    const h = await mount();
    expect(evidence.sourceOperations).not.toHaveBeenCalled();
    click(h, 'Activity');
    await h.fixture.whenStable();
    expect(evidence.sourceOperations).toHaveBeenCalledOnce();
    expect(h.routeNativeElement?.textContent).toContain('No new change');
    click(h, 'Open receipt');
    await h.fixture.whenStable();
    expect(h.routeNativeElement?.textContent).toContain(
      'Retained evidence selected',
    );
    click(h, 'Close evidence');
    await h.fixture.whenStable();
    expect(h.routeNativeElement?.textContent).not.toContain(
      'Retained evidence selected',
    );
    expect(api.action).not.toHaveBeenCalled();
  });
});

describe('production module adapter composition', () => {
  it('provides the deployment registration through the actual lazy feature module', () => {
    const registration = { sourceId: 'fixture', create: vi.fn() };
    TestBed.configureTestingModule({
      imports: [DatatugRoutingModule],
      providers: [
        { provide: ShippingSourceAdapterService, useValue: { registration } },
      ],
    });
    expect(TestBed.inject(SOURCE_ADAPTER_REGISTRATIONS)).toEqual([
      registration,
    ]);
    expect(registration.create).not.toHaveBeenCalled();
  });
});
