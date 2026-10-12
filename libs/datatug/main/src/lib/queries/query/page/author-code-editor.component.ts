import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  OnChanges,
  SimpleChanges,
  ViewChild,
  input,
  inject,
  output,
  signal,
} from '@angular/core';
import { addIcons } from 'ionicons';
import { ellipsisHorizontal } from 'ionicons/icons';
import { CodeEditor } from '@acrodata/code-editor';
import { closeCompletion, startCompletion } from '@codemirror/autocomplete';
import type { TugQLDiagnostic, TugQLSpan } from '@dalgo/core';
import { EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import {
  createRawSourceExtensions,
  getRawSource,
} from '../../../components/code-editor/raw-source';
export {
  createRawSourceExtensions,
  getRawSource,
} from '../../../components/code-editor/raw-source';
import {
  createTugqlEditorExtensions,
  TUGQL_LANGUAGE_DESCRIPTIONS,
} from './tugql-syntax';
import { createTugqlCompletionExtension } from './tugql-completion';
import {
  IonButton,
  IonButtons,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPopover,
} from '@ionic/angular';

addIcons({ ellipsisHorizontal });

let authorCodeEditorId = 0;

interface EditorInstance {
  readonly generation: number;
  readonly value: string;
  readonly language: string;
  readonly extensions: ReturnType<typeof createTugqlEditorExtensions>;
}

@Component({
  selector: 'sneat-author-code-editor',
  templateUrl: './author-code-editor.component.html',
  styleUrl: './author-code-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CodeEditor,
    IonButton,
    IonButtons,
    IonItem,
    IonLabel,
    IonList,
    IonNote,
    IonPopover,
  ],
})
export class AuthorCodeEditorComponent implements OnChanges, AfterViewInit {
  public readonly toolsTriggerId = `author-code-tools-trigger-${++authorCodeEditorId}`;
  public readonly editorRoot = inject(DOCUMENT);
  public readonly text = input('');
  public readonly label = input('TugQL Query');
  public readonly language = input<'TugQL' | 'SQL'>('TugQL');
  public readonly readOnly = input(false);
  public readonly disabled = input(false);
  public readonly visible = input(true);
  public readonly formatDiagnostics = input<readonly TugQLDiagnostic[]>([]);
  public readonly remainingFormatDiagnosticCount = input(0);
  public readonly canFormat = input(false);
  public readonly canUndoFormat = input(false);
  public readonly textChange = output<string>();
  public readonly formatDiagnosticRequested = output<TugQLDiagnostic>();
  public readonly formatRequested = output<void>();
  public readonly undoFormatRequested = output<void>();

  public readonly languages = TUGQL_LANGUAGE_DESCRIPTIONS;
  public readonly instance = signal<EditorInstance>({
    generation: 0,
    value: '',
    language: 'TugQL',
    extensions: createTugqlEditorExtensions('TugQL source'),
  });

  @ViewChild(CodeEditor) private editor?: CodeEditor;
  @ViewChild(IonPopover) private toolsPopover?: IonPopover;

  private viewReady = false;
  private pendingMenuAction?: 'format' | 'undo' | 'suggestions';

  public selectMenuAction(action: 'format' | 'undo' | 'suggestions'): void {
    this.pendingMenuAction = action;
  }

