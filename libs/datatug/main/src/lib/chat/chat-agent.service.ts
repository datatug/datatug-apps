import { Injectable } from '@angular/core';
import { buildAgentUrl } from '../services/repo/agent-url';
import { ChatProvider, CHINOOK_SCHEMA_PROMPT } from './chat.types';

@Injectable({ providedIn: 'root' })
export class ChatAgentService {
  async interpret(storeId: string, question: string, provider: ChatProvider): Promise<string> {
    const agentUrl = new URL(buildAgentUrl(storeId, '/chat/interpret'), window.location.href);
    const hostname = agentUrl.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(agentUrl.protocol) || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      throw new Error('This local Chat trial sends API keys only to a loopback DataTug agent. Choose a localhost store.');
    }
    const response = await fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, schema: CHINOOK_SCHEMA_PROMPT, provider: {
        protocol: provider.protocol, baseUrl: provider.baseUrl, model: provider.model, apiKey: provider.apiKey,
      } }),
    });
    const body = await response.json().catch(() => undefined) as { dtql?: unknown; error?: { message?: unknown } } | undefined;
    if (!response.ok || typeof body?.dtql !== 'string') {
      throw new Error(typeof body?.error?.message === 'string' ? body.error.message : 'The local AI agent could not interpret this question.');
    }
    return body.dtql;
  }
}
