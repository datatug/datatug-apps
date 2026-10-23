import {
  AfterViewInit,
  ChangeDetectionStrategy,
  EventEmitter,
  Component,
  OnChanges,
  SimpleChanges,
  Output,
  input,
  inject,
  computed,
  signal,
  ViewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { CodeEditor } from '@acrodata/code-editor';
import { Prec } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import {
  createRawSourceExtensions,
  getRawSource,
} from '../code-editor/raw-source';
import {
  createSqlEditorExtensions,
  SQL_HASH_COMMENT_LANGUAGE_DESCRIPTIONS,
  SQL_LANGUAGE_DESCRIPTIONS,
} from './sql-language';

interface SqlEditorInstance {
  readonly generation: number;
  readonly value: string;
  readonly extensions: ReturnType<typeof createSqlEditorExtensions>;
}

@Component({
  selector: 'sneat-datatug-sql',
  templateUrl: './sql-editor.component.html',
  styleUrl: './sql-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CodeEditor],
})
export class SqlEditorComponent implements OnChanges, AfterViewInit {
  // TODO: Skipped for migration because:
  //  Your application code writes to the input. This prevents migration.
  readonly sql = input<string>();
  readonly lineNumbers = input(true);
  readonly readonly = input(true);
  readonly disabled = input(false);
  readonly autoCloseBrackets = input(true);
  /** Treat `#` as a line comment too (saved TugQL YAML sources). */
  readonly hashComments = input(false);
  /** Accessible name of the editable text (CodeMirror's content element). */
  readonly ariaLabel = input('SQL query');

  @Output() sqlChanged = new EventEmitter<string>();

  readonly editorRoot = inject(DOCUMENT);
  readonly languages = computed(() =>
    this.hashComments()
      ? SQL_HASH_COMMENT_LANGUAGE_DESCRIPTIONS
      : SQL_LANGUAGE_DESCRIPTIONS,
  );
  readonly instance = signal<SqlEditorInstance>({
    generation: 0,
    value: '',
    extensions: createSqlEditorExtensions(
      this.ariaLabel(),
      this.autoCloseBrackets(),
    ),
  });

  @ViewChild(CodeEditor) private editor?: CodeEditor;
  private viewReady = false;

  ngOnChanges(changes: SimpleChanges): void {
    const value = this.sql() ?? '';
    if (!this.viewReady) {
      this.replaceInstance(value);
      return;
    }
    const textChangedExternally =
      changes['sql'] &&
      this.editor &&
      getRawSource(this.editor.view.state) !== value;
    if (
      textChangedExternally ||
      changes['lineNumbers'] ||
      changes['autoCloseBrackets'] ||
      changes['ariaLabel']
    ) {
      this.replaceInstance(value);
    }
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
  }

  public onSqlChanged(sql: string): void {
    this.sqlChanged.emit(sql);
  }

  private replaceInstance(value: string): void {
    const extensions = createSqlEditorExtensions(
      this.ariaLabel(),
      this.autoCloseBrackets(),
    );
    extensions.push(
      ...createRawSourceExtensions(value, { preservePastedLineEndings: true }),
    );
    if (!this.lineNumbers()) {
      // CodeEditor basic setup enables line numbers by default. Keep the public
      // input meaningful without replacing its history or keyboard extensions.
      extensions.push(EditorView.theme({ '.cm-gutters': { display: 'none' } }));
    }
    extensions.push(
      Prec.highest(
        EditorView.updateListener.of((update) => this.captureUpdate(update)),
      ),
    );
    this.instance.update((current) => ({
      generation: current.generation + 1,
      value,
      extensions,
    }));
  }

  private captureUpdate(update: ViewUpdate): void {
    if (this.readonly() || this.disabled()) return;
    if (
      !update.docChanged &&
      !update.transactions.some((transaction) => transaction.effects.length > 0)
    ) {
      return;
    }
    const nextSource = getRawSource(update.state);
    if (nextSource === getRawSource(update.startState)) return;
    this.onSqlChanged(nextSource);
  }
}
