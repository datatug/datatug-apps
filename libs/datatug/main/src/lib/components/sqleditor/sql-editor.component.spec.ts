import { ComponentFixture, TestBed } from '@angular/core/testing';
import { closeBrackets, insertBracket } from '@codemirror/autocomplete';
import { history, redo, undo } from '@codemirror/commands';
import { StandardSQL } from '@codemirror/lang-sql';
import { type LanguageSupport, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

import { SQL_HASH_COMMENT_LANGUAGE_DESCRIPTIONS } from './sql-language';
import { getRawSource } from '../code-editor/raw-source';
import { SqlEditorComponent } from './sql-editor.component';

describe('SqlEditorComponent', () => {
  let component: SqlEditorComponent;
  let fixture: ComponentFixture<SqlEditorComponent>;
  const views = new Set<EditorView>();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SqlEditorComponent] })
      .overrideComponent(SqlEditorComponent, {
        set: { imports: [], template: '' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SqlEditorComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    for (const view of views) view.destroy();
    views.clear();
    fixture.destroy();
  });

  const mount = async (
    source: string,
    options: {
      readonly?: boolean;
      disabled?: boolean;
      autoCloseBrackets?: boolean;
    } = {},
  ): Promise<EditorView> => {
    fixture.componentRef.setInput('sql', source);
    fixture.componentRef.setInput('readonly', options.readonly ?? false);
    fixture.componentRef.setInput('disabled', options.disabled ?? false);
    fixture.componentRef.setInput(
      'autoCloseBrackets',
      options.autoCloseBrackets ?? true,
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return mountCurrentInstance(source, options);
  };

  const mountCurrentInstance = (
    source: string,
    options: { readonly?: boolean; disabled?: boolean } = {},
  ): EditorView => {
    const editorHost = document.createElement('div');
    fixture.nativeElement.appendChild(editorHost);
    const extensions = [
      history(),
      closeBrackets(),
      EditorState.allowMultipleSelections.of(true),
      EditorState.readOnly.of(options.readonly ?? component.readonly()),
      EditorView.editable.of(!(options.disabled ?? component.disabled())),
      StandardSQL.language,
      ...component.instance().extensions,
    ];
    // Acrodata's basic setup adds the default gutter. The component only hides
    // it for lineNumbers=false, so model the wrapper once for both settings.
    extensions.push(lineNumbers());
    const view = new EditorView({
      root: document,
      parent: editorHost,
      state: EditorState.create({ doc: source, extensions }),
    });
    (component as unknown as { editor?: { view: EditorView } }).editor = {
      view,
    };
    views.add(view);
    return view;
  };

  it('mounts the SQL grammar and highlights without changing source bytes', async () => {
    const source =
      "SELECT 'Luís''s playlist' AS label,\r\n  42 AS count\nFROM Playlist\rWHERE Name = 'Rock';";
    const view = await mount(source, { readonly: true });
    const tree = syntaxTree(view.state).toString();

    expect(getRawSource(view.state)).toBe(source);
    expect(tree).toContain('Script(Statement(');
    expect(view.dom.querySelector('.sql-token-keyword')).not.toBeNull();
    expect(view.dom.querySelector('.sql-token-string')).not.toBeNull();
    expect(view.dom.querySelector('.sql-token-number')).not.toBeNull();
    expect(view.dom.querySelector('.sql-token-identifier')).not.toBeNull();
    expect(view.state.facet(EditorState.readOnly)).toBe(true);
  });

  it('names the editable text with its ariaLabel input (default "SQL query")', async () => {
    let view = await mount('SELECT 1');
    expect(view.contentDOM.getAttribute('aria-label')).toBe('SQL query');
    expect(view.contentDOM.getAttribute('role')).toBe('textbox');
    fixture.componentRef.setInput('ariaLabel', 'DTQL source');
    fixture.detectChanges();
    view = mountCurrentInstance('SELECT 1');
    expect(view.contentDOM.getAttribute('aria-label')).toBe('DTQL source');
  });

  it('honors the line-number input without replacing CodeMirror setup', async () => {
    const defaultGutterView = await mount('SELECT 1;');
    expect(
      defaultGutterView.dom.querySelectorAll('.cm-lineNumbers'),
    ).toHaveLength(1);
    expect(
      getComputedStyle(
        defaultGutterView.dom.querySelector('.cm-lineNumbers') as HTMLElement,
      ).display,
    ).not.toBe('none');
    const initial = component.instance();

    fixture.componentRef.setInput('lineNumbers', false);
    fixture.detectChanges();
    expect(component.instance().generation).toBe(initial.generation + 1);
    expect(component.instance().extensions).not.toBe(initial.extensions);
    const hiddenGutterView = mountCurrentInstance('SELECT 1;');
    const hiddenGutters =
      hiddenGutterView.dom.querySelectorAll('.cm-lineNumbers');
    expect(hiddenGutters).toHaveLength(1);
    // jsdom does not apply CodeMirror's generated theme stylesheet; the AOT
    // browser journey asserts that this gutter container is actually hidden.

    const hidden = component.instance();
    fixture.componentRef.setInput('lineNumbers', true);
    fixture.detectChanges();
    expect(component.instance().generation).toBe(hidden.generation + 1);
    const visibleGutterView = mountCurrentInstance('SELECT 1;', {
      readonly: false,
      disabled: false,
    });
    const visibleGutters =
      visibleGutterView.dom.querySelectorAll('.cm-lineNumbers');
    expect(visibleGutters).toHaveLength(1);
    expect(getComputedStyle(visibleGutters[0]).display).not.toBe('none');
  });

  it('preserves generic bracket pairing but disables it for saved native SQL', async () => {
    const sharedEditor = await mount('SELECT 1;');
    const languageData = (sharedEditor.state.languageDataAt(
      'closeBrackets',
      0,
    )[0] ?? {}) as { brackets?: readonly string[] };
    expect(languageData.brackets).toEqual(['(', '[', '{', "'", '"']);

    sharedEditor.dispatch({
      selection: { anchor: sharedEditor.state.doc.length },
    });
    sharedEditor.focus();
    typeCharacter(sharedEditor, '(');
    expect(sharedEditor.state.doc.toString()).toBe('SELECT 1;()');
    expect(undo(sharedEditor)).toBe(true);
    expect(sharedEditor.state.doc.toString()).toBe('SELECT 1;');
    typeCharacter(sharedEditor, '`');
    expect(sharedEditor.state.doc.toString()).toBe('SELECT 1;`');

    const generation = component.instance().generation;
    fixture.componentRef.setInput('autoCloseBrackets', false);
    fixture.detectChanges();
    expect(component.instance().generation).toBe(generation + 1);
    const savedSqlEditor = mountCurrentInstance('SELECT 1;');
    const savedSqlLanguageData = (savedSqlEditor.state.languageDataAt(
      'closeBrackets',
      0,
    )[0] ?? {}) as { brackets?: readonly string[] };
    expect(savedSqlLanguageData.brackets).toEqual([]);
    savedSqlEditor.dispatch({
      selection: { anchor: savedSqlEditor.state.doc.length },
    });
    savedSqlEditor.focus();
    typeCharacter(savedSqlEditor, '(');
    expect(savedSqlEditor.state.doc.toString()).toBe('SELECT 1;(');
    typeCharacter(savedSqlEditor, '`');
    expect(savedSqlEditor.state.doc.toString()).toBe('SELECT 1;(`');
  });

  it('emits exact edited SQL and native undo restores mixed line endings', async () => {
    const source =
      "SELECT 'Luís''s playlist' AS label,\r\n  42 AS count\nFROM Playlist\rWHERE Name = 'Rock';";
    const view = await mount(source);
    const listener = vi.fn();
    component.sqlChanged.subscribe(listener);

    view.dispatch({
      changes: { from: view.state.doc.length, insert: '\n-- draft' },
    });
    const edited = `${source}\r\n-- draft`;
    expect(getRawSource(view.state)).toBe(edited);
    expect(listener).toHaveBeenLastCalledWith(edited);

    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(source);
    expect(listener).toHaveBeenLastCalledWith(source);
  });

  it('preserves pasted mixed separators and Unicode through native undo and redo', async () => {
    const source = 'SELECT 1;\r\nSELECT 2\nSELECT 3\r';
    const pasted = "42\r\n-- Luís\n'unfinished\r";
    const view = await mount(source);
    const listener = vi.fn();
    component.sqlChanged.subscribe(listener);
    view.dispatch({ selection: { anchor: 7, head: 8 } });

    const event = pasteEvent(pasted);
    view.contentDOM.dispatchEvent(event);
    const edited = `${source.slice(0, 7)}${pasted}${source.slice(8)}`;

    expect(event.defaultPrevented).toBe(true);
    expect(getRawSource(view.state)).toBe(edited);
    expect(listener).toHaveBeenLastCalledWith(edited);
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(source);
    expect(redo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(edited);
  });

  it('applies the same exact paste to each selected range', async () => {
    const source = 'SELECT 1;\r\nSELECT 2';
    const pasted = '42\r-- multi\n';
    const view = await mount(source);
    const listener = vi.fn();
    component.sqlChanged.subscribe(listener);
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor('SELECT '.length),
        EditorSelection.cursor(view.state.doc.line(2).from + 'SELECT '.length),
      ]),
    });

    view.contentDOM.dispatchEvent(pasteEvent(pasted));

    expect(getRawSource(view.state)).toBe(
      `SELECT ${pasted}1;\r\nSELECT ${pasted}2`,
    );
    expect(listener).toHaveBeenLastCalledWith(getRawSource(view.state));
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(source);
    expect(redo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(
      `SELECT ${pasted}1;\r\nSELECT ${pasted}2`,
    );
  });

  it('restores mixed separators after unequal multi-range replacement undo and redo', async () => {
    const source = 'SELECT 1;\r\nSELECT 2\nSELECT 3\r';
    const pasted = 'X\r\nY\n';
    const view = await mount(source);
    const firstLine = view.state.doc.line(1);
    const secondLine = view.state.doc.line(2);
    const thirdLine = view.state.doc.line(3);
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(firstLine.to, secondLine.from),
        EditorSelection.range(
          thirdLine.from + 'SELECT '.length,
          thirdLine.from + 'SELECT 3'.length,
        ),
      ]),
    });

    view.contentDOM.dispatchEvent(pasteEvent(pasted));

    const replaced = 'SELECT 1;X\r\nY\nSELECT 2\nSELECT X\r\nY\n\r';
    expect(getRawSource(view.state)).toBe(replaced);
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(source);
    expect(redo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(replaced);
  });

  it('keeps CodeMirror line-per-selection paste distribution', async () => {
    const source = 'SELECT 1;\r\nSELECT 2';
    const view = await mount(source);
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor('SELECT '.length),
        EditorSelection.cursor(view.state.doc.line(2).from + 'SELECT '.length),
      ]),
    });

    const event = pasteEvent('A\r\nB');
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(getRawSource(view.state)).toBe('SELECT A1;\r\nSELECT B2');
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(source);
    expect(redo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe('SELECT A1;\r\nSELECT B2');
  });

  it('keeps CodeMirror linewise copy-and-paste behavior', async () => {
    const source = 'SELECT 1;\r\nSELECT 2';
    const view = await mount(source);
    const line = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(line.from) });
    view.focus();
    const lineContents = view.contentDOM.querySelectorAll('.cm-line')[1];
    const range = document.createRange();
    range.selectNodeContents(lineContents);
    range.collapse(true);
    const domSelection = document.getSelection();
    domSelection?.removeAllRanges();
    domSelection?.addRange(range);

    const copied = copyEvent();
    view.contentDOM.dispatchEvent(copied.event);
    expect(copied.text()).toBe('SELECT 2');

    const pasted = pasteEvent('SELECT 2');
    view.contentDOM.dispatchEvent(pasted);
    const result = 'SELECT 1;\r\nSELECT 2\r\nSELECT 2';
    expect(pasted.defaultPrevented).toBe(true);
    expect(getRawSource(view.state)).toBe(result);
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(source);
    expect(redo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(result);
  });

  it('preserves raw-only separator replacements and their undo history', async () => {
    const source = 'SELECT 1;\nSELECT 2';
    const view = await mount(source);
    const listener = vi.fn();
    component.sqlChanged.subscribe(listener);
    view.dispatch({
      selection: {
        anchor: view.state.doc.line(1).to,
        head: view.state.doc.line(2).from,
      },
    });

    view.contentDOM.dispatchEvent(pasteEvent('\r'));

    const replaced = 'SELECT 1;\rSELECT 2';
    expect(view.state.doc.toString()).toBe(source);
    expect(getRawSource(view.state)).toBe(replaced);
    expect(listener).toHaveBeenLastCalledWith(replaced);
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(source);
    expect(redo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(replaced);
  });

  it('preserves beginning, middle, and end paste separators through undo and redo', async () => {
    const source = 'A\r\nB\nC\rD';
    const view = await mount(source);
    view.dispatch({ selection: { anchor: 0 } });
    view.contentDOM.dispatchEvent(pasteEvent('\r\nX'));
    const beginning = '\r\nXA\r\nB\nC\rD';
    expect(getRawSource(view.state)).toBe(beginning);
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(source);
    expect(redo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(beginning);

    view.dispatch({
      selection: {
        anchor: view.state.doc.line(4).from,
        head: view.state.doc.line(5).from,
      },
    });
    view.contentDOM.dispatchEvent(pasteEvent('β\r'));
    const middle = '\r\nXA\r\nB\nβ\rD';
    expect(getRawSource(view.state)).toBe(middle);
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(beginning);
    expect(redo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(middle);

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.contentDOM.dispatchEvent(pasteEvent('\rEND'));
    const end = `${middle}\rEND`;
    expect(getRawSource(view.state)).toBe(end);
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(middle);
    expect(redo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(end);
  });

  it('keeps an adjacent paste separate from typed text in native undo history', async () => {
    const source = 'SELECT 1;';
    const view = await mount(source);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: ' -- typed' },
      userEvent: 'input.type',
    });
    const typed = `${source} -- typed`;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.contentDOM.dispatchEvent(pasteEvent(' -- pasted'));

    expect(getRawSource(view.state)).toBe(`${typed} -- pasted`);
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(typed);
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(source);
  });

  it('does not emit programmatic document changes while read-only', async () => {
    const view = await mount('SELECT 1;', { readonly: true });
    const listener = vi.fn();
    component.sqlChanged.subscribe(listener);

    view.dispatch({
      changes: { from: view.state.doc.length, insert: ' -- changed' },
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not emit programmatic document changes while disabled', async () => {
    const view = await mount('SELECT 1;', { disabled: true });
    expect(view.state.facet(EditorView.editable)).toBe(false);
    const listener = vi.fn();
    component.sqlChanged.subscribe(listener);

    view.dispatch({
      changes: { from: view.state.doc.length, insert: ' -- changed' },
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps a parent echo from replacing the mounted editor or its history', async () => {
    const source = 'SELECT 1;';
    const view = await mount(source);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: '\n-- edit' },
    });
    const generation = component.instance().generation;
    fixture.componentRef.setInput('sql', getRawSource(view.state));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.instance().generation).toBe(generation);
    expect(undo(view)).toBe(true);
    expect(getRawSource(view.state)).toBe(source);
  });

  it('treats a different external SQL value as a replacement without echoing it', async () => {
    const view = await mount('SELECT 1;');
    const listener = vi.fn();
    component.sqlChanged.subscribe(listener);
    const generation = component.instance().generation;
    const replacement = "SELECT 'external';\r\nFROM Playlist";

    fixture.componentRef.setInput('sql', replacement);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.instance().generation).toBe(generation + 1);
    expect(component.instance().value).toBe(replacement);
    expect(listener).not.toHaveBeenCalled();
    expect(getRawSource(view.state)).toBe('SELECT 1;');
  });

  it('colours # line comments as SQL comments for TugQL YAML sources, not the next line', async () => {
    fixture.componentRef.setInput('hashComments', true);
    expect(component.languages()).toBe(SQL_HASH_COMMENT_LANGUAGE_DESCRIPTIONS);
    const source = '# customers\nlimit: 20 -- cap';
    const host = document.createElement('div');
    fixture.nativeElement.appendChild(host);
    const view = new EditorView({
      root: document,
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [
          SQL_HASH_COMMENT_LANGUAGE_DESCRIPTIONS[0].support as LanguageSupport,
          ...component.instance().extensions,
        ],
      }),
    });
    views.add(view);
    const [first, second] = Array.from(view.dom.querySelectorAll('.cm-line'));

    expect(first.querySelector('.sql-token-comment')?.textContent).toBe(
      '# customers',
    );
    expect(second.querySelector('.sql-token-comment')?.textContent).toBe(
      '-- cap',
    );
    expect(second.textContent).toBe('limit: 20 -- cap');
  });
});

const pasteEvent = (text: string): Event => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['text/plain'], getData: () => text },
  });
  return event;
};

const typeCharacter = (view: EditorView, key: string): void => {
  const bracketTransaction = insertBracket(view.state, key);
  if (bracketTransaction) {
    view.dispatch(bracketTransaction);
  } else {
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: key },
      selection: { anchor: view.state.selection.main.head + key.length },
      userEvent: 'input.type',
    });
  }
};

const copyEvent = (): { readonly event: Event; text(): string } => {
  let text = '';
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      clearData: () => (text = ''),
      setData: (_type: string, value: string) => (text = value),
    },
  });
  return { event, text: () => text };
};
