import { Injectable, signal } from '@angular/core';
import { ChatProvider, ChatProtocol } from './chat.types';

const storageKey = 'datatug.chat.providers.v1';
const selectedStorageKey = 'datatug.chat.selected-provider.v1';

export const providerPresets: Readonly<Record<string, Omit<ChatProvider, 'id' | 'apiKey'>>> = {
  DeepSeek: { name: 'DeepSeek', protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  OpenAI: { name: 'OpenAI', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  Anthropic: { name: 'Anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001' },
};

function readProviders(): ChatProvider[] {
  try {
    const value = localStorage.getItem(storageKey);
    const parsed: unknown = value ? JSON.parse(value) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isProvider);
  } catch {
    return [];
  }
}

function isProvider(value: unknown): value is ChatProvider {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string' && typeof candidate['name'] === 'string'
    && (candidate['protocol'] === 'openai-chat' || candidate['protocol'] === 'anthropic-messages')
    && typeof candidate['baseUrl'] === 'string' && typeof candidate['model'] === 'string'
    && typeof candidate['apiKey'] === 'string';
}

@Injectable({ providedIn: 'root' })
export class ChatProviderService {
  readonly providers = signal<readonly ChatProvider[]>(readProviders());
  readonly selectedId = signal<string | undefined>(this.initialSelectedId());

  save(draft: Omit<ChatProvider, 'id'>, id?: string): ChatProvider {
    const provider: ChatProvider = { ...draft, id: id || crypto.randomUUID() };
    const next = id
      ? this.providers().map((item) => item.id === id ? provider : item)
      : [...this.providers(), provider];
    this.persist(next, this.selectedId() || provider.id);
    return provider;
  }

  select(id: string): void {
    this.persist(this.providers(), id);
  }

  remove(id: string): void {
    const next = this.providers().filter((provider) => provider.id !== id);
    this.persist(next, this.selectedId() === id ? next[0]?.id : this.selectedId());
  }

  preset(name: string): Omit<ChatProvider, 'id' | 'apiKey'> {
    return providerPresets[name] || providerPresets['DeepSeek'];
  }

  private persist(providers: readonly ChatProvider[], selectedId?: string): void {
    localStorage.setItem(storageKey, JSON.stringify(providers));
    if (selectedId) localStorage.setItem(selectedStorageKey, selectedId);
    else localStorage.removeItem(selectedStorageKey);
    this.providers.set(providers);
    this.selectedId.set(selectedId);
  }

  private initialSelectedId(): string | undefined {
    const selected = localStorage.getItem(selectedStorageKey) || undefined;
    return this.providers().some((provider) => provider.id === selected)
      ? selected
      : this.providers()[0]?.id;
  }
}
