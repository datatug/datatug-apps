let currentCapability = '';
const storageKey = 'datatug-cli-chat-bridge';

// Run before analytics initializes. The fragment wins over a prior bridge in
// this tab, then disappears from the address bar and subsequent page events.
export function captureCliChatCapability(): void {
  if (location.pathname !== '/chat' || !location.hash.startsWith('#h=')) return;
  currentCapability = location.hash.slice(1);
  history.replaceState(history.state, '', location.pathname + location.search);
  try { sessionStorage.setItem(storageKey, currentCapability); } catch { /* Keep the module-scoped copy. */ }
}

export function cliChatCapability(): string {
  if (currentCapability) return currentCapability;
  try { return sessionStorage.getItem(storageKey) || ''; } catch { return ''; }
}
