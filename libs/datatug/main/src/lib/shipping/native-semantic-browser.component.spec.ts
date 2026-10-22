import { webcrypto } from 'node:crypto';
import { Component, input, output, signal, EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { SemanticBrowserComponent } from '../semantic-browser/semantic-browser.component';
import { NativeSemanticBrowserController } from './native-semantic-browser.controller';
import preflightFixture from './testdata/native-check-applicable.go.json';
import { NativeSemanticApiService } from './native-semantic-api.service';
import { ProjectAssetsApiService } from '../services/project/project-assets-api.service';
import { DetectiveClientService } from '../detective/detective-client.service';
import {
  EvidenceSharePanelComponent,
  EvidenceShareSelection,
} from '../evidence/evidence-share-panel.component';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import {
  mappingJournalKey,
  NativeMapping,
  encodeMappingJournal,
} from './native-semantic-contract';
const page = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../detective/detective-page-context', () => ({
  useDetectivePageContext: () => page.current,
}));
@Component({ selector: 'sneat-datatug-evidence-share-panel', template: '' })
class ContextPicker {
  readonly mode = input('');
  readonly sourceId = input<string>();
  readonly environment = input('');
  readonly caseId = input<string>();
  readonly disabled = input(false);
  readonly selected = output<EvidenceShareSelection | undefined>();
}
const token = 'a'.repeat(64),
  rowToken = 'b'.repeat(64),
  revision = 'entity1-' + 'c'.repeat(64);
