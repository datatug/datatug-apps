import template from './query-page.component.html?raw';

describe('query page template for HTTP queries', () => {
  it('hides the Run query / parameters card for an HTTP query', () => {
    expect(template).toContain(
      "@if (!isTextQueryWorkspace() && queryState.queryType !== 'HTTP') {",
    );
  });

  it('disables Save while the HTTP request has a save problem', () => {
    expect(template).toContain('!!httpSaveProblem');
  });
});
