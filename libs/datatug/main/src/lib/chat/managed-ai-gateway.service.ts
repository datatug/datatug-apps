import { Injectable, inject, signal } from '@angular/core';
import { DefaultSneatAppApiBaseUrl, SneatApiAuthTokenBridge, SneatApiBaseUrl } from '@sneat/api';
import { SneatUrlOperationBlocker } from '@sneat/core-public';
import { firstValueFrom, timeout } from 'rxjs';

export interface AIAllowance { readonly unit: string; readonly used: number; readonly limit: number; readonly resetsAt?: string }
export interface ManagedAIReply { readonly text: string; readonly structured?: unknown; readonly inputTokens?: number; readonly outputTokens?: number }
export class ManagedAIError extends Error {
  constructor(message: string, readonly code: string, readonly retryable = false, readonly retryAfterMs = 0, readonly limit?: unknown) {
    super(code === 'quota' ? 'Your Managed AI allowance is exhausted. Wait for its reset or explicitly choose your own provider.' :
      code === 'rate_limited' ? `Managed AI is temporarily rate limited. Try again${retryAfterMs > 0 ? ` in ${Math.ceil(retryAfterMs / 1000)} seconds` : ' later'}.` :
      code === 'auth' ? 'Sign in again to use Managed AI.' : `${message.replace(/[.?!]+$/, '')}.`);
  }
}

/** Product adapter for the existing Sneat ai/cloud protocol; no provider credentials. */
@Injectable({ providedIn: 'root' })
export class ManagedAIGatewayService {
  private readonly auth = inject(SneatApiAuthTokenBridge);
  private readonly blocker = inject(SneatUrlOperationBlocker);
  private readonly base = inject(SneatApiBaseUrl, { optional: true }) ?? DefaultSneatAppApiBaseUrl;
  private generation = 0;
  private readonly requests = new Set<AbortController>();
  readonly usageState = signal<'unavailable' | 'loading' | 'ready'>('unavailable');
  readonly usageError = signal<string | undefined>(undefined);
  readonly allowance = signal<AIAllowance | undefined>(undefined);

  reset(): void {
    ++this.generation;
    for (const controller of this.requests) controller.abort();
    this.allowance.set(undefined); this.usageState.set('unavailable'); this.usageError.set(undefined);
  }

  async usage(signal?: AbortSignal): Promise<void> {
    const generation = this.generation;
    this.usageState.set('loading'); this.usageError.set(undefined);
    try {
      const response = await this.request('ai/usage', undefined, signal);
      const value = await response.json() as { product?: string; allowance?: unknown };
      if (value.product !== 'datatug' || !isAIAllowance(value.allowance)) throw new Error('Managed AI allowance is unavailable.');
      if (generation !== this.generation) return;
      this.allowance.set(value.allowance); this.usageState.set('ready');
    } catch (error) {
      if (generation === this.generation) { this.allowance.set(undefined); this.usageState.set('unavailable'); this.usageError.set(error instanceof Error ? error.message : 'Allowance unavailable.'); }
      throw error;
    }
  }

