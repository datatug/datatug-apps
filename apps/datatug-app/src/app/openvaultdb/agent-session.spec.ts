import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAgentSessionTokenForTest,
  consumeAgentSessionFragment,
  getAgentSessionToken,
} from './agent-session';

describe('agent session bootstrap', () => {
  beforeEach(clearAgentSessionTokenForTest);

  it('consumes a valid fragment and erases it before app boot', () => {
    let replaced = '';
    consumeAgentSessionFragment(
      {
        hash: '#agentToken=abcdefghijklmnopqrstuvwxyzABCDEFG_123456',
        pathname: '/agent/localhost:8989',
        search: '?view=ovdb',
      } as Location,
      {
        state: null,
        replaceState: (_state, _unused, url) => (replaced = String(url)),
      } as unknown as History,
    );
    expect(getAgentSessionToken()).toBe(
      'abcdefghijklmnopqrstuvwxyzABCDEFG_123456',
    );
    expect(replaced).toBe('/agent/localhost:8989?view=ovdb');
  });

  it('erases an invalid token without retaining it', () => {
    let replaced = false;
    consumeAgentSessionFragment(
      { hash: '#agentToken=bad', pathname: '/', search: '' } as Location,
      {
        state: null,
        replaceState: () => (replaced = true),
      } as unknown as History,
    );
    expect(replaced).toBe(true);
    expect(getAgentSessionToken()).toBe('');
  });
});
