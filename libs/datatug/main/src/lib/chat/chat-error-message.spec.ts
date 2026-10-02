import { chatErrorView } from './chat-error-message';

describe('chatErrorView', () => {
  it('explains an invalid aggregate shape in plain language and keeps the engine text as detail', () => {
    const raw = 'join_aggregate at orderBy[0]: c.Country is neither aggregated nor present in GROUP BY';
    const view = chatErrorView(raw);
    expect(view.summary).toMatch(/totals|counts/i);
    expect(view.summary).not.toContain('join_aggregate');
    expect(view.summary).not.toContain('orderBy[0]');
    expect(view.detail).toBe(raw);
  });

  it('explains an unavailable column or table', () => {
    const raw = 'join_field at columns[2]: unknown field i.Revenue';
    expect(chatErrorView(raw).summary).toMatch(/column/i);
    expect(chatErrorView(raw).detail).toBe(raw);
    expect(chatErrorView('join_scope at from.joins[0].on[0].left: forward alias c').summary).toMatch(/column|table/i);
  });

  it('gives any other engine error a generic plain-language summary', () => {
    const raw = 'join_shape at orderBy[1]: unknown property descending';
    const view = chatErrorView(raw);
    expect(view.summary).toMatch(/rephras/i);
    expect(view.summary).not.toContain('join_shape');
    expect(view.detail).toBe(raw);
  });

  it('shows a message that is already plain language as it is, with no technical detail', () => {
    const view = chatErrorView('The AI provider rejected the request (HTTP 401).');
    expect(view).toEqual({ summary: 'The AI provider rejected the request (HTTP 401).' });
  });

  it('hides a long or multi-line message behind the technical detail', () => {
    const raw = 'Nested mappings are not allowed in compact mappings at line 3, column 4:\n  from: {a: b: c}\n';
    const view = chatErrorView(raw);
    expect(view.summary).not.toContain('Nested mappings');
    expect(view.detail).toBe(raw.trim());
  });

  it('has a summary when no message was stored', () => {
    expect(chatErrorView(undefined)).toEqual({ summary: 'Unable to answer that question.' });
    expect(chatErrorView('  ')).toEqual({ summary: 'Unable to answer that question.' });
  });
});
