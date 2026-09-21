import { Injectable } from '@angular/core';
import { buildAgentUrl } from '../services/repo/agent-url';
import { ChatMetrics, ChatProvider, CHINOOK_SCHEMA_PROMPT } from './chat.types';

@Injectable({ providedIn: 'root' })
export class ChatAgentService {
  async interpret(storeId: string, question: string, provider: ChatProvider): Promise<{ dtql: string; metrics: Omit<ChatMetrics, 'queryMs'> }> {
    const agentUrl = new URL(buildAgentUrl(storeId, '/chat/interpret'), window.location.href);
    const hostname = agentUrl.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(agentUrl.protocol) || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      throw new Error('This local Chat trial sends API keys only to a loopback DataTug agent. Choose a localhost store.');
    }
    const requestBody = JSON.stringify({ question, schema: CHINOOK_SCHEMA_PROMPT, provider: {
      protocol: provider.protocol, baseUrl: provider.baseUrl, model: provider.model, apiKey: provider.apiKey,
    } });
    const started = performance.now();
    const response = await fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });
    const responseText = await response.text();
    const body = JSON.parse(responseText) as { dtql?: unknown; usage?: { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown }; error?: { message?: unknown } };
    if (!response.ok || typeof body?.dtql !== 'string') {
      throw new Error(typeof body?.error?.message === 'string' ? body.error.message : 'The local AI agent could not interpret this question.');
    }
    const usage = body.usage;
    const inputTokens = typeof usage?.inputTokens === 'number' ? usage.inputTokens : undefined;
    const outputTokens = typeof usage?.outputTokens === 'number' ? usage.outputTokens : undefined;
    const totalTokens = typeof usage?.totalTokens === 'number' ? usage.totalTokens : inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined;
    return { dtql: body.dtql, metrics: { inputTokens, outputTokens, totalTokens, requestBytes: new TextEncoder().encode(requestBody).byteLength, responseBytes: new TextEncoder().encode(responseText).byteLength, interpretMs: performance.now() - started } };
  }
}
