import { TestBed } from '@angular/core/testing';
import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { NativeSemanticApiService } from './native-semantic-api.service';
import { DatatugApiService } from '../services/base/datatug-api.service';
import { ProjectAssetsApiService } from '../services/project/project-assets-api.service';
import { NativeMapping } from './native-semantic-contract';
const ref = { storeId: 'firestore', spaceID: 'space', projectId: 'training' };
const request: NativeMapping = {
  spaceID: 'space',
  projectId: 'training',
  environment: 'demo',
  sourceId: 'shipping-working-copy',
  evidence: {
    retention: 'project-pinned',
    incidentRef: 'detective-incidents/incident',
    context: {
      sessionId: 'session',
      expectedSessionVersion: 1,
      expectedContextSetId: 'applied',
      scope: { environmentId: 'demo', identityDomain: 'domain' },
      bindings: [
        { inputName: 'order_id', entryId: 'order', revisionId: 'rev' },
      ],
    },
  },
  selection: {
    schemaToken: 'a'.repeat(64),
    collection: 'current_routes',
    column: 'request_id',
    rowToken: 'b'.repeat(64),
  },
  operationId: 'mapping-original',
  entityId: 'ShippingRequest',
  fieldId: 'id',
  ifMatch: 'entity1-' + 'c'.repeat(64),
};
const base = {
  spaceID: request.spaceID,
  projectId: request.projectId,
  environment: request.environment,
  sourceId: request.sourceId,
  evidence: request.evidence,
};
const selected = { ...base, selection: request.selection };
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
describe('Native seven-route adapter and canonical entity snapshots', () => {
  const api = { get: vi.fn(), getResponse: vi.fn(), post: vi.fn() };
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiService, useValue: api }],
    });
  });
  it('uses exact GET spelling and no body; refuses branch/custom API scope', async () => {
    api.get.mockReturnValue(
      of({
        schemaToken: 'a'.repeat(64),
        source: {
          sourceId: 'shipping-working-copy',
          environment: 'demo',
          generation: 'g1',
          revision: 1,
          sha256: 'c'.repeat(64),
          bindingRevision: 1,
          schemaSHA256: 'd'.repeat(64),
        },
        collections: [],
      }),
    );
    await TestBed.inject(NativeSemanticApiService).schema(
      ref,
      'demo',
      new AbortController().signal,
    );
    const [path, params] = api.get.mock.calls[0];
    expect(path).toBe('datatug/semantic/schema');
    expect(
      Object.fromEntries(params.keys().map((k: string) => [k, params.get(k)])),
    ).toEqual({
      storage: 'firestore',
      spaceID: 'space',
      project: 'training',
      environment: 'demo',
      sourceId: 'shipping-working-copy',
    });
    expect(() =>
      TestBed.inject(NativeSemanticApiService).schema(
        { ...ref, branch: 'topic' },
        'demo',
        new AbortController().signal,
      ),
    ).toThrow();
  });
  it('sends no actor/storage/query aliases and disables credential-retry for frozen mutations', async () => {
    api.post.mockReturnValue(
      of({ entity, revision: request.ifMatch, receipt: request.operationId }),
    );
    await TestBed.inject(NativeSemanticApiService).addMapping(
      request,
      new AbortController().signal,
    );
    expect(api.post).toHaveBeenCalledWith(
      'datatug/semantic/mappings/add',
      request,
      { retryUnauthorizedOnce: false },
    );
    api.post.mockReturnValue(
      of({ entity, revision: request.ifMatch, receipt: 'foreign' }),
    );
    await expect(
      TestBed.inject(NativeSemanticApiService).addMapping(
        request,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it('keeps existing entities readable with saving disabled when either revision header is absent/mismatched', async () => {
    for (const headers of [
      {},
      { ETag: '"wrong"', 'X-Datatug-Asset-Revision': request.ifMatch },
      { ETag: 'W/"weak"', 'X-Datatug-Asset-Revision': request.ifMatch },
    ]) {
      api.getResponse.mockReturnValue(
        of(
          new HttpResponse({
            body: entity,
            headers: new HttpHeaders(headers as Record<string, string>),
          }),
        ),
      );
      const result = await import('rxjs').then(({ firstValueFrom }) =>
        firstValueFrom(
          TestBed.inject(ProjectAssetsApiService).entity(
            ref,
            'demo',
            'ShippingRequest',
          ),
        ),
      );
      expect(result.entity.id).toBe('ShippingRequest');
      expect(result.revision).toBeUndefined();
      expect(result.revisionError).toBeTruthy();
    }
    api.getResponse.mockReturnValue(
      of(
        new HttpResponse({
          body: entity,
          headers: new HttpHeaders({
            ETag: `"${request.ifMatch}"`,
            'X-Datatug-Asset-Revision': request.ifMatch,
          }),
        }),
      ),
    );
    const { firstValueFrom } = await import('rxjs');
    expect(
      (
        await firstValueFrom(
          TestBed.inject(ProjectAssetsApiService).entity(
            ref,
            'demo',
            'ShippingRequest',
          ),
        )
      ).revision,
    ).toBe(request.ifMatch);
    const params = api.getResponse.mock.calls.at(-1)?.[1];
    expect(params.get('environment')).toBe('demo');
    expect(params.get('spaceID')).toBe('space');
  });
  it('aborts a read and refuses a late mismatched row/schema response', async () => {
    const source = new Subject<unknown>(),
      controller = new AbortController();
    api.post.mockReturnValue(source);
    const svc = TestBed.inject(NativeSemanticApiService),
      promise = svc.browse(
        {
          ...base,
          schemaToken: request.selection.schemaToken,
          collection: 'requests',
        },
        controller.signal,
      );
    const rejected = expect(promise).rejects.toThrow();
    controller.abort();
    await rejected;
    api.post.mockReturnValue(
      of({
        schemaToken: 'e'.repeat(64),
        collection: 'requests',
        columns: [{ name: 'request_id', type: 'TEXT', nullable: false }],
        rows: [],
        truncated: false,
      }),
    );
    await expect(
      svc.browse(
        {
          ...base,
          schemaToken: request.selection.schemaToken,
          collection: 'requests',
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it('never interprets WIP or future Ready=true as Check closure proof', async () => {
    api.post.mockReturnValue(
      of({ queries: [], checks: [{ id: 'real-check', ready: true }] }),
    );
    expect(
      (
        await TestBed.inject(NativeSemanticApiService).applicable(
          selected,
          new AbortController().signal,
        )
      ).available,
    ).toBe(false);
  });
});
