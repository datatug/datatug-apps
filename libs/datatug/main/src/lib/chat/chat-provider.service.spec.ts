import { ChatProviderService, providerPresets } from './chat-provider.service';

describe('explicit AI provider selection', () => {
  beforeEach(() => localStorage.clear());
  it('preserves an existing BYOK user on upgrade and reload', () => {
    localStorage.setItem('datatug.chat.providers.v1', JSON.stringify([{ ...providerPresets['OpenAI'], id: 'own', apiKey: 'example-key' }]));
    localStorage.setItem('datatug.chat.selected-provider.v1', 'own');
    expect(new ChatProviderService().selectedId()).toBe('own');
    const service = new ChatProviderService(); service.select('__managed__');
    expect(new ChatProviderService().selectedId()).toBe('__managed__');
    service.select('own'); expect(new ChatProviderService().selectedId()).toBe('own');
  });
  it('starts without an API key and preserves explicitly selected empty BYOK mode', () => {
    const service = new ChatProviderService();
    expect(service.selectedId()).toBe('__managed__'); expect(service.providers()).toEqual([]);
    service.select('__byok__'); expect(new ChatProviderService().selectedId()).toBe('__byok__');
  });
});
