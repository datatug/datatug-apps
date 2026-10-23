import { LanguageSupport } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  createTugqlEditorExtensions,
  TUGQL_LANGUAGE_DESCRIPTIONS,
  tokenizeTugql,
} from './tugql-syntax';

describe('tokenizeTugql', () => {
  it('classifies TugQL and SQL tokens without changing source bytes', () => {
    const source =
      "SeLeCt @CustomerId, \"InvoiceId\", 'it''s \\ fine', 1.25e-2 -- keep this\r\nfrom Invoice where InvoiceId = ?1";
    const tokens = tokenizeTugql(source);

    expect(tokens.map((token) => token.text).join('')).toBe(source);
    expect(
      tokens
        .filter((token) => token.kind === 'keyword')
        .map((token) => token.text),
    ).toEqual(['SeLeCt', 'from', 'where']);
    expect(
      tokens
        .filter((token) => token.kind === 'parameter')
        .map((token) => token.text),
    ).toEqual(['@CustomerId', '?1']);
    expect(
      tokens
        .filter((token) => token.kind === 'string')
        .map((token) => token.text),
    ).toEqual(["'it''s \\ fine'"]);
    expect(
      tokens
        .filter((token) => token.kind === 'identifier')
        .map((token) => token.text),
    ).toEqual(['"InvoiceId"', 'Invoice', 'InvoiceId']);
    expect(
      tokens
        .filter((token) => token.kind === 'number')
        .map((token) => token.text),
    ).toEqual(['1.25e-2']);
    expect(
      tokens
        .filter((token) => token.kind === 'comment')
        .map((token) => token.text),
    ).toEqual(['-- keep this']);
  });

  it('keeps incomplete drafts verbatim while giving unfinished strings a string token', () => {
    const source = "select @CustomerId from Invoice where Name = 'unfinished";
    const tokens = tokenizeTugql(source);

    expect(tokens.map((token) => token.text).join('')).toBe(source);
    expect(tokens.at(-1)).toEqual({ text: "'unfinished", kind: 'string' });
  });

  it('treats backslash as literal and still closes a single-quoted string', () => {
    const source = "select '\\' as slash -- note";
    const tokens = tokenizeTugql(source);

    expect(tokens.map((token) => token.text).join('')).toBe(source);
    expect(tokens.filter((token) => token.kind === 'string').map((token) => token.text)).toEqual(["'\\'"]);
    expect(tokens.filter((token) => token.kind === 'keyword').map((token) => token.text)).toEqual(['select', 'as']);
    expect(tokens.find((token) => token.kind === 'comment')?.text).toBe('-- note');
  });

  it('preserves every line-ending byte for static SQL preview highlighting', () => {
    const source = 'SELECT 1\r\n-- next\rSELECT 2\n';
    expect(
      tokenizeTugql(source)
        .map((token) => token.text)
        .join(''),
    ).toBe(source);
  });

  it.each(['\r', '\r\n', '\n'])(
    'ends a comment at the %j line break',
    (lineBreak) => {
      const source = `-- comment${lineBreak}select 1`;
      const tokens = tokenizeTugql(source);
      expect(tokens.map((token) => token.text).join('')).toBe(source);
      expect(tokens.find((token) => token.kind === 'comment')?.text).toBe(
        '-- comment',
      );
      expect(tokens.filter((token) => token.kind === 'keyword').map((t) => t.text)).toEqual([
        'select',
      ]);
    },
  );

  it('highlights outer joins and exists predicates case-insensitively', () => {
    expect(
      tokenizeTugql('outer join Invoice where exists (select 1)')
        .filter((token) => token.kind === 'keyword')
        .map((token) => token.text),
    ).toEqual(['outer', 'join', 'where', 'exists', 'select']);
  });

  it('highlights imported-query syntax and every documented parameter type case-insensitively', () => {
    const source =
      'WITH Saved FROM "./saved.tql" USING (Rate decimal required) DEFAULT 2';
    const keywords = tokenizeTugql(source)
      .filter((token) => token.kind === 'keyword')
      .map((token) => token.text.toLowerCase());

    expect(keywords).toEqual([
      'with',
      'from',
      'using',
      'decimal',
      'required',
      'default',
    ]);
    expect(
      tokenizeTugql(source)
        .filter((token) => token.kind === 'string')
        .map((token) => token.text),
    ).toContain('"./saved.tql"');
  });
});

describe('TugQL comment highlighting in the editor', () => {
  const render = (source: string): EditorView => {
    const support = TUGQL_LANGUAGE_DESCRIPTIONS[0].support as LanguageSupport;
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: source,
        extensions: [support, ...createTugqlEditorExtensions('TugQL source')],
      }),
    });
    // The stream parser is lazy: ask the viewport to be styled.
    view.requestMeasure();
    return view;
  };

  it('marks a -- comment line as a comment and not the code on the next line', () => {
    const view = render('-- all invoices\nselect 1 from Invoice');
    const [comment, code] = Array.from(view.dom.querySelectorAll('.cm-line'));

    expect(comment.querySelector('.tugql-token-comment')?.textContent).toBe(
      '-- all invoices',
    );
    expect(code.querySelector('.tugql-token-comment')).toBeNull();
    expect(code.querySelector('.tugql-token-keyword')?.textContent).toBe(
      'select',
    );
    view.destroy();
  });

  it('ends a trailing comment at the line break', () => {
    const tokens = tokenizeTugql('select 1 -- note\nfrom Invoice');
    expect(
      tokens.filter((t) => t.kind === 'comment').map((t) => t.text),
    ).toEqual(['-- note']);
  });
});
