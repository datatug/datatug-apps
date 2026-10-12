import {
  EditorState,
  StateEffect,
  StateField,
  type ChangeSet,
  type Extension,
  type Text,
  Transaction,
  Prec,
} from '@codemirror/state';
import { invertedEffects, isolateHistory } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';

export interface RawSourceOptions {
  /** Keep the clipboard's original CRLF/CR/LF separators in emitted source. */
  readonly preservePastedLineEndings?: boolean;
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
export const createRawSourceExtensions = (
  source: string,
  options: RawSourceOptions = {},
): Extension[] => {
  const separators = encodeLineEndings(source);
  const field = rawSourceField.init(() => separators);
  let pendingClipboard:
    | { readonly state: EditorState; readonly text: string }
    | undefined;
  const extensions: Extension[] = [
    field,
    invertedEffects.of((transaction) => {
      const before = transaction.startState.field(rawSourceField);
      const after = applyRawSourceTransaction(before, transaction);
      if (options.preservePastedLineEndings) {
        return separatorHistoryEffects(transaction, before).map((inverse) =>
          separatorPatchEffect.of(inverse),
        );
      }
      const inverse = separatorHistoryEffect(before, after, transaction.newDoc);
      return inverse ? [separatorPatchEffect.of(inverse)] : [];
    }),
    EditorState.transactionExtender.of((transaction) => {
      const annotations = changesLineBreaks(transaction)
        ? isolateHistory.of('full')
        : undefined;
      const pasteEffects =
        options.preservePastedLineEndings &&
        transaction.annotation(Transaction.userEvent) === 'input.paste' &&
        pendingClipboard?.state === transaction.startState
          ? clipboardSeparatorEffects(transaction, pendingClipboard.text)
          : [];
      if (!annotations && pasteEffects.length === 0) return null;
      return {
        ...(annotations ? { annotations } : {}),
        effects: pasteEffects,
      };
    }),
  ];
  if (options.preservePastedLineEndings) {
    extensions.push(
      Prec.highest(
        EditorView.domEventHandlers({
          paste: (event, view) => {
            const clipboard = (event as ClipboardEvent).clipboardData;
            if (
              !clipboard ||
              !Array.from(clipboard.types).includes('text/plain') ||
              view.state.facet(EditorState.readOnly) ||
              !view.state.facet(EditorView.editable)
            ) {
              return false;
            }
            const pending = {
              state: view.state,
              text: clipboard.getData('text/plain'),
            };
            pendingClipboard = pending;
            queueMicrotask(() => {
              if (pendingClipboard === pending) pendingClipboard = undefined;
            });
            // Observe the exact clipboard bytes, then let CodeMirror's native
            // handler distribute lines and preserve its selection behavior.
            return false;
          },
        }),
      ),
    );
  }
  return extensions;
};

const clipboardSeparatorEffects = (
  transaction: Transaction,
  clipboardText: string,
): StateEffect<SeparatorPatch>[] => {
  const normalized = clipboardText.replace(/\r\n?/gu, '\n');
  const rawSeparators = encodeLineEndings(clipboardText);
  const defaultSeparator = transaction.startState.field(rawSourceField)[0] ?? 0;
  const insertedEffects: StateEffect<SeparatorPatch>[] = [];
  const nextDoc = transaction.changes.apply(transaction.startState.doc);
  const mappedSeparators = applyRawSourceTransaction(
    transaction.startState.field(rawSourceField),
    transaction,
  );
  transaction.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
    const insertedText = inserted.toString();
    let separators = rawSeparators;
    if (insertedText === `${normalized}${transaction.startState.lineBreak}`) {
      // CodeMirror appends the editor's preferred separator for linewise
      // copies; retain clipboard breaks and the generated break separately.
      separators = Uint8Array.from([...rawSeparators, defaultSeparator]);
    } else if (insertedText !== normalized) {
      // CodeMirror may distribute a multi-line paste across selections. Such
      // individual line fragments contain no source separators to preserve.
      return;
    }
    if (separators.length === 0) return;
    const insertedBreaks = insertedText.match(/\n/gu)?.length ?? 0;
    if (insertedBreaks !== separators.length) return;
    const patch: SeparatorPatch = {
      at: fromB,
      removeCount: insertedBreaks,
      insert: separators,
    };
    const index = nextDoc.lineAt(fromB).number - 1;
    const current = mappedSeparators.slice(index, index + insertedBreaks);
    if (
      current.length !== separators.length ||
      current.some((separator, item) => separator !== separators[item])
    ) {
      insertedEffects.push(separatorPatchEffect.of(patch));
    }
    // Avoid a malformed transaction span accidentally indexing beyond its
    // resulting document. The standard paste path always supplies valid
    // mapped offsets, so this is a defensive consistency check.
    if (fromB > toB || toB > nextDoc.length) {
      throw new Error('Native SQL paste produced an invalid mapped range.');
    }
  });

  // A replacement can normalize to identical CodeMirror text while changing
  // only the original CR/LF byte sequence. Preserve that as a metadata effect.
  if (transaction.changes.empty && rawSeparators.length > 0) {
    for (const range of transaction.startState.selection.ranges) {
      if (
        transaction.startState.sliceDoc(range.from, range.to) !== normalized
      ) {
        continue;
      }
      const index = transaction.startState.doc.lineAt(range.from).number - 1;
      const current = transaction.startState
        .field(rawSourceField)
        .slice(index, index + rawSeparators.length);
      if (
        current.length !== rawSeparators.length ||
        current.some((separator, item) => separator !== rawSeparators[item])
      ) {
        insertedEffects.push(
          separatorPatchEffect.of({
            at: range.from,
            removeCount: rawSeparators.length,
            insert: rawSeparators,
          }),
        );
      }
    }
  }
  return insertedEffects;
};

