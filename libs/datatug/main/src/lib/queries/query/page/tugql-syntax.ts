import {
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export type TugqlTokenKind =
  | 'keyword'
  | 'parameter'
  | 'string'
  | 'number'
  | 'comment'
  | 'identifier'
  | 'operator'
  | 'punctuation';

export interface TugqlToken {
  readonly text: string;
  readonly kind?: TugqlTokenKind;
}

interface TokenRange {
  readonly end: number;
  readonly kind?: TugqlTokenKind;
}

const KEYWORDS = new Set([
  'all',
  'and',
  'as',
  'asc',
  'by',
  'case',
  'cross',
  'date',
  'datetime',
  'decimal',
  'default',
  'desc',
  'distinct',
  'else',
  'end',
  'exists',
  'from',
  'group',
  'having',
  'inner',
  'in',
  'integer',
  'is',
  'join',
  'left',
  'limit',
  'like',
  'not',
  'null',
  'offset',
  'on',
  'or',
  'outer',
  'order',
  'parameters',
  'real',
  'required',
  'right',
  'select',
  'source',
  'text',
  'then',
  'true',
  'false',
  'boolean',
  'string',
  'timestamp',
  'using',
  'union',
  'where',
  'when',
  'with',
]);

const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}\p{M}_$]*/u;
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/u;

