import template from './query-page.component.html?raw';

describe('query page template for HTTP queries', () => {
  it('hides the Run query / parameters card for an HTTP query, unless a selection or context binds its parameters', () => {
    expect(template).toContain(
      "@if ((!isTextQueryWorkspace() && queryState.queryType !== 'HTTP') || httpSemanticRun()) {",
    );
  });

  it('shows the HTTP editor without its own Run when the page offers the semantic Run', () => {
    expect(template).toContain('[showRun]="!httpSemanticRun()"');
  });

  it('disables Save while the HTTP request has a save problem', () => {
    expect(template).toContain('!!httpSaveProblem');
  });

  it('binds the session context bag to the HTTP editor', () => {
    expect(template).toContain('[bagEntries]="httpBagEntries()"');
  });
});
