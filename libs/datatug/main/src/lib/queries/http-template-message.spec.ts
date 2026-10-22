import { httpTemplateMessage } from './http-template-message';

describe('httpTemplateMessage', () => {
  it('writes one plain sentence from the structured fields', () => {
    expect(httpTemplateMessage('forbidden-position', 'host', 'host')).toBe(
      "{host} can't be in the web address's host. Use a separate query for each host.",
    );
    expect(httpTemplateMessage('missing-value', 'q')).toBe('{q} needs a value.');
  });

  it('never carries raw text and strips odd characters from a name', () => {
    const msg = httpTemplateMessage('undeclared', '<script>alert(1)</script>');
    expect(msg).not.toContain('<');
    expect(httpTemplateMessage('nonsense')).toBe('This request template is not valid.');
  });
});
