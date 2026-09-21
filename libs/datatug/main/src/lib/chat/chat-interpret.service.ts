import { Injectable } from '@angular/core';
import { ChatMetrics, ChatProvider, CHINOOK_SCHEMA_PROMPT } from './chat.types';

const instructions = `You translate one question about Chinook into one DTQL action.
Return only a JSON object with a single dtql property containing the DTQL object. No prose or Markdown.
Use from, where, orderBy and limit as needed. Always include a limit from 1 to 1000.
For example: {"dtql":{"from":{"schema":"main","name":"Customer"},"where":{"op":"==","left":{"field":"City"},"right":{"value":"Prague"}},"limit":50}}
For descending order: {"dtql":{"from":{"schema":"main","name":"Invoice"},"orderBy":[{"field":"InvoiceId","desc":true}],"limit":100}}
Each orderBy item uses field and optional desc boolean. Never use direction, column, sort, or order keys.
Do not use SQL, joins, aggregation, or unsupported fields. The browser validates the action before running it.
${CHINOOK_SCHEMA_PROMPT}`;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function providerUrl(provider: ChatProvider): URL {
  let url: URL;
  try {
    url = new URL(provider.baseUrl);
  } catch {
    throw new Error('Enter a valid AI provider base URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('The AI provider URL must use HTTPS, or HTTP on localhost, without credentials or query parameters.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions') || path.endsWith('/messages')) {
    throw new Error('Enter the AI provider base URL without the operation path.');
  }
  url.pathname = provider.protocol === 'anthropic-messages'
    ? `${path.endsWith('/v1') ? path : `${path}/v1`}/messages`
    : `${path}/chat/completions`;
  return url;
}

function dtqlFromContent(content: unknown): string {
  if (typeof content !== 'string' || content.length > 12000) {
    throw new Error('The AI provider did not return one DTQL action.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('The AI provider returned invalid DTQL JSON.');
  }
  const dtql = object(object(parsed)?.['dtql']);
  if (!dtql) throw new Error('The AI provider did not return one DTQL action.');
  return JSON.stringify(dtql);
}

async function boundedResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The AI provider returned an empty response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) {
        await reader.cancel().catch(() => undefined);
        throw new Error('The AI provider response is too large.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'The AI provider response is too large.') throw error;
    throw new Error('The AI provider response could not be read.');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

@Injectable({ providedIn: 'root' })
export class ChatInterpretService {
  async interpret(question: string, provider: ChatProvider): Promise<{ dtql: string; metrics: Omit<ChatMetrics, 'queryMs'> }> {
    if (new TextEncoder().encode(question.trim()).byteLength > 1000) {
      throw new Error('Question must be 1000 bytes or fewer.');
    }
    if (!provider.model.trim() || !provider.apiKey.trim() ||
        provider.model !== provider.model.trim() || provider.apiKey !== provider.apiKey.trim() ||
        provider.model.length > 100 || provider.apiKey.length > 4096) {
      throw new Error('Select an AI provider with a model and API key.');
    }
    const url = providerUrl(provider);
    const isAnthropic = provider.protocol === 'anthropic-messages';
    const requestBody = JSON.stringify(isAnthropic
      ? { model: provider.model, max_tokens: 1024, system: instructions, messages: [{ role: 'user', content: question }] }
      : { model: provider.model, max_tokens: 1024, messages: [{ role: 'system', content: instructions }, { role: 'user', content: question }] });
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (isAnthropic) {
      headers.set('x-api-key', provider.apiKey);
      headers.set('anthropic-version', '2023-06-01');
      headers.set('anthropic-dangerous-direct-browser-access', 'true');
    } else {
      headers.set('Authorization', `Bearer ${provider.apiKey}`);
    }
    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers, body: requestBody, redirect: 'error', signal: AbortSignal.timeout(45_000) });
    } catch {
      throw new Error('The browser could not reach this AI provider. Check the URL, network, and browser access settings.');
    }
    if (!response.ok) throw new Error(`The AI provider rejected the request (HTTP ${response.status}).`);
    const responseText = await boundedResponseText(response);
    let body: Record<string, unknown> | undefined;
    try {
      body = object(JSON.parse(responseText));
    } catch {
      throw new Error('The AI provider returned an invalid response.');
    }
    const content = isAnthropic
      ? (Array.isArray(body?.['content']) ? object(body['content'][0])?.['text'] : undefined)
      : (Array.isArray(body?.['choices']) ? object(object(body['choices'][0])?.['message'])?.['content'] : undefined);
    const usage = object(body?.['usage']);
    const inputTokens = isAnthropic ? usage?.['input_tokens'] : usage?.['prompt_tokens'];
    const outputTokens = isAnthropic ? usage?.['output_tokens'] : usage?.['completion_tokens'];
    const totalTokens = usage?.['total_tokens'];
    return {
      dtql: dtqlFromContent(content),
      metrics: {
        inputTokens: typeof inputTokens === 'number' ? inputTokens : undefined,
        outputTokens: typeof outputTokens === 'number' ? outputTokens : undefined,
        totalTokens: typeof totalTokens === 'number' ? totalTokens :
          typeof inputTokens === 'number' && typeof outputTokens === 'number' ? inputTokens + outputTokens : undefined,
        requestBytes: new TextEncoder().encode(requestBody).byteLength,
        responseBytes: new TextEncoder().encode(responseText).byteLength,
        interpretMs: performance.now() - started,
      },
    };
  }
}
