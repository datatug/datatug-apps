import mainSource from './main.ts?raw';
import isolatedSource from './postmortem-public-bootstrap.ts?raw';
import indexSource from './index.html?raw';
import headersSource from './_headers?raw';
/** These source-boundary tests ensure tracking cannot initialize before capability scrubbing. */
describe('public Postmortem bootstrap privacy boundary', () => {
  it('never statically imports the authenticated application from the entry chunk', () => {
    expect(mainSource).not.toMatch(/^import /m);
    expect(mainSource).toContain("import('./main-application')");
    expect(mainSource).toContain("import('./postmortem-public-bootstrap')");
    expect(mainSource.indexOf('history.replaceState')).toBeLessThan(
      mainSource.indexOf("import('./postmortem-public-bootstrap')"),
    );
  });
  it('captures a real dotted capability before all tracking scripts and clears the URL', () => {
    const start = indexSource.indexOf(
      '<script id="datatug-postmortem-privacy">',
    );
    const end = indexSource.indexOf('</script>', start);
    const source = indexSource.slice(indexSource.indexOf('>', start) + 1, end);
    const location = {
      pathname: '/postmortems/shared',
      hash: '#token=space.project.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijk',
    };
    const state: Record<string, unknown> = {};
    const history = { replaceState: vi.fn() };
    new Function('window', 'location', 'history', source)(
      state,
      location,
      history,
    );
    expect(state['__datatugPostmortemToken']).toBe(
      'space.project.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijk',
    );
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/postmortems/shared',
    );
    expect(state['__datatugOptionalTrackingDisabled']).toBe(true);
    expect(start).toBeLessThan(indexSource.indexOf('googletagmanager'));
  });
  it('does not install authenticated interceptors or telemetry in the public injector', () => {
    expect(isolatedSource).toContain('provideHttpClient()');
    expect(isolatedSource).not.toContain('withInterceptors');
    expect(isolatedSource).not.toContain('provideSneatAuthenticatedProviders');
    expect(isolatedSource).not.toContain('provideAnalytics');
    expect(isolatedSource).not.toContain('provideSentry');
  });
  it('ships HTML policy for public path with no third party script or framing authority', () => {
    expect(headersSource).toContain('/postmortems/shared');
    expect(headersSource).toContain("script-src 'self' 'unsafe-inline'");
    expect(headersSource).toContain("frame-ancestors 'none'");
    expect(headersSource).toContain('no-store, private');
    expect(headersSource).toContain('Referrer-Policy: no-referrer');
  });
});
