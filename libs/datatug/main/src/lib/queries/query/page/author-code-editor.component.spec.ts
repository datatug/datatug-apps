import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  EditorState,
  StateEffect,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import { history, redo, undo, undoDepth } from '@codemirror/commands';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import {
  AuthorCodeEditorComponent,
  createRawSourceExtensions,
  getRawSource,
  sourceSpanIsValid,
} from './author-code-editor.component';

interface EditorDispatch {
  readonly changes?: { readonly from: number; readonly insert: string };
  readonly selection?: { readonly anchor: number };
}

/** Test seam for Acrodata's Angular wrapper, using the real CodeMirror state. */
@Component({
  // Match the selector of the wrapped third-party component for the test override.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'code-editor',
  template: '<div class="cm-content"></div>',
})
class CodeEditorStubComponent implements OnChanges {
  @Input() public value = '';
  @Input() public root?: Document | ShadowRoot;
  @Input() public language = '';
  @Input() public languages: unknown[] = [];
  @Input() public disabled = false;
  @Input() public readonly = false;
  @Input() public lineWrapping = false;
  @Input() public extensions: Extension[] = [];
  @Input() public setup: string | null = 'basic';
  @Input() public label = '';

  // Acrodata exposes this named output; keep the test seam aligned with it.
  // eslint-disable-next-line @angular-eslint/no-output-native
  @Output() public readonly change = new EventEmitter<string>();
  public view = {
    state: EditorState.create({ doc: '' }),
    dom: { isConnected: true },
    contentDOM: {
      isConnected: true,
      getAttribute: (name: string) =>
        name === 'aria-label' ? this.label : null,
    },
    dispatch: (transaction: EditorDispatch) => {
      const startState = this.view.state;
      const update = startState.update(transaction);
      this.view.state = update.state;
      const viewUpdate = {
        startState,
        state: update.state,
        changes: update.changes,
        docChanged: !update.changes.empty,
        transactions: [{ isUserEvent: () => false }],
      } as unknown as ViewUpdate;
      update.state
        .facet(EditorView.updateListener)
        .forEach((listener) => listener(viewUpdate));
      this.change.emit(this.view.state.doc.toString());
    },
  };

  public ngOnChanges(): void {
    this.view.state = EditorState.create({
      doc: this.value,
      extensions: this.extensions,
    });
  }
}