  async chat(body: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<ManagedAIReply> {
    const generation = this.generation;
    const response = await this.request('ai/chat', { ...body, product: 'datatug' }, signal);
    if (!response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Managed AI returned an invalid stream.');
    return readManagedAIStream(response, signal, (allowance) => {
      if (generation === this.generation) { this.allowance.set(allowance); this.usageState.set('ready'); }
    });
  }

  private async request(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    if (this.blocker.isBlocked('server-requests')) throw new Error('Server requests are blocked in this diagnostic session.');
    const controller = new AbortController();
    this.requests.add(controller);
    const ownedSignal = AbortSignal.any([controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(60_000)]);
    ownedSignal.addEventListener('abort', () => this.requests.delete(controller), { once: true });
    const token = await firstValueFrom(this.auth.resolvedToken().pipe(timeout({ first: 10_000 })));
    ownedSignal.throwIfAborted();
    const response = await fetch(this.base + path, {
      method: body ? 'POST' : 'GET', signal: ownedSignal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'X-AI-Product': 'datatug', 'X-AI-Protocol': '1',
        ...(body ? { 'Content-Type': 'application/json', Accept: 'text/event-stream' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string; retryable?: boolean; retryAfterMs?: number }; limit?: unknown };
      const error = value.error;
      const retry = response.headers.get('retry-after');
      const retryMs = retry ? Math.min(600_000, Math.max(0, Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now())) : 0;
      throw new ManagedAIError(error?.message || `Managed AI refused the request (HTTP ${response.status}).`, error?.code || 'upstream', error?.retryable,
        Math.max(error?.retryAfterMs || 0, retryMs), value.limit);
    }
    return response;
  }
}

/** Incremental UTF-8 + SSE framing, including CR, LF, CRLF and multiline data. */
export async function readManagedAIStream(response: Response, signal: AbortSignal, allowance: (value: AIAllowance) => void): Promise<ManagedAIReply> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Managed AI returned an empty stream.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', name = '', data: string[] = [], text = '', bytes = 0;
  let structured: unknown, inputTokens: number | undefined, outputTokens: number | undefined;
  const flush = (): boolean => {
    if (!data.length) { name = ''; return false; }
    if (name && !['response.started', 'text.delta', 'output.structured', 'usage', 'error', 'response.completed'].includes(name)) { data = []; name = ''; return false; }
    const value = JSON.parse(data.join('\n')) as { type?: string; text?: string; structured?: unknown; stopReason?: string;
      usage?: { inputTokens?: number; outputTokens?: number; allowance?: AIAllowance }; error?: { code?: string; message?: string; retryable?: boolean; retryAfterMs?: number } };
    const type = value.type || name;
    data = []; name = '';
    if (type === 'error') throw new ManagedAIError(value.error?.message || 'Managed AI could not complete the answer.', value.error?.code || 'upstream', value.error?.retryable, value.error?.retryAfterMs);
    if (value.usage && ['usage', 'response.completed'].includes(type)) {
      inputTokens = value.usage.inputTokens; outputTokens = value.usage.outputTokens;
      if (value.usage.allowance) {
        if (!isAIAllowance(value.usage.allowance)) throw new Error('Managed AI returned invalid allowance metadata.');
        allowance(value.usage.allowance);
      }
    }
    if (type === 'text.delta') text += value.text || '';
    if (type === 'output.structured') structured = value.structured;
    if (type === 'response.completed' && value.stopReason && value.stopReason !== 'end') throw new Error('Managed AI could not complete a query. Try a narrower question.');
    return type === 'response.completed';
  };
  const line = (value: string): boolean => {
    if (!value) return flush();
    if (value.startsWith('event:')) name = value.slice(6).trim();
    if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    return false;
  };
  const aborted = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', aborted, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      bytes += chunk.value?.byteLength || 0;
      if (bytes > 1024 * 1024) throw new Error('Managed AI output exceeded the 1 MiB limit. Narrow the question.');
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (match[0] === '\r' && match.index === buffer.length - 1 && !chunk.done) break;
        const value = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (line(value)) return { text, structured, inputTokens, outputTokens };
      }
      if (chunk.done) {
        if (buffer) line(buffer);
        if (flush()) return { text, structured, inputTokens, outputTokens };
        throw new Error('Managed AI stream was interrupted before completion. Retry the question.');
      }
    }
  } finally {
    signal.removeEventListener('abort', aborted);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function isAIAllowance(value: unknown): value is AIAllowance {
  if (!value || typeof value !== 'object') return false;
  const item = value as AIAllowance;
  return typeof item.unit === 'string' && !!item.unit.trim() && Number.isFinite(item.used) && item.used >= 0 && Number.isFinite(item.limit) && item.limit >= 0 &&
    (item.resetsAt === undefined || typeof item.resetsAt === 'string' && Number.isFinite(Date.parse(item.resetsAt)));
}
