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
import { CodeEditor } from '@acrodata/code-editor';
import { closeCompletion, startCompletion } from '@codemirror/autocomplete';
import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type ChangeSet,
  type Extension,
  type Text,
  type Transaction,
} from '@codemirror/state';
import { invertedEffects, isolateHistory } from '@codemirror/commands';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import {
  createTugqlEditorExtensions,
  TUGQL_LANGUAGE_DESCRIPTIONS,
} from './tugql-syntax';
import { createTugqlCompletionExtension } from './tugql-completion';

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
  imports: [CodeEditor],
})
export class AuthorCodeEditorComponent implements OnChanges, AfterViewInit {
  public readonly editorRoot = inject(DOCUMENT);
  public readonly text = input('');
  public readonly label = input('TugQL · Query');
  public readonly language = input<'TugQL' | 'SQL'>('TugQL');
  public readonly readOnly = input(false);
  public readonly disabled = input(false);
  public readonly textChange = output<string>();

  public readonly languages = TUGQL_LANGUAGE_DESCRIPTIONS;
  public readonly instance = signal<EditorInstance>({
    generation: 0,
    value: '',
    language: 'TugQL',
    extensions: createTugqlEditorExtensions('TugQL source'),
  });

  @ViewChild(CodeEditor) private editor?: CodeEditor;

  private viewReady = false;
  public ngOnChanges(changes: SimpleChanges): void {
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
    if (this.language() !== 'TugQL' || this.readOnly() || this.disabled()) return;
    const view = this.editor?.view;
    if (!view) return;
    view.focus();
    startCompletion(view);
  }

  private replaceInstance(value: string): void {
    const extensions = createTugqlEditorExtensions(this.label());
    if (this.language() === 'TugQL') {
      extensions.push(
        createTugqlCompletionExtension(
          () => this.language() === 'TugQL' && !this.readOnly() && !this.disabled(),
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

interface SeparatorPatch {
  /** Model offset in the transaction's document before the patch is applied. */
  readonly at: number;
  readonly removeCount: number;
  readonly insert: Uint8Array;
}

const separatorPatchEffect = StateEffect.define<SeparatorPatch>({
  map: (patch, mapping) => ({ ...patch, at: mapping.mapPos(patch.at, -1) }),
});

const rawSourceField = StateField.define<Uint8Array>({
  create: () => new Uint8Array(),
  update: (separators, transaction) =>
    applyRawSourceTransaction(separators, transaction),
});

/** Keep separator metadata in CodeMirror state so native undo bounds its lifetime. */
export const createRawSourceExtensions = (source: string): Extension[] => {
  const separators = encodeLineEndings(source);
  const field = rawSourceField.init(() => separators);
  return [
    field,
    invertedEffects.of((transaction) => {
      const before = transaction.startState.field(rawSourceField);
      const after = applyRawSourceTransaction(before, transaction);
      const inverse = separatorHistoryEffect(
        before,
        after,
        transaction.newDoc,
      );
      return inverse ? [separatorPatchEffect.of(inverse)] : [];
    }),
    EditorState.transactionExtender.of((transaction) =>
      changesLineBreaks(transaction)
        ? { annotations: isolateHistory.of('full') }
        : null,
    ),
  ];
};

export const getRawSource = (state: EditorState): string => {
  const separators = state.field(rawSourceField, false);
  if (!separators) return state.sliceDoc();
  if (separators.length !== state.doc.lines - 1) {
    throw new Error('Code editor newline metadata is out of sync with its document.');
  }
  return restoreLineEndings(state.doc.toString(), separators);
};

const encodeLineEndings = (source: string): Uint8Array =>
  Uint8Array.from(
    [...source.matchAll(/\r\n|\r|\n/gu)].map((match) =>
      match[0] === '\r\n' ? 2 : match[0] === '\r' ? 1 : 0,
    ),
  );

const restoreLineEndings = (model: string, separators: Uint8Array): string => {
  let output = '';
  let modelStart = 0;
  let separatorIndex = 0;
  for (let index = 0; index < model.length; index++) {
    if (model[index] !== '\n') continue;
    output += model.slice(modelStart, index);
    const separator = separators[separatorIndex];
    if (separator === undefined) {
      throw new Error('Code editor newline metadata is incomplete.');
    }
    output += separatorText(separator);
    separatorIndex++;
    modelStart = index + 1;
  }
  return output + model.slice(modelStart);
};

const separatorText = (separator: number): string =>
  separator === 2 ? '\r\n' : separator === 1 ? '\r' : '\n';

const changesLineBreaks = (transaction: Transaction): boolean => {
  if (!transaction.docChanged) return false;
  let changesBreak = false;
  transaction.changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
    if (
      transaction.startState.doc.sliceString(from, to).includes('\n') ||
      inserted.toString().includes('\n')
    ) {
      changesBreak = true;
    }
  });
  return changesBreak;
};

const applyRawSourceTransaction = (
  current: Uint8Array,
  transaction: Transaction,
): Uint8Array => {
  let next = changesLineBreaks(transaction)
    ? mapLineBreaks(current, transaction.changes, transaction.startState.doc)
    : current;
  for (const effect of transaction.effects) {
    if (!effect.is(separatorPatchEffect)) continue;
    const index = Math.max(
      0,
      Math.min(transaction.newDoc.lines - 1, transaction.newDoc.lineAt(effect.value.at).number - 1),
    );
    next = splice(next, index, effect.value.removeCount, effect.value.insert);
  }
  return next;
};

const mapLineBreaks = (
  current: Uint8Array,
  changes: ChangeSet,
  startDoc: Text,
): Uint8Array => {
  const next: number[] = [];
  let oldBreak = 0;
  const defaultSeparator = current[0] ?? 0;
  changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
    const firstAffected = startDoc.lineAt(from).number - 1;
    while (oldBreak < firstAffected) next.push(current[oldBreak++] ?? defaultSeparator);
    const oldAfter = startDoc.lineAt(to).number - 1;
    const insertedBreaks = (inserted.toString().match(/\n/gu) ?? []).length;
    for (let count = 0; count < insertedBreaks; count++) next.push(defaultSeparator);
    oldBreak = Math.max(oldBreak, oldAfter);
  });
  while (oldBreak < current.length) next.push(current[oldBreak++] ?? defaultSeparator);
  return Uint8Array.from(next);
};

const separatorHistoryEffect = (
  before: Uint8Array,
  after: Uint8Array,
  afterDoc: Text,
): SeparatorPatch | undefined => {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix++;
  if (prefix === before.length && prefix === after.length) return undefined;
  const at = afterDoc.line(prefix + 1).from;
  return {
    at,
    // The inverse document change reinserts the separators removed by this
    // transaction. Replace those new default separators with their raw forms.
    removeCount: prefix === before.length && prefix === after.length ? 0 :
      before.length - prefix - suffix,
    insert: before.slice(prefix, before.length - suffix),
  };
};

const splice = (
  source: Uint8Array,
  index: number,
  removeCount: number,
  insert: Uint8Array,
): Uint8Array => {
  const result = new Uint8Array(source.length - removeCount + insert.length);
  result.set(source.slice(0, index));
  result.set(insert, index);
  result.set(source.slice(index + removeCount), index + insert.length);
  return result;
};