describe('AuthorCodeEditorComponent', () => {
  let fixture: ComponentFixture<AuthorCodeEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorCodeEditorComponent],
    })
      .overrideComponent(AuthorCodeEditorComponent, {
        set: { imports: [CodeEditorStubComponent] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(AuthorCodeEditorComponent);
  });

  const editor = (): CodeEditorStubComponent => {
    const debugElement = fixture.debugElement.query(
      By.directive(CodeEditorStubComponent),
    );
    const instance = debugElement.componentInstance as CodeEditorStubComponent;
    Object.defineProperty(fixture.componentInstance, 'editor', {
      value: instance,
      configurable: true,
    });
    return instance;
  };

  it('keeps raw CRLF bytes on initial render without emitting a source change', () => {
    const source = "SeLeCt @CustomerId, 'unfinished\r\n-- untouched";
    const changed = vi.fn();
    fixture.componentInstance.textChange.subscribe(changed);
    fixture.componentRef.setInput('text', source);
    fixture.detectChanges();

    expect(editor().root).toBe(document);
    expect(getRawSource(editor().view.state)).toBe(source);
    expect(editor().view.state.sliceDoc()).toBe(
      "SeLeCt @CustomerId, 'unfinished\n-- untouched",
    );
    expect(
      fixture.nativeElement
        .querySelector('.author-code-label')
        .textContent.trim(),
    ).toBe('TugQL · Query');
    expect(changed).not.toHaveBeenCalled();
  });

  it('shows a touch suggestions control only for editable TugQL', () => {
    fixture.detectChanges();
    let suggestions = fixture.nativeElement.querySelector(
      '.author-code-suggestions',
    ) as HTMLButtonElement;
    expect(suggestions).not.toBeNull();
    expect(suggestions.getAttribute('aria-label')).toBe(
      'Suggestions (Ctrl+Space)',
    );
    expect(suggestions.disabled).toBe(false);

    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    suggestions = fixture.nativeElement.querySelector(
      '.author-code-suggestions',
    ) as HTMLButtonElement;
    expect(suggestions.disabled).toBe(true);

    fixture.componentRef.setInput('readOnly', false);
    fixture.componentRef.setInput('language', 'SQL');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.author-code-suggestions'),
    ).toBeNull();
  });

  it('renders accessible source-location actions and a remainder count', () => {
    const source = 'from Invoice\nselect InvoiceId';
    const diagnostics = Array.from({ length: 7 }, (_, index) => ({
      code: `error_${index}`,
      message: `problem ${index}`,
      span: {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 7 },
      },
    }));
    fixture.componentRef.setInput('text', source);
    fixture.detectChanges();
    const editorComponent = fixture.componentInstance;
    const host = document.createElement('div');
    fixture.nativeElement.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [history(), ...editorComponent.instance().extensions],
      }),
      parent: host,
    });
    Object.defineProperty(editorComponent, 'editor', {
      value: { view },
      configurable: true,
    });
    fixture.componentRef.setInput('formatDiagnostics', diagnostics.slice(0, 5));
    fixture.componentRef.setInput('remainingFormatDiagnosticCount', 2);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll(
      '.author-format-diagnostic',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons).toHaveLength(5);
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[0].getAttribute('aria-label')).toBe(
      'Go to line 2, column 1: problem 0',
    );
    expect(
      fixture.nativeElement.querySelector('.author-format-diagnostic-more')
        .textContent,
    ).toContain('2 more diagnostics');
    view.destroy();
  });

  it('keeps CRLF bytes and the caret when a user edit is echoed back through the text input', () => {
    const source = 'select InvoiceId\r\nfrom Invoice';
    fixture.componentRef.setInput('text', source);
    fixture.detectChanges();
    const changed: string[] = [];
    const eventOrder: string[] = [];
    fixture.componentInstance.textChange.subscribe((value) => {
      changed.push(value);
      eventOrder.push('component');
      fixture.componentRef.setInput('text', value);
    });

    const codeEditor = editor();
    const cursor = codeEditor.view.state.doc.length;
    const insertion = '\r\n-- edited';
    const insertedDocumentLength = insertion.replace(
      /\r\n|\r|\n/gu,
      '\n',
    ).length;
    codeEditor.change.subscribe(() => eventOrder.push('wrapped-change'));
    codeEditor.view.dispatch({
      changes: { from: cursor, insert: insertion },
      selection: { anchor: cursor + insertedDocumentLength },
    });
    fixture.detectChanges();

    expect(changed).toEqual([source + insertion]);
    expect(eventOrder).toEqual(['component', 'wrapped-change']);
    expect(getRawSource(codeEditor.view.state)).toBe(source + insertion);
    expect(codeEditor.view.state.selection.main.head).toBe(
      cursor + insertedDocumentLength,
    );
    expect(fixture.componentInstance.instance().generation).toBe(1);
  });

  it('navigates a mounted CodeMirror editor by Unicode-scalar positions without changing source or history', () => {
    const source = 'a😀e\u0301\t\r\ncrlf\rlone\nlast';
    fixture.componentRef.setInput('text', source);
    fixture.detectChanges();
    const editorComponent = fixture.componentInstance;
    const host = document.createElement('div');
    fixture.nativeElement.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [history(), ...editorComponent.instance().extensions],
      }),
      parent: host,
    });
    Object.defineProperty(editorComponent, 'editor', {
      value: { view },
      configurable: true,
    });
    const emitted = vi.fn();
    editorComponent.textChange.subscribe(emitted);
    const sourceBefore = getRawSource(view.state);
    const historyBefore = undoDepth(view.state);
    const diagnostic = {
      code: 'test_position',
      message: 'test location',
      span: {
        start: { line: 1, column: 3 },
        end: { line: 1, column: 5 },
      },
    } as const;

    expect(editorComponent.navigateToFormatDiagnostic(source, diagnostic)).toBe(true);
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.state.selection.main.anchor).toBe(3);
    expect(view.state.selection.main.head).toBe(3);
    expect(view.state.doc.line(1).from).toBe(0);
    expect(view.state.doc.line(2).text).toBe('crlf');
    expect(view.state.doc.line(3).text).toBe('lone');
    expect(view.state.doc.line(4).text).toBe('last');
    for (const [line, column, offset] of [
      [1, 5, 5],
      [1, 6, 6],
      [2, 5, 11],
      [3, 5, 16],
      [4, 5, 21],
    ] as const) {
      const location = {
        code: 'test_position',
        message: 'test location',
        span: {
          start: { line, column },
          end: { line, column },
        },
      } as const;
      expect(
        editorComponent.navigateToFormatDiagnostic(source, location),
      ).toBe(true);
      expect(view.state.selection.main.anchor).toBe(offset);
      expect(view.state.selection.main.head).toBe(offset);
    }
    expect(getRawSource(view.state)).toBe(sourceBefore);
    expect(undoDepth(view.state)).toBe(historyBefore);
    expect(emitted).not.toHaveBeenCalled();
    view.destroy();
  });

  it('rejects invalid spans and stale, disabled, read-only, or disconnected editor navigation', () => {
    const source = 'one\r\ntwo\rthree';
    fixture.componentRef.setInput('text', source);
    fixture.detectChanges();
    const editorComponent = fixture.componentInstance;
    const host = document.createElement('div');
    fixture.nativeElement.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [history(), ...editorComponent.instance().extensions],
      }),
      parent: host,
    });
    Object.defineProperty(editorComponent, 'editor', {
      value: { view },
      configurable: true,
    });
    const valid = {
      code: 'valid',
      message: 'valid',
      span: {
        start: { line: 2, column: 2 },
        end: { line: 2, column: 3 },
      },
    } as const;
    const invalidEnd = {
      ...valid,
      span: { ...valid.span, end: { line: 4, column: 1 } },
    } as const;
    const invalidColumn = {
      ...valid,
      span: { ...valid.span, start: { line: 2, column: 99 } },
    } as const;

    expect(sourceSpanIsValid(source, valid.span)).toBe(true);
    expect(sourceSpanIsValid(source, invalidEnd.span)).toBe(false);
    expect(sourceSpanIsValid(source, invalidColumn.span)).toBe(false);
    expect(editorComponent.navigateToFormatDiagnostic(source, invalidEnd)).toBe(false);
    expect(editorComponent.navigateToFormatDiagnostic(`${source} `, valid)).toBe(false);

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(editorComponent.navigateToFormatDiagnostic(source, valid)).toBe(false);
    fixture.componentRef.setInput('disabled', false);
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    expect(editorComponent.navigateToFormatDiagnostic(source, valid)).toBe(false);
    fixture.componentRef.setInput('readOnly', false);
    fixture.detectChanges();
    view.dispatch({
      effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
    });
    expect(editorComponent.navigateToFormatDiagnostic(source, valid)).toBe(false);
    host.remove();
    expect(editorComponent.navigateToFormatDiagnostic(source, valid)).toBe(false);
    view.destroy();

    const lockedHost = document.createElement('div');
    fixture.nativeElement.append(lockedHost);
    const lockedView = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [
          history(),
          ...editorComponent.instance().extensions,
          EditorView.editable.of(false),
        ],
      }),
      parent: lockedHost,
    });
    Object.defineProperty(editorComponent, 'editor', {
      value: { view: lockedView },
      configurable: true,
    });
    expect(editorComponent.navigateToFormatDiagnostic(source, valid)).toBe(false);
    lockedView.destroy();
  });

  it('validates both endpoints without clamping and accepts a real nonzero first-token span', () => {
    const source = 'select x';
    expect(
      sourceSpanIsValid(source, {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 7 },
      }),
    ).toBe(true);
    expect(
      sourceSpanIsValid(source, {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 10 },
      }),
    ).toBe(false);
    expect(
      sourceSpanIsValid(source, {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 1 },
      }),
    ).toBe(false);
  });

  it('retains mixed separators through edits and native undo/redo, including a prior character edit', () => {
    const source = 'a\r\nb\nc\r';
    const state = EditorState.create({
      doc: source,
      extensions: [history(), createRawSourceExtensions(source)],
    });
    const target: { state: EditorState; dispatch(transaction: Transaction): void } = {
      state,
      dispatch: (transaction) => (target.state = transaction.state),
    };
    const characterEdit = state.update({
      changes: { from: 2, to: 3, insert: 'B' },
    });
    target.dispatch(characterEdit);
    expect(getRawSource(target.state)).toBe('a\r\nB\nc\r');

    const separatorDeletion = target.state.update({ changes: { from: 1, to: 2 } });
    target.dispatch(separatorDeletion);
    expect(getRawSource(target.state)).toBe('aB\nc\r');

    expect(undo(target)).toBe(true);
    expect(getRawSource(target.state)).toBe('a\r\nB\nc\r');
    expect(undo(target)).toBe(true);
    expect(getRawSource(target.state)).toBe(source);
    expect(redo(target)).toBe(true);
    expect(getRawSource(target.state)).toBe('a\r\nB\nc\r');
    expect(redo(target)).toBe(true);
    expect(getRawSource(target.state)).toBe('aB\nc\r');
  });

  it('keeps original CRLF and applies the preferred separator to inserted multiline text', () => {
    const source = 'a\r\nb';
    const state = EditorState.create({
      doc: source,
      extensions: [history(), createRawSourceExtensions(source)],
    });
    const target: { state: EditorState; dispatch(transaction: Transaction): void } = {
      state,
      dispatch: (transaction) => (target.state = transaction.state),
    };
    target.dispatch(
      target.state.update({
        changes: { from: target.state.doc.length, insert: 'x\ny\n' },
      }),
    );
    expect(target.state.doc.lines).toBe(4);
    expect(getRawSource(target.state)).toBe('a\r\nbx\r\ny\r\n');
  });

  it('restores the exact separator after a native undo at the history-depth boundary', () => {
    const rows = Array.from({ length: 25 }, (_, index) => String(index));
    const separators = Array.from({ length: 24 }, (_, index) =>
      index % 2 ? '\n' : '\r\n',
    );
    const source = rows.reduce(
      (result, row, index) =>
        result + (index ? separators[index - 1] : '') + row,
      '',
    );
    const state = EditorState.create({
      doc: source,
      extensions: [history({ minDepth: 3 }), createRawSourceExtensions(source)],
    });
    const target: { state: EditorState; dispatch(transaction: Transaction): void } = {
      state,
      dispatch: (transaction) => (target.state = transaction.state),
    };
    for (let index = 0; index < 24; index++) {
      const firstBreak = target.state.doc.toString().indexOf('\n');
      target.dispatch(
        target.state.update({ changes: { from: firstBreak, to: firstBreak + 1 } }),
      );
      expect(getRawSource(target.state).length).toBeGreaterThan(0);
    }
    const retainedEvents = undoDepth(target.state);
    const cutoff = 24 - retainedEvents;
    const expected =
      rows.slice(0, cutoff + 1).join('') +
      rows
        .slice(cutoff + 1)
        .map((row, index) => separators[cutoff + index] + row)
        .join('');
    for (let index = 0; index < retainedEvents; index++) expect(undo(target)).toBe(true);
    expect(getRawSource(target.state)).toBe(expected);
  });

  it('passes the read-only SQL mode and shared language registry to the editor', () => {
    fixture.componentRef.setInput(
      'text',
      'SELECT "InvoiceId" FROM Invoice WHERE InvoiceId = ?1',
    );
    fixture.componentRef.setInput('label', 'Compiled SQLite SQL');
    fixture.componentRef.setInput('language', 'SQL');
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();

    const codeEditor = editor();
    expect(codeEditor.language).toBe('SQL');
    expect(codeEditor.readonly).toBe(true);
    expect(codeEditor.languages).toEqual(fixture.componentInstance.languages);
    expect(
      fixture.nativeElement
        .querySelector('.author-code-label')
        .textContent.trim(),
    ).toBe('Compiled SQLite SQL');
  });
});
