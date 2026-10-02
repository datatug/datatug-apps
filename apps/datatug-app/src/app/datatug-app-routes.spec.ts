import { routes } from './datatug-app-routes';

// Task 13 (S108) — see this file's own header comment in datatug-app-routes.ts.
// The read-only worktree `.worktrees/datatug-apps-layered-acl-query` (5ebb264)
// registers `pwa/repo/:repo/agent/:agentId` and `agent/:agentId` as a second,
// competing store-id/agent-URL convention; this guards against either ever
// being silently reintroduced.
describe('DataTug app routes', () => {
  it('does not register the layered-ACL branch competing agent-URL routes', () => {
    const paths = routes.map((route) => route.path);
    expect(paths).not.toContain('agent/:agentId');
    expect(paths).not.toContain('pwa/repo/:repo/agent/:agentId');
  });

  // G-0: a hand-off from the sites must never fail to match (Sentry's crash-report dialog, the question lost).
  it.each([
    'demo',
    'project/github.com/:owner/:repo/chat',
    'project/github.com/:owner/:repo/tree/:ref/-/chat',
  ])(
    'has the hand-off route %s: exact match, lazy, no flag, no guard',
    (path) => {
      const route = routes.find((r) => r.path === path);
      expect(route).toBeDefined();
      expect(route?.pathMatch).toBe('full');
      expect(route?.loadComponent).toBeTypeOf('function');
      expect(route?.canMatch).toBeUndefined();
      expect(route?.canActivate).toBeUndefined();
      expect(route?.children).toBeUndefined();
    },
  );

  it('leaves the rest of the route table as it was: the hand-off routes are only added', () => {
    expect(routes.map((r) => r.path)).toEqual([
      'demo',
      'project/github.com/:owner/:repo/chat',
      'project/github.com/:owner/:repo/tree/:ref/-/chat',
      'store/:storeId/project/:projectId/chat',
      'chat',
      'hello-world',
      'debug',
      '',
      '',
    ]);
  });
});
