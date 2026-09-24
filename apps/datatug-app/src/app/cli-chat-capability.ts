let currentCapability = '';
let currentPath = '';
const storageKey = 'datatug-cli-chat-bridge';
const chatPath = /^\/store\/[^/]+\/project\/[^/]+\/chat$/;

// Run before analytics initializes. Only the route path is shared with the
// project menu; the capability remains in this module or sessionStorage.
export function captureCliChatCapability(): void {
  if (location.pathname !== '/chat' && !chatPath.test(location.pathname)) return;
  if (location.hash.startsWith('#h=')) {
    currentCapability = location.hash.slice(1);
    currentPath = location.pathname;
    history.replaceState(history.state, '', location.pathname + location.search);
    try { sessionStorage.setItem(storageKey, JSON.stringify({ path: currentPath, capability: currentCapability })); } catch { /* Keep the module-scoped copy. */ }
  }
  if (chatPath.test(location.pathname) && cliChatCapability()) {
    document.documentElement.dataset['cliChatBridgePath'] = location.pathname;
  }
}

export function cliChatCapability(): string {
  if (currentPath === location.pathname) return currentCapability;
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || '{}') as { path?: string; capability?: string };
    return stored.path === location.pathname ? stored.capability || '' : '';
  } catch { return ''; }
}