const scanQuoted = (
  line: string,
  start: number,
  quote: "'" | '"' | '`',
): number => {
  let index = start + 1;
  while (index < line.length) {
    const char = line[index];
    if (char === quote) {
      if (line[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index++;
  }
  return line.length;
};

const scanToken = (line: string, start: number): TokenRange => {
  const char = line[start];
  if (/\s/u.test(char)) {
    let end = start + 1;
    while (end < line.length && /\s/u.test(line[end])) end++;
    return { end };
  }

  if (line.startsWith('--', start)) {
    return { end: line.length, kind: 'comment' };
  }

  if (char === "'")
    return { end: scanQuoted(line, start, char), kind: 'string' };
  if (char === '"' || char === '`') {
    const importedPath =
      char === '"' &&
      /\bwith\s+[\p{L}_$][\p{L}\p{N}\p{M}_$]*\s+from\s*$/iu.test(
        line.slice(0, start),
      );
    // Double quotes are normally neutral SQL identifiers; only the explicit
    // TugQL `with Name from "path"` lexical form colors them as a string.
    return {
      end: scanQuoted(line, start, char),
      kind: importedPath ? 'string' : 'identifier',
    };
  }

  if (char === '@') {
    const parameter = line.slice(start + 1).match(IDENTIFIER);
    if (parameter)
      return { end: start + parameter[0].length + 1, kind: 'parameter' };
  }
  if (char === '?') {
    const placeholder = line.slice(start + 1).match(/^\d*/u)?.[0] ?? '';
    return { end: start + placeholder.length + 1, kind: 'parameter' };
  }

  const number = line.slice(start).match(NUMBER)?.[0];
  if (number) return { end: start + number.length, kind: 'number' };

  const identifier = line.slice(start).match(IDENTIFIER)?.[0];
  if (identifier) {
    return {
      end: start + identifier.length,
      kind: KEYWORDS.has(identifier.toLowerCase()) ? 'keyword' : 'identifier',
    };
  }

  if (/[=<>!+*/%|-]/u.test(char)) return { end: start + 1, kind: 'operator' };
  if (/[.,();:[\]{}]/u.test(char))
    return { end: start + 1, kind: 'punctuation' };
  return { end: start + 1 };
};

/** A lexical pass only: it does not validate, parse, format, or change source text. */
export const tokenizeTugql = (source: string): readonly TugqlToken[] => {
  const tokens: TugqlToken[] = [];
  const lineBreak = /\r\n|\r|\n/gu;
  const scanLine = (line: string): void => {
    let linePosition = 0;
    while (linePosition < line.length) {
      const token = scanToken(line, linePosition);
      const text = line.slice(linePosition, token.end);
      const previous = tokens.at(-1);
      if (previous && previous.kind === token.kind) {
        tokens[tokens.length - 1] = {
          text: previous.text + text,
          kind: token.kind,
        };
      } else {
        tokens.push(token.kind ? { text, kind: token.kind } : { text });
      }
      linePosition = token.end;
    }
  };

  let lineStart = 0;
  for (const match of source.matchAll(lineBreak)) {
    const separator = match[0];
    const lineEnd = match.index ?? lineStart;
    scanLine(source.slice(lineStart, lineEnd));
    tokens.push({ text: separator });
    lineStart = lineEnd + separator.length;
  }
  scanLine(source.slice(lineStart));
  return tokens;
};

const tagByKind = {
  keyword: tags.keyword,
  parameter: tags.variableName,
  string: tags.string,
  number: tags.number,
  comment: tags.comment,
  identifier: tags.name,
  operator: tags.operator,
  punctuation: tags.punctuation,
} satisfies Record<TugqlTokenKind, typeof tags.keyword>;

const language = StreamLanguage.define<null>({
  name: 'tugql',
  startState: () => null,
  token: (stream) => {
    const range = scanToken(stream.string, stream.pos);
    stream.pos = range.end;
    return range.kind ?? null;
  },
  tokenTable: tagByKind,
});

const syntaxStyle = HighlightStyle.define([
  { tag: tags.keyword, class: 'tugql-token-keyword' },
  { tag: tags.variableName, class: 'tugql-token-parameter' },
  { tag: tags.string, class: 'tugql-token-string' },
  { tag: tags.number, class: 'tugql-token-number' },
  { tag: tags.comment, class: 'tugql-token-comment' },
  { tag: tags.name, class: 'tugql-token-identifier' },
  { tag: tags.operator, class: 'tugql-token-operator' },
  { tag: tags.punctuation, class: 'tugql-token-punctuation' },
]);

export const TUGQL_LANGUAGE_DESCRIPTIONS = [
  LanguageDescription.of({
    name: 'TugQL',
    alias: ['SQL'],
    support: new LanguageSupport(language),
  }),
];

const syntaxTheme = EditorView.theme({
  '&': {
    minHeight: '13rem',
    color: 'var(--ion-color-dark, #1f2937)',
    backgroundColor: 'var(--ion-background-color, #ffffff)',
    fontSize: '0.92rem',
    lineHeight: '1.55',
  },
  '.cm-scroller': {
    minHeight: 'inherit',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  '.cm-content': {
    minHeight: 'inherit',
    padding: '0.75rem',
    caretColor: 'var(--ion-color-primary, #1d4ed8)',
  },
  '.cm-line': { padding: '0' },
  '.tugql-token-keyword': {
    color: 'var(--tugql-keyword, #174f91)',
    fontWeight: '700',
  },
  '.tugql-token-parameter': {
    color: 'var(--tugql-parameter, #713f8f)',
    fontWeight: '650',
  },
  '.tugql-token-string': { color: 'var(--tugql-string, #17623a)' },
  '.tugql-token-number': { color: 'var(--tugql-number, #854d0e)' },
  '.tugql-token-comment': {
    color: 'var(--tugql-comment, #57534e)',
    fontStyle: 'italic',
  },
  '.tugql-token-identifier': { color: 'var(--ion-color-dark, #1f2937)' },
  '.tugql-token-operator, .tugql-token-punctuation': {
    color: 'var(--ion-color-dark-shade, #334155)',
  },
  '&.cm-focused': {
    outline: '2px solid var(--ion-color-primary, #1d4ed8)',
    outlineOffset: '-2px',
  },
  '@media (forced-colors: active)': {
    '.tugql-token-keyword': { color: 'LinkText', textDecoration: 'underline' },
    '.tugql-token-parameter': {
      color: 'CanvasText',
      textDecoration: 'underline dashed',
    },
    '.tugql-token-string': {
      color: 'CanvasText',
      textDecoration: 'underline dotted',
    },
    '.tugql-token-number': { color: 'CanvasText', fontWeight: '700' },
    '.tugql-token-comment': { color: 'GrayText' },
    '&.cm-focused': { outlineColor: 'Highlight' },
  },
});

export const createTugqlEditorExtensions = (label: string): Extension[] => {
  const extension: Extension[] = [
    syntaxHighlighting(syntaxStyle),
    EditorView.contentAttributes.of({
      'aria-label': label,
      'aria-multiline': 'true',
    }),
    syntaxTheme,
  ];
  return extension;
};
