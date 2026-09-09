let agentSessionToken = '';

export function consumeAgentSessionFragment(
  location: Location,
  history: History,
): void {
  const match = /^#agentToken=([^&]*)/.exec(location.hash);
  if (!match) {
    return;
  }
  const token = decodeURIComponent(match[1]);
  if (/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    agentSessionToken = token;
  }
  // Remove the whole fragment even when malformed or followed by unexpected
  // data, so analytics and router state can never retain the capability.
  history.replaceState(history.state, '', location.pathname + location.search);
}

export function getAgentSessionToken(): string {
  return agentSessionToken;
}

export function clearAgentSessionTokenForTest(): void {
  agentSessionToken = '';
}