export const getRawSource = (state: EditorState): string => {
  const separators = state.field(rawSourceField, false);
  if (!separators) return state.sliceDoc();
  if (separators.length !== state.doc.lines - 1) {
    throw new Error(
      'Code editor newline metadata is out of sync with its document.',
    );
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
  const patches = transaction.effects
    .filter((effect) => effect.is(separatorPatchEffect))
    .map((effect) => effect.value)
    .sort((left, right) => right.at - left.at);
  for (const patch of patches) {
    const index = Math.max(
      0,
      Math.min(
        transaction.newDoc.lines - 1,
        transaction.newDoc.lineAt(patch.at).number - 1,
      ),
    );
    next = splice(next, index, patch.removeCount, patch.insert);
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
    while (oldBreak < firstAffected)
      next.push(current[oldBreak++] ?? defaultSeparator);
    const oldAfter = startDoc.lineAt(to).number - 1;
    const insertedBreaks = (inserted.toString().match(/\n/gu) ?? []).length;
    for (let count = 0; count < insertedBreaks; count++)
      next.push(defaultSeparator);
    oldBreak = Math.max(oldBreak, oldAfter);
  });
  while (oldBreak < current.length)
    next.push(current[oldBreak++] ?? defaultSeparator);
  return Uint8Array.from(next);
};

const separatorHistoryEffect = (
  before: Uint8Array,
  after: Uint8Array,
  beforeDoc: Text,
): SeparatorPatch | undefined => {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  if (prefix === before.length && prefix === after.length) return undefined;
  // Inverted effects are mapped through the inverse document change when
  // history applies them. Anchor the patch in the forward transaction's
  // starting document so that mapping lands in the undo transaction's result.
  const at = beforeDoc.line(prefix + 1).from;
  return {
    at,
    // The inverse document change reinserts the separators removed by this
    // transaction. Replace those new default separators with their raw forms.
    removeCount:
      prefix === before.length && prefix === after.length
        ? 0
        : before.length - prefix - suffix,
    insert: before.slice(prefix, before.length - suffix),
  };
};

/**
 * Build inverse metadata patches from changed document spans, not separator
 * byte equality. Equal line-ending bytes can move across an insertion, so an
 * LCP/suffix diff cannot identify the edited location reliably.
 */
const separatorHistoryEffects = (
  transaction: Transaction,
  before: Uint8Array,
): SeparatorPatch[] => {
  const patches: SeparatorPatch[] = [];
  if (transaction.changes.empty) {
    for (const effect of transaction.effects) {
      if (!effect.is(separatorPatchEffect)) continue;
      const patch = effect.value;
      const index = transaction.startState.doc.lineAt(patch.at).number - 1;
      patches.push({
        at: patch.at,
        removeCount: patch.insert.length,
        insert: before.slice(index, index + patch.removeCount),
      });
    }
    return patches.sort((left, right) => right.at - left.at);
  }
  transaction.changes.iterChanges((fromA, toA) => {
    const start = transaction.startState.doc.lineAt(fromA).number - 1;
    const end = transaction.startState.doc.lineAt(toA).number - 1;
    const removeCount = Math.max(0, end - start);
    if (!removeCount) return;
    patches.push({
      at: fromA,
      removeCount,
      insert: before.slice(start, start + removeCount),
    });
  });
  return patches.sort((left, right) => right.at - left.at);
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