const entity = {
  id: 'ShippingRequest',
  fields: [
    {
      id: 'id',
      type: 'string',
      mappings: [
        {
          source: 'shipping-working-copy',
          collection: 'requests',
          column: 'request_id',
        },
      ],
    },
  ],
};
const schema = {
  schemaToken: token,
  source: {
    sourceId: 'shipping-working-copy',
    environment: 'demo',
    generation: 'g1',
    revision: 1,
    sha256: 'd'.repeat(64),
    bindingRevision: 1,
    schemaSHA256: 'e'.repeat(64),
  },
  collections: [
    {
      name: 'current_routes',
      kind: 'view',
      columns: [{ name: 'request_id', type: 'TEXT', nullable: false }],
      foreignKeys: [],
    },
  ],
};
const rows = {
  schemaToken: token,
  collection: 'current_routes',
  columns: schema.collections[0].columns,
  rows: [{ rowToken, cells: [{ type: 'string', value: 'request-11045' }] }],
  truncated: false,
};
describe('Native physical inspection and durable mapping DOM', () => {
  const actor = signal('sarah'),
    ref = { storeId: 'firestore', spaceID: 'space', projectId: 'training' },
    changes = new Subject<string | undefined>(),
    query = new BehaviorSubject(convertToParamMap({}));
  const identity = () => JSON.stringify([actor(), ref]);
  const scope = () =>
    JSON.stringify([
      actor(),
      'firestore',
      'space',
      'training',
      'demo',
      'shipping-working-copy',
    ]);
  const api = {
    schema: vi.fn(),
    browse: vi.fn(),
    resolve: vi.fn(),
    related: vi.fn(),
    relatedRows: vi.fn(),
    addMapping: vi.fn(),
    applicable: vi.fn(),
  };
  const assets = { entities: vi.fn(), entity: vi.fn() };
  const detective = { linkedIncidents: vi.fn() };
  const choice = (): EvidenceShareSelection => ({
    identity: identity(),
    environment: 'demo',
    choice: {
      value: { type: 'integer', value: '11045' },
      bagId: 'bag-order',
      label: 'Applied order 11045',
      evidence: {
        retention: 'project-pinned',
        incidentRef: 'detective-incidents/incident-order',
        context: {
          sessionId: 'session-order',
          expectedSessionVersion: 3,
          expectedContextSetId: 'applied-order',
          scope: { environmentId: 'demo', identityDomain: 'domain' },
          bindings: [
            { inputName: 'order_id', entryId: 'order', revisionId: 'order-r1' },
          ],
        },
      },
    },
  });
  beforeEach(() => {
    sessionStorage.clear();
    actor.set('sarah');
    query.next(convertToParamMap({}));
    vi.stubGlobal('crypto', webcrypto);
    page.current = {
      ref: () => ref,
      context: () => ({ kind: 'cloud', principal: actor() }),
      identity,
      scopeChanges$: changes,
    };
    Object.values(api).forEach((f) => f.mockReset());
    Object.values(assets).forEach((f) => f.mockReset());
    detective.linkedIncidents.mockReset();
    api.schema.mockResolvedValue(schema);
    api.applicable.mockResolvedValue(preflightFixture.response);
    api.browse.mockResolvedValue(rows);
    api.resolve.mockResolvedValue({
      column: 'request_id',
      value: { type: 'string', value: 'request-11045' },
    });
    api.related.mockResolvedValue({
      selection: {
        schemaToken: token,
        collection: 'current_routes',
        rowToken,
        column: 'request_id',
      },
      lookups: [],
      unsupported: [],
    });
    api.addMapping.mockRejectedValue(new Error('Delivery unknown'));
    assets.entities.mockReturnValue(of([{ id: 'ShippingRequest' }]));
    assets.entity.mockReturnValue(of({ entity, revision }));
    TestBed.configureTestingModule({
      imports: [SemanticBrowserComponent],
      providers: [
        provideRouter([]),
        { provide: NativeSemanticApiService, useValue: api },
        { provide: ProjectAssetsApiService, useValue: assets },
        { provide: DetectiveClientService, useValue: detective },
        { provide: ActivatedRoute, useValue: { queryParamMap: query } },
      ],
    });
    TestBed.overrideComponent(SemanticBrowserComponent, {
      remove: { imports: [EvidenceSharePanelComponent] },
      add: { imports: [ContextPicker] },
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  async function mount() {
    const f = TestBed.createComponent(SemanticBrowserComponent);
    const child = createEnvironmentInjector([NativeSemanticBrowserController], TestBed.inject(EnvironmentInjector));
    const controller = child.get(NativeSemanticBrowserController);
    f.componentRef.onDestroy(() => child.destroy());
    controller.environments.set(['demo']);
    controller.canWrite.set(true);
    f.componentRef.setInput('model', controller);
    f.detectChanges();
    await f.whenStable();
    controller.changeEnvironment('demo');
    f.detectChanges();
    await f.whenStable();
    await vi.waitFor(() => expect(controller.restoring()).toBe(false));
    return {
      componentInstance: controller,
      nativeElement: f.nativeElement as HTMLElement,
      detectChanges: () => f.detectChanges(),
      whenStable: () => f.whenStable(),
      destroy: () => f.destroy(),
      componentRef: { setInput: (key: 'environments' | 'canWrite', value: unknown) => {
        if (key === 'environments') controller.environments.set(value as readonly string[]);
        else controller.canWrite.set(value as boolean);
      } },
    };
  }
  async function inspect(f: Awaited<ReturnType<typeof mount>>) {
    await f.componentInstance.chooseContext(choice());
    await f.componentInstance.inspect('current_routes');
    await f.componentInstance.selectCell(0, 0);
    await f.whenStable();
  }
  async function prepare(f: Awaited<ReturnType<typeof mount>>) {
    await inspect(f);
    await f.componentInstance.openPicker();
    await f.componentInstance.chooseEntity('ShippingRequest');
    f.componentInstance.fieldId.set('id');
  }
  it('cold entry performs no initialization or read until actual context is selected; renders actual keyless table and missing mapping', async () => {
    const f = await mount();
    expect(api.schema).not.toHaveBeenCalled();
    expect(api.browse).not.toHaveBeenCalled();
    await inspect(f);
    expect(f.nativeElement.textContent).toContain('Mapping missing');
    expect(f.nativeElement.textContent).toContain('request-11045');
    expect(f.nativeElement.textContent).toContain('no declared primary key');
    expect(f.nativeElement.textContent).toContain('Applicable Checks');
    expect(api.addMapping).not.toHaveBeenCalled();
  });
  it('finds checks only on explicit action and renders asynchronous binding-only labels plus ordinary environment-preserving links', async () => {
    const f = await mount();
    await inspect(f);
    expect(api.applicable).not.toHaveBeenCalled();
    let finish: (v: unknown) => void = () => undefined;
    api.applicable.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const button = Array.from(
      f.nativeElement.querySelectorAll('ion-button'),
    ).find((el) =>
      (el as HTMLElement).textContent?.includes('Find checks'),
    ) as HTMLElement;
    button.click();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain(
      'Finding checks for the current selection',
    );
    expect(api.applicable).toHaveBeenCalledOnce();
    expect(api.applicable.mock.calls[0][0]).toMatchObject({
      spaceID: 'space',
      projectId: 'training',
      environment: 'demo',
      sourceId: 'shipping-working-copy',
      selection: { rowToken, column: 'request_id' },
      evidence: choice().choice.evidence,
    });
    finish(preflightFixture.response);
    await vi.waitFor(() =>
      expect(f.componentInstance.checksPending()).toBe(false),
    );
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('Request received');
    expect(f.nativeElement.textContent).toContain('Inputs ready');
    expect(f.nativeElement.textContent).toContain('Needs input');
    expect(f.nativeElement.textContent).toContain('Needs row data');
    const open = Array.from(
      f.nativeElement.querySelectorAll('ion-button'),
    ).find((el) =>
      (el as HTMLElement).textContent?.includes('Open Check'),
    ) as HTMLElement;
    expect(open.getAttribute('href')).toContain(
      '/checks/preflight-need-range?environment=demo',
    );
    expect(open.getAttribute('href')).not.toContain('11045');
    expect(f.nativeElement.querySelector('[color="success"]')).toBeNull();
    expect(f.nativeElement.textContent).not.toContain('Run Check');
  });
  it('retires Check binding proof when a mapping save begins, including uncertain delivery', async () => {
    const f = await mount();
    await prepare(f);
    await f.componentInstance.findChecks();
    expect(f.componentInstance.applicable()?.checks.length).toBe(5);
    await f.componentInstance.save();
    expect(f.componentInstance.pending()).toBeDefined();
    expect(f.componentInstance.applicable()).toBeUndefined();
  });
  it('rejects an immediate stale response before reactive cancellation has run', async () => {
    const f = await mount();
    await inspect(f);
    let finish: (v: unknown) => void = () => undefined;
    api.applicable.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.componentInstance.findChecks();
    f.componentInstance.selected.set({
      schemaToken: token,
      collection: 'current_routes',
      column: 'other_column',
      rowToken,
    });
    finish(preflightFixture.response);
    await pending;
    expect(f.componentInstance.applicable()).toBeUndefined();
  });
  it('shows empty, unavailable and error states without hiding the current cell', async () => {
    const f = await mount();
    await inspect(f);
    api.applicable.mockResolvedValue({ queries: [], checks: [] });
    await f.componentInstance.findChecks();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain(
      'No applicable Checks were offered',
    );
    api.applicable.mockResolvedValue({
      queries: [],
      checks: [
        {
          ...preflightFixture.response.checks[0],
          preflight: {
            state: 'invalid/unavailable-definition',
            checkId: 'child',
          },
        },
      ],
    });
    await f.componentInstance.findChecks();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain(
      'The saved definition or its dependencies are unavailable',
    );
    api.applicable.mockRejectedValue(
      new Error('sensitive provider diagnostic'),
    );
    await f.componentInstance.findChecks();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain(
      'Check suggestions are unavailable',
    );
    expect(f.nativeElement.textContent).not.toContain(
      'sensitive provider diagnostic',
    );
    expect(f.componentInstance.selected()?.rowToken).toBe(rowToken);
  });
  it.each([
    'identity',
    'context',
    'source',
    'selection',
    'meaning',
    'entity',
    'environment',
  ])(
    'clears and refuses a late ignored-abort Check response after %s changes',
    async (change) => {
      const f = await mount();
      await inspect(f);
      await f.componentInstance.findChecks();
      expect(f.componentInstance.applicable()?.checks.length).toBe(5);
      let finish: (v: unknown) => void = () => undefined;
      api.applicable.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = f.componentInstance.findChecks();
      const signal = api.applicable.mock.calls.at(-1)?.[1] as AbortSignal;
      switch (change) {
        case 'identity':
          actor.set('maya');
          changes.next(identity());
          break;
        case 'context':
          await f.componentInstance.chooseContext(undefined);
          break;
        case 'source':
          f.componentInstance.schema.set({
            ...schema,
            source: { ...schema.source, generation: 'g2' },
          });
          break;
        case 'selection':
          f.componentInstance.selected.set({
            schemaToken: token,
            collection: 'current_routes',
            column: 'request_id',
            rowToken: 'f'.repeat(64),
          });
          break;
        case 'meaning':
          f.componentInstance.resolution.set({
            column: 'request_id',
            value: { type: 'string', value: 'request-11045' },
            entity: 'Other',
            field: 'id',
            provenance: 'declared',
          });
          break;
        case 'entity':
          f.componentInstance.entity.set({
            entity,
            revision: 'entity1-' + 'f'.repeat(64),
          });
          break;
        case 'environment':
          f.componentRef.setInput('environments', ['demo', 'other']);
          f.componentInstance.changeEnvironment('other');
          break;
      }
      await f.whenStable();
      expect(signal.aborted).toBe(true);
      expect(f.componentInstance.applicable()).toBeUndefined();
      expect(f.componentInstance.checksPending()).toBe(false);
      finish(preflightFixture.response);
      await pending;
      await f.whenStable();
      expect(f.componentInstance.applicable()).toBeUndefined();
    },
  );
  it('keeps a declared mapping readable without offering or dispatching a fresh mapping', async () => {
    api.resolve.mockResolvedValue({
      column: 'request_id',
      value: { type: 'string', value: 'request-11045' },
      entity: 'ShippingRequest',
      field: 'id',
      provenance: 'declared',
    });
    const f = await mount();
    await inspect(f);
    expect(f.nativeElement.textContent).toContain('Declared');
    expect(f.nativeElement.textContent).toContain('ShippingRequest.id');
    expect(f.nativeElement.textContent).not.toContain('Add existing meaning');
    await f.componentInstance.openPicker();
    f.componentInstance.fieldId.set('id');
    expect(f.componentInstance.entity()?.entity.id).toBe('ShippingRequest');
    expect(f.componentInstance.picker()).toBe(false);
    expect(f.componentInstance.saveAllowed()).toBe(false);
    await f.componentInstance.save();
    expect(api.addMapping).not.toHaveBeenCalled();
    expect(assets.entities).not.toHaveBeenCalled();
  });
  it('allows an inferred meaning to become explicit and keeps pending recovery available after declaration', async () => {
    api.resolve.mockResolvedValue({
      column: 'request_id',
      value: { type: 'string', value: 'request-11045' },
      entity: 'ShippingRequest',
      field: 'id',
      provenance: 'inferred',
    });
    const f = await mount();
    await prepare(f);
    expect(f.nativeElement.textContent).toContain('Add existing meaning');
    expect(f.componentInstance.saveAllowed()).toBe(true);
    await f.componentInstance.save();
    expect(f.componentInstance.pending()).toBeTruthy();
    api.resolve.mockResolvedValue({
      column: 'request_id',
      value: { type: 'string', value: 'request-11045' },
      entity: 'ShippingRequest',
      field: 'id',
      provenance: 'declared',
    });
    await f.componentInstance.selectCell(0, 0);
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('Choose entity for review');
    expect(f.nativeElement.textContent).not.toContain('Add existing meaning');
    await f.componentInstance.openPicker();
    expect(f.componentInstance.picker()).toBe(true);
    expect(f.componentInstance.saveAllowed()).toBe(false);
    await f.componentInstance.chooseEntity('ShippingRequest');
    await f.componentInstance.reviewPending();
    expect(f.componentInstance.reviewed()).toBe(true);
    expect(api.addMapping).toHaveBeenCalledOnce();
  });
  it('keeps corrupt-attempt recovery entity review available for an already declared cell', async () => {
    sessionStorage.setItem(mappingJournalKey(scope()), '{');
    api.resolve.mockResolvedValue({
      column: 'request_id',
      value: { type: 'string', value: 'request-11045' },
      entity: 'ShippingRequest',
      field: 'id',
      provenance: 'declared',
    });
    const f = await mount();
    await inspect(f);
    expect(f.componentInstance.blocked()).toBe(true);
    expect(f.nativeElement.textContent).toContain('Choose entity for review');
    await f.componentInstance.openPicker();
    await f.componentInstance.chooseEntity('ShippingRequest');
    f.componentInstance.fieldId.set('id');
    expect(f.componentInstance.saveAllowed()).toBe(false);
    await f.componentInstance.reviewPending();
    expect(f.componentInstance.reviewed()).toBe(true);
    expect(api.addMapping).not.toHaveBeenCalled();
  });
  it('keeps Cancel at the same cell and missing entity revision/readonly/type mismatch cannot save', async () => {
    const f = await mount();
    await prepare(f);
    const selected = f.componentInstance.selected();
    f.componentInstance.cancel();
    expect(f.componentInstance.selected()).toEqual(selected);
    await f.componentInstance.openPicker();
    assets.entity.mockReturnValue(
      of({ entity, revisionError: 'Header unavailable' }),
    );
    await f.componentInstance.chooseEntity('ShippingRequest');
    f.componentInstance.fieldId.set('id');
    expect(f.componentInstance.saveAllowed()).toBe(false);
    await f.componentInstance.save();
    expect(api.addMapping).not.toHaveBeenCalled();
    assets.entity.mockReturnValue(of({ entity, revision }));
    await f.componentInstance.chooseEntity('ShippingRequest');
    f.componentInstance.fieldId.set('id');
    f.componentRef.setInput('canWrite', false);
    await f.whenStable();
    expect(f.componentInstance.saveAllowed()).toBe(false);
  });
  it('persists before first dispatch, locks unknown delivery and remount retries exactly the original operation', async () => {
    const f = await mount();
    await prepare(f);
    api.addMapping.mockImplementation(async (request: NativeMapping) => {
      expect(sessionStorage.getItem(mappingJournalKey(scope()))).toContain(
        request.operationId,
      );
      throw new Error('unknown');
    });
    await f.componentInstance.save();
    const original = structuredClone(f.componentInstance.pending());
    expect(original).toBeTruthy();
    expect(f.componentInstance.saveAllowed()).toBe(false);
    f.destroy();
    const g = await mount();
    expect(g.componentInstance.pending()).toEqual(original);
    await g.componentInstance.retry();
    expect(api.addMapping.mock.calls.at(-1)?.[0]).toEqual(original);
    expect(api.addMapping).toHaveBeenCalledTimes(2);
  });
  it('storage failure blocks first dispatch; corrupt and overlong stored operations remain until reviewed abandonment', async () => {
    const f = await mount();
    await prepare(f);
    const spy = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage');
    });
    await f.componentInstance.save();
    expect(api.addMapping).not.toHaveBeenCalled();
    expect(f.componentInstance.blocked()).toBe(true);
    spy.mockRestore();
    f.destroy();
    for (const raw of [
      '{',
      JSON.stringify({ version: 1, request: { operationId: 'x'.repeat(129) } }),
    ]) {
      sessionStorage.setItem(mappingJournalKey(scope()), raw);
      const g = await mount();
      expect(g.componentInstance.blocked()).toBe(true);
      expect(sessionStorage.getItem(mappingJournalKey(scope()))).toBe(raw);
      g.componentInstance.abandon();
      expect(sessionStorage.getItem(mappingJournalKey(scope()))).toBe(raw);
      await prepare(g);
      await g.componentInstance.reviewPending();
      expect(g.componentInstance.reviewed()).toBe(true);
      g.componentInstance.abandon();
      expect(sessionStorage.getItem(mappingJournalKey(scope()))).toBeNull();
      g.destroy();
    }
  });
  it('409 does not generate/rebase an operation and requires fresh cell/entity review before local abandonment', async () => {
    const f = await mount();
    await prepare(f);
    api.addMapping.mockRejectedValue(new HttpErrorResponse({ status: 409 }));
    await f.componentInstance.save();
    const original = f.componentInstance.pending();
    await f.componentInstance.retry();
    expect(api.addMapping).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.pending()).toEqual(original);
    await f.componentInstance.reviewPending();
    expect(f.componentInstance.reviewed()).toBe(true);
    f.componentInstance.abandon();
    expect(f.componentInstance.pending()).toBeUndefined();
    expect(f.componentInstance.notice()).toContain('may already be saved');
  });
  it('rereads canonical entity and actual cell/Related after acknowledgement rather than painting a receipt as a mapping', async () => {
    const f = await mount();
    await prepare(f);
    api.addMapping.mockImplementation(async (r: NativeMapping) => ({
      entity,
      revision,
      receipt: r.operationId,
    }));
    api.resolve.mockResolvedValue({
      column: 'request_id',
      value: { type: 'string', value: 'request-11045' },
      entity: 'ShippingRequest',
      field: 'id',
      provenance: 'declared',
    });
    await f.componentInstance.save();
    expect(api.browse).toHaveBeenCalledTimes(2);
    expect(api.related).toHaveBeenCalledTimes(2);
    expect(f.componentInstance.resolution()?.provenance).toBe('declared');
    expect(sessionStorage.getItem(mappingJournalKey(scope()))).toBeNull();
  });
  it('drops late old-account cells and retains the old journal; fresh11062 context cannot inherit old rows/tokens', async () => {
    const f = await mount();
    await prepare(f);
    await f.componentInstance.save();
    const oldKey = mappingJournalKey(scope());
    expect(sessionStorage.getItem(oldKey)).toBeTruthy();
    let finish: (v: unknown) => void = () => undefined;
    api.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.componentInstance.selectCell(0, 0);
    actor.set('maya');
    changes.next(identity());
    f.detectChanges();
    await f.whenStable();
    finish({ column: 'request_id', value: { type: 'string', value: 'old' } });
    await pending;
    expect(f.componentInstance.rows()).toBeUndefined();
    expect(sessionStorage.getItem(oldKey)).toBeTruthy();
    expect(f.componentInstance.pending()).toBeUndefined();
    const original = choice();
    const fresh: EvidenceShareSelection = {
      ...original,
      choice: {
        ...original.choice,
        value: { type: 'integer', value: '11062' },
        evidence: {
          ...original.choice.evidence,
          incidentRef: 'detective-incidents/incident-11062',
          context: {
            ...original.choice.evidence.context,
            sessionId: 'session-11062',
          },
        },
      },
    };
    await f.componentInstance.chooseContext(fresh);
    expect(f.componentInstance.selected()).toBeUndefined();
    expect(f.componentInstance.rows()).toBeUndefined();
  });
  it('source reset invalidates rows/offers without deleting an uncertain mapping', async () => {
    const f = await mount();
    await prepare(f);
    await f.componentInstance.save();
    const key = mappingJournalKey(scope());
    TestBed.inject(NativeSourceInvalidationService).invalidate({
      projectRef: ref,
      actor: 'sarah',
      sourceId: 'shipping-working-copy',
      action: 'reset',
    });
    expect(f.componentInstance.rows()).toBeUndefined();
    expect(f.componentInstance.related()).toBeUndefined();
    expect(sessionStorage.getItem(key)).toBeTruthy();
  });
  it('hydrates an originating Case link before accepting context; a query-string ID alone is insufficient', async () => {
    query.next(convertToParamMap({ caseId: 'case-existing' }));
    detective.linkedIncidents.mockReturnValue(
      of({ caseId: 'case-existing', incidents: [] }),
    );
    const f = await mount();
    const original = choice();
    const selected: EvidenceShareSelection = {
      ...original,
      choice: {
        ...original.choice,
        evidence: { ...original.choice.evidence, caseId: 'case-existing' },
      },
    };
    await f.componentInstance.chooseContext(selected);
    expect(api.schema).not.toHaveBeenCalled();
    expect(f.componentInstance.selection()).toBeUndefined();
    detective.linkedIncidents.mockReturnValue(
      of({
        caseId: 'case-existing',
        incidents: [
          {
            ref: {
              storeId: 'detective-incidents',
              incidentId: 'incident-order',
            },
          },
        ],
      }),
    );
    await f.componentInstance.chooseContext(selected);
    expect(api.schema).toHaveBeenCalledOnce();
  });
  it('refuses ambiguity/unavailable and different-order resolution without claiming Mapping missing', async () => {
    const f = await mount();
    api.resolve.mockRejectedValue(new HttpErrorResponse({ status: 503 }));
    await inspect(f);
    await f.whenStable();
    expect(f.componentInstance.error()).toContain('Unavailable');
    expect(f.nativeElement.textContent).not.toContain('Mapping missing');
    const inspector = f.nativeElement.querySelector(
      '[aria-label="Selected physical cell"]',
    );
    if (!inspector) throw new Error('Selected cell inspector is absent');
    expect(inspector.textContent).toMatch(/string\s*·\s*request-11045/);
    expect(inspector.textContent).toContain(
      'Meaning resolution is unavailable',
    );
    expect(inspector.textContent).not.toContain('NULL cells');
    expect(inspector.textContent).toContain('Retry meaning resolution');
    expect(f.componentInstance.saveAllowed()).toBe(false);
    api.resolve.mockResolvedValue({
      column: 'request_id',
      value: { type: 'string', value: 'request-11062' },
    });
    await f.componentInstance.selectCell(0, 0);
    expect(f.componentInstance.resolution()).toBeUndefined();
    expect(f.componentInstance.error()).toContain('Unavailable');
  });
  it('shows actual NULL type/value and only NULL guidance, without a semantic read or retry', async () => {
    api.browse.mockResolvedValue({
      ...rows,
      columns: [{ name: 'partner_id', type: 'TEXT', nullable: true }],
      rows: [{ rowToken, cells: [{ type: 'null', value: null }] }],
    });
    const f = await mount();
    await inspect(f);
    const inspector = f.nativeElement.querySelector(
      '[aria-label="Selected physical cell"]',
    );
    if (!inspector) throw new Error('Selected cell inspector is absent');
    expect(inspector.textContent).toMatch(/null\s*·\s*NULL/);
    expect(inspector.textContent).toContain('NULL cells cannot be mapped');
    expect(inspector.textContent).not.toContain(
      'Meaning resolution is unavailable',
    );
    expect(inspector.textContent).not.toContain('Retry meaning resolution');
    expect(api.resolve).not.toHaveBeenCalled();
  });
  it('announces actual saving, recovery review and loading while suppressing stale notices', async () => {
    const f = await mount();
    await prepare(f);
    let rejectSave: (error: Error) => void = () => undefined;
    api.addMapping.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    f.componentInstance.notice.set('Earlier successful action');
    const saving = f.componentInstance.save();
    await vi.waitFor(() => expect(api.addMapping).toHaveBeenCalledOnce());
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('Saving mapping…');
    expect(f.nativeElement.textContent).not.toContain(
      'Earlier successful action',
    );
    expect(f.nativeElement.textContent).not.toContain('Loading current data…');
    rejectSave(new Error('unknown delivery'));
    await saving;
    let resolveReview: (value: unknown) => void = () => undefined;
    api.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReview = resolve;
        }),
    );
    f.componentInstance.notice.set('Earlier delivery status');
    const reviewing = f.componentInstance.reviewPending();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain(
      'Reviewing mapping recovery…',
    );
    expect(f.nativeElement.textContent).not.toContain(
      'Earlier delivery status',
    );
    expect(f.nativeElement.textContent).not.toContain('Saving mapping…');
    resolveReview({
      column: 'request_id',
      value: { type: 'string', value: 'request-11045' },
    });
    await reviewing;
    let resolveRows: (value: unknown) => void = () => undefined;
    api.browse.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRows = resolve;
        }),
    );
    f.componentInstance.notice.set('Earlier review status');
    const loading = f.componentInstance.inspect('current_routes');
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('Loading current data…');
    expect(f.nativeElement.textContent).not.toContain('Earlier review status');
    expect(f.nativeElement.textContent).not.toContain(
      'Reviewing mapping recovery…',
    );
    resolveRows(rows);
    await loading;
  });
  it('opens only a current offered Related lookup with the same complete selected context', async () => {
    const lookup = {
      sourceId: 'shipping-working-copy',
      collection: 'requests',
      column: 'request_id',
      kind: 'sameField' as const,
      via: 'field:ShippingRequest.id',
    };
    api.related.mockResolvedValue({
      selection: {
        schemaToken: token,
        collection: 'current_routes',
        rowToken,
        column: 'request_id',
      },
      lookups: [lookup],
      unsupported: [],
    });
    api.relatedRows.mockResolvedValue({ ...rows, collection: 'requests' });
    const f = await mount();
    await inspect(f);
    await f.componentInstance.openRelated(lookup);
    expect(api.relatedRows.mock.calls[0][0]).toMatchObject({
      lookup,
      evidence: choice().choice.evidence,
      selection: f.componentInstance.selected(),
    });
    await f.componentInstance.openRelated({ ...lookup, column: 'partner_id' });
    expect(api.relatedRows).toHaveBeenCalledOnce();
  });
  it('restores exact current-scope envelopes but does not auto-dispatch', async () => {
    const r: NativeMapping = {
      spaceID: 'space',
      projectId: 'training',
      environment: 'demo',
      sourceId: 'shipping-working-copy',
      evidence: choice().choice.evidence,
      selection: {
        schemaToken: token,
        collection: 'current_routes',
        rowToken,
        column: 'request_id',
      },
      operationId: 'original',
      entityId: 'ShippingRequest',
      fieldId: 'id',
      ifMatch: revision,
    };
    sessionStorage.setItem(
      mappingJournalKey(scope()),
      await encodeMappingJournal(scope(), r),
    );
    const f = await mount();
    expect(f.componentInstance.pending()).toEqual(r);
    expect(api.addMapping).not.toHaveBeenCalled();
  });
});
