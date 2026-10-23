import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  MEANINGGRAPH_CATALOG_FETCH,
  MEANINGGRAPH_CATALOG_PIN,
  NativeDataModelsService,
} from './native-data-models.service';
import { immutableUrl } from '../queries/public-data/canonical-metadata';
import { modelAST, nativeFixture } from './native-data-models.spec-helper';

describe('NativeDataModelsService', () => {
  it('can be explicitly disabled and performs no external reads', async () => {
    const http = vi.fn<typeof fetch>();
    TestBed.configureTestingModule({
      providers: [
        { provide: MEANINGGRAPH_CATALOG_PIN, useValue: null },
        { provide: MEANINGGRAPH_CATALOG_FETCH, useValue: http },
      ],
    });
    const service = TestBed.inject(NativeDataModelsService);
    expect(service.configured).toBe(false);
    await expect(firstValueFrom(service.list())).rejects.toThrow(/No reviewed/);
    expect(http).not.toHaveBeenCalled();
  });
  it('configures the public catalog lazily and verifies its pinned bytes on subscription', async () => {
    const http = vi.fn<typeof fetch>(async () => new Response('{}'));
    TestBed.configureTestingModule({
      providers: [{ provide: MEANINGGRAPH_CATALOG_FETCH, useValue: http }],
    });
    const service = TestBed.inject(NativeDataModelsService);
    const pin = TestBed.inject(MEANINGGRAPH_CATALOG_PIN);
    expect(service.configured).toBe(true);
    if (!pin) throw new Error('The default catalog must be configured.');
    const url = immutableUrl(pin);
    expect(new URL(url).hostname).toBe('raw.githubusercontent.com');
    expect(http).not.toHaveBeenCalled();
    const models = service.list();
    expect(http).not.toHaveBeenCalled();
    await expect(firstValueFrom(models)).rejects.toThrow(
      'Retained native digest mismatch: catalog.json.',
    );
    expect(http).toHaveBeenCalledExactlyOnceWith(
      url,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it('uses an explicitly injected immutable catalog and aborts transport on unsubscribe', async () => {
    const f = await nativeFixture();
    await f.retain({ alias: 'Root', original: modelAST('Root') });
    const pin = await f.publish();
    let admitted: AbortSignal | undefined;
    const http = vi.fn<typeof fetch>(async (_url, init) => {
      admitted = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) =>
        admitted?.addEventListener('abort', () => reject(admitted?.reason), {
          once: true,
        }),
      );
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: MEANINGGRAPH_CATALOG_PIN, useValue: pin },
        { provide: MEANINGGRAPH_CATALOG_FETCH, useValue: http },
      ],
    });
    const service = TestBed.inject(NativeDataModelsService),
      next = vi.fn(),
      error = vi.fn();
    expect(service.configured).toBe(true);
    const subscription = service.list().subscribe({ next, error });
    await Promise.resolve();
    await Promise.resolve();
    expect(admitted).toBeDefined();
    subscription.unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(admitted?.aborted).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('emits configured list and exact detail without changing any project data', async () => {
    const f = await nativeFixture();
    await f.retain({
      alias: 'Root',
      original: modelAST('Root', {
        Item: { fields: { id: { type: 'uuid' } } },
      }),
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: MEANINGGRAPH_CATALOG_PIN, useValue: await f.publish() },
        { provide: MEANINGGRAPH_CATALOG_FETCH, useValue: f.http },
      ],
    });
    const service = TestBed.inject(NativeDataModelsService),
      list = await firstValueFrom(service.list());
    expect(list).toHaveLength(1);
    expect(
      (await firstValueFrom(service.detail(list[0].id, list[0].commit)))
        .records[0].name,
    ).toBe('Item');
    expect(f.http.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(
      true,
    );
  });
});
