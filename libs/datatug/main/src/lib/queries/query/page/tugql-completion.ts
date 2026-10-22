import { parseTugQL } from '@dalgo/core';
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import {
  completionStatus,
  insertCompletionText,
  pickedCompletion,
} from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export type TugqlKeywordCase = 'lowercase' | 'uppercase';

const SUGGESTIONS = [
  'from',
  'join',
  'left',
  'on',
  'where',
  'group',
  'by',
  'having',
  'order',
  'limit',
  'offset',
  'select',
  'as',
  'and',
  'or',
  'not',
  'is',
  'null',
  'asc',
  'desc',
  'true',
  'false',
  'with',
  'parameters',
  'required',
  'default',
  'using',
  'integer',
  'decimal',
  'string',
  'boolean',
  'date',
  'datetime',
  'timestamp',
] as const;

const EMPTY_PREFIX_SUGGESTIONS = [
  'from',
  'where',
  'select',
  'join',
  'group',
  'order',
  'limit',
  'parameters',
] as const;

// This set mirrors DALgo's formatter role vocabulary only for case inference.
// It is deliberately wider than SUGGESTIONS, which is the parser-supported UI.
const FORMATTER_KEYWORDS = new Set([
  'from', 'join', 'left', 'on', 'where', 'group', 'by', 'having', 'order',
  'limit', 'offset', 'select', 'as', 'and', 'or', 'not', 'is', 'null',
  'asc', 'desc', 'true', 'false', 'with', 'parameters', 'required', 'default',
  'using', 'inner', 'outer', 'cross', 'distinct', 'exists', 'integer', 'int',
  'decimal', 'numeric', 'float', 'real', 'text', 'string', 'boolean', 'bool',
  'date', 'datetime', 'timestamp', 'time', 'json', 'uuid',
]);

export const TUGQL_COMPLETION_KEYWORDS: readonly string[] = SUGGESTIONS;

const WORD_CHAR = /^[\p{L}\p{N}\p{M}_$]$/u;

interface CodeMask {
  readonly code: string;
}

interface Prefix {
  readonly from: number;
  readonly text: string;
  readonly parameter: boolean;
}

/** Parser-backed completion, installed only by the editable TugQL component. */
export const createTugqlCompletionExtension = (
  enabled: () => boolean,
): Extension => {
  // Language-data providers are queried repeatedly. Keep a stable source
  // identity so CodeMirror does not discard an in-flight completion as stale.
  const source = createTugqlCompletionSource(enabled);
  return [
    EditorState.languageData.of(() => [{ autocomplete: source }]),
    EditorView.theme({
      '.cm-tooltip.cm-tooltip-autocomplete': {
        maxWidth: 'min(24rem, calc(100vw - 1rem))',
        backgroundColor: 'var(--ion-background-color, #ffffff)',
        color: 'var(--ion-color-dark, #1f2937)',
        border: '1px solid var(--ion-background-color-step-250, #cbd5e1)',
        boxShadow: '0 0.25rem 0.75rem rgb(15 23 42 / 22%)',
      },
      '.cm-tooltip.cm-tooltip-autocomplete ul': {
        maxWidth: '100%',
        maxHeight: 'min(16rem, 45vh)',
        overflowX: 'hidden',
        overflowY: 'auto',
        color: 'inherit',
      },
      '.cm-tooltip.cm-tooltip-autocomplete ul li': {
        maxWidth: '100%',
        padding: '0.4rem 0.75rem',
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
      },
      '.cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'var(--ion-color-primary, #1d4ed8)',
        color: 'var(--ion-color-primary-contrast, #ffffff)',
      },
      '.cm-tooltip.cm-tooltip-autocomplete .cm-completionLabel': {
        overflowWrap: 'anywhere',
      },
    }),
  ];
};

export const createTugqlCompletionSource = (
  enabled: () => boolean,
): CompletionSource =>
  (context): CompletionResult | null => {
    if (
      !enabled() ||
      (!context.explicit && completionStatus(context.state) !== 'active') ||
      context.view?.composing ||
      context.state.facet(EditorState.readOnly) ||
      !context.state.facet(EditorView.editable) ||
      context.state.selection.ranges.length !== 1 ||
      !context.state.selection.main.empty ||
      context.pos !== context.state.selection.main.head
    ) {
      return null;
    }

    const prefix = readPrefix(context);
    if (!prefix) return null;

    const keywordCase = inferKeywordCase(context.state.doc.toString());
    const apply = (option: Completion) =>
      (
        view: EditorView,
        completion: Completion,
        from: number,
        to: number,
      ): void => {
        if (
          !enabled() ||
          view.composing ||
          view.state.facet(EditorState.readOnly) ||
          !view.state.facet(EditorView.editable)
        ) {
          return;
        }
        view.dispatch({
          ...insertCompletionText(view.state, option.label, from, to),
          annotations: pickedCompletion.of(completion),
        });
      };
    const options: Completion[] = prefix.parameter
      ? declaredParameters(context.state.doc.toString()).map((name) => {
          const option: Completion = {
            label: name,
            type: 'variable',
            section: 'Declared parameters',
          };
          return { ...option, apply: apply(option) };
        })
      : (prefix.text ? SUGGESTIONS : EMPTY_PREFIX_SUGGESTIONS).map((word) => {
          const option: Completion = {
            label: applyCase(word, keywordCase),
            type: 'keyword',
            section: 'TugQL',
          };
          return { ...option, apply: apply(option) };
        });

    if (!options.length) return null;
    return {
      from: prefix.from,
      options,
      validFor: /^[\p{L}\p{N}\p{M}_$]*$/u,
    };
  };

