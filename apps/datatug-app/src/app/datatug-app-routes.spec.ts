import { describe, expect, it } from 'vitest';
import { routes } from './datatug-app-routes';

describe('DataTug app routes', () => {
  it('accepts both the direct and serve handoff agent routes', () => {
    expect(routes.map((route) => route.path)).toEqual(
      expect.arrayContaining([
        'agent/:agentId',
        'pwa/repo/:repo/agent/:agentId',
      ]),
    );
  });
});