  public menuDidDismiss(): void {
    const action = this.pendingMenuAction;
    this.pendingMenuAction = undefined;
    if (!action || !this.visible() || this.language() !== 'TugQL') return;
    if (action === 'format' && this.canFormat() && !this.disabled())
      this.formatRequested.emit();
    if (action === 'undo' && this.canUndoFormat() && !this.disabled())
      this.undoFormatRequested.emit();
    if (action === 'suggestions') {
      queueMicrotask(() => this.requestSuggestions());
    }
  }
  public ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['visible']?.currentValue === false ||
      (changes['language'] && this.language() !== 'TugQL')
    ) {
      this.pendingMenuAction = undefined;
      if (this.toolsPopover?.isOpen) void this.toolsPopover.dismiss();
    }
    if (changes['visible']?.currentValue === true) {
      // CodeMirror measures its layout while mounted. Ask it to remeasure after
      // the hidden pane has become visible without replacing its editor state.
      queueMicrotask(() => this.editor?.view.requestMeasure());
    }
    if (!this.viewReady) {
      this.replaceInstance(this.text());
      return;
    }

    const textChangedExternally =
      changes['text'] &&
      this.editor &&
      getRawSource(this.editor.view.state) !== this.text();
    const editorConfigurationChanged = changes['label'] || changes['language'];
    if (
      (changes['readOnly'] || changes['disabled']) &&
      (this.readOnly() || this.disabled())
    ) {
      const view = this.editor?.view;
      if (view) closeCompletion(view);
    }
    if (textChangedExternally || editorConfigurationChanged) {
      this.replaceInstance(this.text());
    }
  }

  public ngAfterViewInit(): void {
    this.viewReady = true;
  }

  public requestSuggestions(): void {
    if (
      !this.visible() ||
      this.language() !== 'TugQL' ||
      this.readOnly() ||
      this.disabled()
    )
      return;
    const view = this.editor?.view;
    if (!view) return;
    view.focus();
    startCompletion(view);
  }

  public isFormatDiagnosticNavigable(source: string, span: TugQLSpan): boolean {
    const view = this.editor?.view;
    return (
      this.language() === 'TugQL' &&
      !this.readOnly() &&
      !this.disabled() &&
      !view?.state.facet(EditorState.readOnly) &&
      view?.state.facet(EditorView.editable) !== false &&
      !!view?.dom.isConnected &&
      view.contentDOM.isConnected &&
      getRawSource(view.state) === source &&
      sourceSpanIsValid(source, span) &&
      editorSpanOffsets(view.state, span) !== undefined
    );
  }

  public navigateToFormatDiagnostic(
    source: string,
    diagnostic: TugQLDiagnostic,
  ): boolean {
    if (!this.isFormatDiagnosticNavigable(source, diagnostic.span))
      return false;
    const view = this.editor?.view;
    const offsets = view && editorSpanOffsets(view.state, diagnostic.span);
    if (
      !view ||
      !offsets ||
      !view.dom.isConnected ||
      !view.contentDOM.isConnected
    )
      return false;
    view.focus();
    view.dispatch({
      selection: { anchor: offsets.from, head: offsets.from },
      effects: EditorView.scrollIntoView(offsets.from, { y: 'center' }),
      annotations: Transaction.addToHistory.of(false),
    });
    return true;
  }

  private replaceInstance(value: string): void {
    const extensions = createTugqlEditorExtensions(this.label());
    if (this.language() === 'TugQL') {
      extensions.push(
        createTugqlCompletionExtension(
          () =>
            this.language() === 'TugQL' && !this.readOnly() && !this.disabled(),
        ),
      );
    }
    extensions.push(...createRawSourceExtensions(value));
    extensions.push(
      Prec.highest(
        EditorView.updateListener.of((update) => this.captureUpdate(update)),
      ),
    );
    this.instance.update((current) => ({
      generation: current.generation + 1,
      value,
      language: this.language(),
      extensions,
    }));
  }

  private captureUpdate(update: ViewUpdate): void {
    if (!update.docChanged) return;
    this.textChange.emit(getRawSource(update.state));
  }
}

/** Validate one-based Unicode-scalar source positions without normalizing bytes. */
export const createSourceSpanValidator = (
  source: string,
): ((span: TugQLSpan) => boolean) => {
  const scalarLengths = source
    .split(/\r\n|\r|\n/u)
    .map((line) => [...line].length);
  const positionIsValid = (position: TugQLSpan['start']): boolean =>
    Number.isInteger(position.line) &&
    Number.isInteger(position.column) &&
    position.line >= 1 &&
    position.column >= 1 &&
    position.line <= scalarLengths.length &&
    position.column <= scalarLengths[position.line - 1] + 1;
  return (span) =>
    positionIsValid(span.start) &&
    positionIsValid(span.end) &&
    (span.end.line > span.start.line ||
      (span.end.line === span.start.line &&
        span.end.column >= span.start.column));
};
export const sourceSpanIsValid = (source: string, span: TugQLSpan): boolean =>
  createSourceSpanValidator(source)(span);

const editorSpanOffsets = (
  state: EditorState,
  span: TugQLSpan,
): { readonly from: number; readonly to: number } | undefined => {
  const from = editorPositionOffset(state, span.start);
  const to = editorPositionOffset(state, span.end);
  return from === undefined || to === undefined || to < from
    ? undefined
    : { from, to };
};

const editorPositionOffset = (
  state: EditorState,
  position: TugQLSpan['start'],
): number | undefined => {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.column))
    return undefined;
  if (
    position.line < 1 ||
    position.line > state.doc.lines ||
    position.column < 1
  )
    return undefined;
  const line = state.doc.line(position.line);
  const scalars = [...line.text];
  if (position.column > scalars.length + 1) return undefined;
  const utf16Offset = scalars.slice(0, position.column - 1).join('').length;
  return line.from + utf16Offset;
};