export const inferKeywordCase = (source: string): TugqlKeywordCase => {
  const { code } = maskNonCode(source);
  const words = [...code.matchAll(/[\p{L}_$][\p{L}\p{N}\p{M}_$]*/gu)];
  for (const match of words) {
    const word = match[0];
    const folded = word.toLowerCase();
    if (!FORMATTER_KEYWORDS.has(folded)) continue;
    const start = match.index ?? 0;
    const previous = code.slice(0, start).trimEnd().at(-1);
    if (previous === '@') continue;
    if (previous === '.') continue;
    const next = code.slice(start + word.length).trimStart()[0];
    if (next === '(' && !['select', 'parameters', 'as'].includes(folded)) {
      continue;
    }
    if (word === word.toLowerCase()) return 'lowercase';
    if (word === word.toUpperCase()) return 'uppercase';
  }
  return 'lowercase';
};

/** Returns only declarations proven by DALgo's parser, including a closed leading block. */
export const declaredParameters = (source: string): string[] => {
  const parsed = parseTugQL(source);
  if (parsed.diagnostics.length === 0 && parsed.document.tree) {
    return (parsed.document.tree.parameters ?? []).map((parameter) => parameter.name);
  }

  const block = leadingParameterBlock(source);
  if (!block || containsLaterParameterDeclaration(source.slice(block.end))) return [];

  const separator = block.text.endsWith('\n') || block.text.endsWith('\r') ? '' : '\n';
  const synthetic = `${block.text}${separator}${applyCase(
    'from',
    inferKeywordCase(block.text),
  )} Dummy`;
  const isolated = parseTugQL(synthetic);
  if (isolated.diagnostics.length !== 0 || !isolated.document.tree) return [];
  return (isolated.document.tree.parameters ?? []).map((parameter) => parameter.name);
};

const readPrefix = (context: CompletionContext): Prefix | null => {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  const after = state.sliceDoc(pos, line.to);
  const masked = maskLine(before);
  const codeBefore = masked.code;
  const codeAfter = maskLine(after).code;

  if (masked.inComment || masked.quote || codeBefore.trimEnd().endsWith('.')) return null;
  if (WORD_CHAR.test(codeAfter[0] ?? '') || codeAfter[0] === '@') return null;

  const parameter = codeBefore.match(/@([\p{L}_][\p{L}\p{N}_]*)?$/u);
  if (parameter) {
    const at = parameter.index ?? 0;
    const preceding = codeBefore.slice(0, at).trimEnd();
    if (preceding.endsWith('.')) return null;
    return { from: line.from + at + 1, text: parameter[1] ?? '', parameter: true };
  }

  const word = codeBefore.match(/[\p{L}_$][\p{L}\p{N}\p{M}_$]*$/u);
  if (word) {
    const start = word.index ?? 0;
    const preceding = codeBefore.slice(0, start).trimEnd();
    if (
      codeBefore[start - 1] === '@' ||
      preceding.endsWith('.')
    ) {
      return null;
    }
    return { from: line.from + start, text: word[0], parameter: false };
  }

  if (!context.explicit) return null;
  return { from: pos, text: '', parameter: false };
};

const leadingParameterBlock = (
  source: string,
): { readonly text: string; readonly end: number } | null => {
  const lines = sourceLines(source);
  let first = 0;
  while (first < lines.length) {
    const line = lines[first].text;
    if (!line.trim() || line.trimStart().startsWith('--')) {
      first++;
      continue;
    }
    break;
  }
  const header = lines[first];
  if (!header || !/^parameters\s*\($/iu.test(maskLine(header.text).code.trimEnd())) {
    return null;
  }

  let close = -1;
  for (let index = first + 1; index < lines.length; index++) {
    const masked = maskLine(lines[index].text).code;
    if (/^\s*\)\s*$/u.test(masked)) {
      close = index;
      break;
    }
    if (masked.trim() && !/^\s/u.test(lines[index].text)) return null;
  }
  if (close < 0) return null;
  const end = lines[close].end;
  return { text: source.slice(header.start, end), end };
};

const containsLaterParameterDeclaration = (source: string): boolean => {
  const { code } = maskNonCode(source);
  // A later PARAMETERS statement invalidates the fallback even if its opener
  // is malformed. Otherwise a closed leading block could leak names from a
  // draft that the parser rejected before returning a syntax tree.
  return /^[\t ]*parameters\b/imu.test(code);
};

const sourceLines = (source: string): { text: string; start: number; end: number }[] => {
  const lines: { text: string; start: number; end: number }[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== '\r' && source[index] !== '\n') continue;
    const separatorLength = source[index] === '\r' && source[index + 1] === '\n' ? 2 : 1;
    const end = index + separatorLength;
    lines.push({ text: source.slice(start, index), start, end });
    start = end;
    index += separatorLength - 1;
  }
  lines.push({ text: source.slice(start), start, end: source.length });
  return lines;
};

const maskLine = (source: string): {
  readonly code: string;
  readonly inComment: boolean;
  readonly quote: string | null;
} => {
  const output = source.split('');
  let quote: string | null = null;
  let inComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (inComment) {
      output[index] = ' ';
      continue;
    }
    if (quote) {
      output[index] = ' ';
      if (char === quote) {
        if (source[index + 1] === quote) {
          output[index + 1] = ' ';
          index++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (source.startsWith('--', index)) {
      output[index] = ' ';
      output[index + 1] = ' ';
      index++;
      inComment = true;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      output[index] = ' ';
    }
  }
  return { code: output.join(''), inComment, quote };
};

const maskNonCode = (source: string): CodeMask => {
  const masked = sourceLines(source).map((line) => maskLine(line.text).code);
  return { code: masked.join(source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n') };
};

const applyCase = (word: string, keywordCase: TugqlKeywordCase): string =>
  keywordCase === 'uppercase' ? word.toUpperCase() : word.toLowerCase();
