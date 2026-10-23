import { TestBed } from '@angular/core/testing';
import { SneatApiAuthTokenBridge, SneatApiBaseUrl } from '@sneat/api';
import { SneatUrlOperationBlocker } from '@sneat/core-public';
import { of } from 'rxjs';
import { ManagedAIGatewayService, ManagedAIError, readManagedAIStream, isAIAllowance } from './managed-ai-gateway.service';

const event = (type: string, value: object) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...value })}\r\n\r\n`;
const response = (text: string) => new Response(new ReadableStream({ start(controller) {
  for (const byte of new TextEncoder().encode(text)) controller.enqueue(new Uint8Array([byte]));
  controller.close();
} }), { headers: { 'Content-Type': 'text/event-stream' } });

describe('Managed AI gateway contract', () => {
  let service: ManagedAIGatewayService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ManagedAIGatewayService,
      { provide: SneatApiAuthTokenBridge, useValue: { resolvedToken: () => of('session-token') } },
      { provide: SneatApiBaseUrl, useValue: 'https://api.example/v0/' },
      { provide: SneatUrlOperationBlocker, useValue: { isBlocked: () => false } },
    ] });
    service = TestBed.inject(ManagedAIGatewayService);
  });
  it('decodes UTF-8/chunk boundaries, ignores unknown opaque frames, requires completion and preserves usage', async () => {
    const allowance = vi.fn();
    const result = await readManagedAIStream(response('event: future.extension\ndata: opaque non-JSON\n\n' +
      event('text.delta', { text: 'Équipement' }) + event('usage', { usage: { inputTokens: 3, outputTokens: 2, allowance: { unit: 'tokens', used: 5, limit: 20 } } }) + event('response.completed', {})), new AbortController().signal, allowance);
    expect(result.text).toBe('Équipement'); expect(result.inputTokens).toBe(3);
    expect(allowance).toHaveBeenCalledWith({ unit: 'tokens', used: 5, limit: 20 });
    await expect(readManagedAIStream(response(event('text.delta', { text: '{}' })), new AbortController().signal, allowance)).rejects.toThrow('interrupted');
  });
  it('uses the signed-in gateway protocol and never an API provider key', async () => {
    const fetch = vi.fn(async () => response(event('text.delta', { text: '{}' }) + event('response.completed', {})));
    vi.stubGlobal('fetch', fetch);
    await service.chat({ messages: [{ role: 'user', text: 'Question' }] }, new AbortController().signal);
    expect(fetch).toHaveBeenCalledWith('https://api.example/v0/ai/chat', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer session-token', 'X-AI-Product': 'datatug', 'X-AI-Protocol': '1' }),
      body: JSON.stringify({ messages: [{ role: 'user', text: 'Question' }], product: 'datatug' }),
    }));
  });
  it.each(['quota', 'rate_limited'])('preserves %s refusal, limit and retry guidance with no retry/fallback', async (code) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code, message: 'Limit reached', retryable: code === 'rate_limited', retryAfterMs: 2000 }, limit: { unit: 'tokens', used: 20, limit: 20 } }), { status: 429, headers: { 'Retry-After': '3' } }));
    vi.stubGlobal('fetch', fetch);
    try { await service.chat({}, new AbortController().signal); throw new Error('Expected refusal'); }
    catch (error) { expect(error).toBeInstanceOf(ManagedAIError); expect(error).toMatchObject({ code, retryAfterMs: 3000, limit: { unit: 'tokens' } }); }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('treats stream errors as terminal and rejects malformed allowance', async () => {
    await expect(readManagedAIStream(response(event('error', { error: { code: 'quota', message: 'Exhausted' } }) + event('response.completed', {})), new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'quota' });
    expect(isAIAllowance({ unit: 'tokens', used: -1, limit: 20 })).toBe(false);
    expect(isAIAllowance({ unit: 'tokens', used: 0, limit: Infinity })).toBe(false);
    await expect(readManagedAIStream(response(event('usage', { usage: { allowance: { unit: 'tokens', used: 'bad', limit: 20 } } }) + event('response.completed', {})), new AbortController().signal, vi.fn())).rejects.toThrow('invalid allowance');
  });
  it('cancels a pending stream read promptly without accepting a partial response', async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const pending = readManagedAIStream(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'text/event-stream' } }), controller.signal, vi.fn());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalled();
  });

  it('discards a pending usage response across an identity reset', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const pending = service.usage();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    service.reset();
    resolve(new Response(JSON.stringify({ product: 'datatug', allowance: { unit: 'tokens', used: 1, limit: 20 } })));
    await pending;
    expect(service.allowance()).toBeUndefined(); expect(service.usageState()).toBe('unavailable');
  });
});
