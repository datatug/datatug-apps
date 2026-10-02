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
});

describe('the demo route', () => {
  it('is registered before the catch-all, without an auth guard, only when the demoRoute flag is on', async () => {
    const flag = await import('../environments/environment');
    expect(flag.datatugDemoConfig.enabled).toBe(true); // development and e2e
    const demo = routes.find((route) => route.path === 'demo');
    if (!demo) throw new Error('the demo route is not registered');
    expect(demo).toBeDefined();
    expect(demo?.canActivate).toBeUndefined();
    expect(demo?.canMatch).toBeUndefined();
    expect(demo?.data?.['demo']).toBe(flag.datatugDemoConfig);
    expect(routes.indexOf(demo)).toBeLessThan(routes.findIndex((route) => route.path === '' && !route.outlet));
  });

  it('is off by default in the production environment, with one line to switch on and the static data source', async () => {
    const prod = await import('../environments/environment.prod');
    expect(prod.datatugDemoConfig).toEqual({ enabled: false, dataSource: { kind: 'static' }, allowDataSourceOverride: false });
  });
});
