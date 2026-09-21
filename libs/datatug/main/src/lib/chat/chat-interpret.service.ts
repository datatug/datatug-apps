import { Injectable } from '@angular/core';
import { ChatMetrics, ChatProvider, CHINOOK_SCHEMA_PROMPT } from './chat.types';
import { ChatWorkspaceAction } from './chat-workspace';

const instructions = `You translate one question about Chinook into one DTQL, workspace action, or FK JOIN candidate action.
Return only a JSON object with a single dtql, workspaceAction, or joinCandidate property. No prose or Markdown.
Use from, where, orderBy and limit as needed. Always include a limit from 1 to 1000.
For example: {"dtql":{"from":{"schema":"main","name":"Customer"},"where":{"op":"==","left":{"field":"City"},"right":{"value":"Prague"}},"limit":50}}
For descending order: {"dtql":{"from":{"schema":"main","name":"Invoice"},"orderBy":[{"field":"InvoiceId","desc":true}],"limit":100}}
Each orderBy item uses field and optional desc boolean. Never use direction, column, sort, or order keys.
Do not generate SQL, JOIN clauses, ON predicates, aggregation, or unsupported fields. The browser validates the action before running it.
For a JOIN request with one exact edge, choose its candidate ID from the supplied relationship metadata and return {"joinCandidate":{"recordSetId":"exact RecordSet ID","candidateId":"exact candidate ID"}}. Use the latest successful RecordSet unless the user names a different exact ID. The browser handles ambiguous targets locally and resolves relationships from its foreign-key manifest. Never invent an ID or predicate.
For a follow-up that needs identifiers from a previous RecordSet, use where op "In" with right.recordSet {"id":"the RecordSet ID from context","field":"the source column"}. The left field is the target table's matching identifier. For example, to find customers from saved invoices: {"dtql":{"from":{"schema":"main","name":"Customer"},"where":{"op":"In","left":{"field":"CustomerId"},"right":{"recordSet":{"id":"saved RecordSet ID","field":"CustomerId"}}},"limit":100}}. The browser substitutes saved values locally. Never invent or include result values in the action.
For a related query over an attached or docked Selection, use right.selection with its ID and source column in the same In predicate. For an attached or docked Bookmark use right.bookmark with its ID and source column. DataTug resolves the selected values locally; never include result values.
For a local selection request, return {"workspaceAction":{"kind":"select","recordSetId":"the saved RecordSet ID","column":"City","equals":"Prague","limit":5}}. For "dock them", return {"workspaceAction":{"kind":"dockCurrent"}}. The browser applies these actions to saved results without another database query.
Other workspace actions: {"kind":"clearSelection"}, {"kind":"sortView","viewId":"existing View ID","column":"Total","descending":true}, {"kind":"undock","dockId":"existing dock ID"}, {"kind":"bookmark","reference":...}, and {"kind":"attach"} or {"kind":"detach"} with reference {"kind":"table|source|project|recordset|view|selection|bookmark","projectId":"current project","sourceId":"chinook when applicable","objectId":"exact object ID","title":"short label"}. To dock a known result/View/Selection/Bookmark, use {"kind":"dock","reference":...}. Use exact IDs from context, never invent IDs. Browsing or focusing an item does not attach it.
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

export type ChatInterpretation =
  | { readonly dtql: string; readonly workspaceAction?: never; readonly joinCandidate?: never; readonly metrics: Omit<ChatMetrics, 'queryMs'> }
  | { readonly dtql?: never; readonly workspaceAction: ChatWorkspaceAction; readonly joinCandidate?: never; readonly metrics: Omit<ChatMetrics, 'queryMs'> }
  | { readonly dtql?: never; readonly workspaceAction?: never; readonly joinCandidate: { readonly recordSetId: string; readonly candidateId: string }; readonly metrics: Omit<ChatMetrics, 'queryMs'> };

function actionFromContent(content: unknown):
  | { dtql: string; workspaceAction?: never; joinCandidate?: never }
  | { dtql?: never; workspaceAction: ChatWorkspaceAction; joinCandidate?: never }
  | { dtql?: never; workspaceAction?: never; joinCandidate: { recordSetId: string; candidateId: string } } {
  if (typeof content !== 'string' || content.length > 12000) {
    throw new Error('The AI provider did not return one DTQL action.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('The AI provider returned invalid DTQL JSON.');
  }
  const root = object(parsed);
  const dtql = object(root?.['dtql']);
  const workspaceAction = object(root?.['workspaceAction']);
  const joinCandidate = object(root?.['joinCandidate']);
  if (dtql && Object.keys(root || {}).length === 1) return { dtql: JSON.stringify(dtql) };
  if (workspaceAction && Object.keys(root || {}).length === 1 && typeof workspaceAction['kind'] === 'string') {
    return { workspaceAction: workspaceAction as unknown as ChatWorkspaceAction };
  }
  if (joinCandidate && Object.keys(root || {}).length === 1 &&
      Object.keys(joinCandidate).sort().join(',') === 'candidateId,recordSetId' &&
      typeof joinCandidate['recordSetId'] === 'string' && typeof joinCandidate['candidateId'] === 'string' &&
      joinCandidate['recordSetId'].length <= 100 && joinCandidate['candidateId'].length <= 1000) {
    return { joinCandidate: { recordSetId: joinCandidate['recordSetId'], candidateId: joinCandidate['candidateId'] } };
  }
  throw new Error('The AI provider did not return one valid DTQL, workspace, or JOIN action.');
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
  async interpret(question: string, provider: ChatProvider, context = ''): Promise<ChatInterpretation> {
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
    const system = context
      ? `${instructions}\nPrevious session queries and RecordSet metadata (no result values):\n${context}`
      : instructions;
    const requestBody = JSON.stringify(isAnthropic
      ? { model: provider.model, max_tokens: 1024, system, messages: [{ role: 'user', content: question }] }
      : { model: provider.model, max_tokens: 1024, messages: [{ role: 'system', content: system }, { role: 'user', content: question }] });
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
      ...actionFromContent(content),
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
