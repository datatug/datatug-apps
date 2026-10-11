import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EditorState, type Extension, type Transaction } from '@codemirror/state';
import { history, redo, undo, undoDepth } from '@codemirror/commands';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import {
  AuthorCodeEditorComponent,
  createRawSourceExtensions,
  getRawSource,
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
    contentDOM: {
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
