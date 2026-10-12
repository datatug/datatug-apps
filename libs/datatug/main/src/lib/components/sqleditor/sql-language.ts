import {
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  syntaxHighlighting,
} from '@codemirror/language';
import { StandardSQL } from '@codemirror/lang-sql';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/** A neutral SQL grammar is used directly, without enabling SQL completions. */
export const SQL_LANGUAGE_DESCRIPTIONS = [
  LanguageDescription.of({
    name: 'SQL',
    alias: ['sql'],
    support: new LanguageSupport(StandardSQL.language),
  }),
];

const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, class: 'sql-token-keyword' },
  { tag: tags.string, class: 'sql-token-string' },
  { tag: tags.number, class: 'sql-token-number' },
  { tag: tags.comment, class: 'sql-token-comment' },
  { tag: tags.name, class: 'sql-token-identifier' },
  { tag: tags.operator, class: 'sql-token-operator' },
  { tag: tags.punctuation, class: 'sql-token-punctuation' },
]);

const sqlEditorTheme = EditorView.theme({
  '&': {
    minHeight: '8rem',
    color: 'var(--sql-foreground, #1f2937)',
    backgroundColor: 'var(--sql-surface, #ffffff)',
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
  '.cm-gutters': {
    color: 'var(--sql-gutter-foreground, #374151)',
    backgroundColor: 'var(--sql-gutter-surface, #f3f4f6)',
    borderRight: '1px solid currentColor',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--sql-active-line, #eef2ff)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--sql-selection, #dbeafe)',
  },
  '.sql-token-keyword': {
    color: 'var(--sql-keyword, #174f91)',
    fontWeight: '700',
  },
  '.sql-token-string': { color: 'var(--sql-string, #17623a)' },
  '.sql-token-number': { color: 'var(--sql-number, #854d0e)' },
  '.sql-token-comment': {
    color: 'var(--sql-comment, #57534e)',
    fontStyle: 'italic',
  },
  '.sql-token-identifier': { color: 'var(--sql-foreground, #1f2937)' },
  '.sql-token-operator, .sql-token-punctuation': {
    color: 'var(--sql-foreground, #1f2937)',
  },
  '&.cm-focused': {
    outline: '2px solid var(--ion-color-primary, #1d4ed8)',
    outlineOffset: '-2px',
  },
  '@media (forced-colors: active)': {
    '&': { color: 'CanvasText', backgroundColor: 'Canvas' },
    '.cm-scroller, .cm-content': {
      color: 'CanvasText',
      backgroundColor: 'Canvas',
      caretColor: 'CanvasText',
    },
    '.cm-gutters, .cm-gutterElement, .cm-activeLine, .cm-activeLineGutter': {
      color: 'CanvasText',
      backgroundColor: 'Canvas',
    },
    '.cm-gutters': { borderRightColor: 'CanvasText' },
    '.sql-token-keyword': {
      color: 'CanvasText',
      textDecoration: 'underline',
    },
    '.sql-token-string': {
      color: 'CanvasText',
      textDecoration: 'underline dotted',
    },
    '.sql-token-number': { color: 'CanvasText', fontWeight: '700' },
    '.sql-token-comment': { color: 'CanvasText', fontStyle: 'italic' },
    '.sql-token-identifier, .sql-token-operator, .sql-token-punctuation': {
      color: 'CanvasText',
    },
    '&.cm-focused': { outlineColor: 'Highlight' },
  },
});

const sqlSelectionTheme = EditorView.baseTheme({
  '.sql-editor-view &light .cm-selectionBackground': {
    backgroundColor: 'var(--sql-selection, #dbeafe)',
    outline: 'var(--sql-selection-outline, none)',
    outlineOffset: '-2px',
  },
  '.sql-editor-view &dark .cm-selectionBackground': {
    backgroundColor: 'var(--sql-selection, #dbeafe)',
    outline: 'var(--sql-selection-outline, none)',
    outlineOffset: '-2px',
  },
  '.sql-editor-view &light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    {
      backgroundColor: 'var(--sql-selection, #dbeafe)',
      outline: 'var(--sql-selection-outline, none)',
      outlineOffset: '-2px',
    },
  '.sql-editor-view &dark.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    {
      backgroundColor: 'var(--sql-selection, #dbeafe)',
      outline: 'var(--sql-selection-outline, none)',
      outlineOffset: '-2px',
    },
});

export const createSqlEditorExtensions = (
  label: string,
  autoCloseBrackets = true,
): Extension[] => [
  Prec.highest(
    EditorState.languageData.of(() => [
      {
        closeBrackets: {
          brackets: autoCloseBrackets ? ['(', '[', '{', "'", '"'] : [],
        },
      },
    ]),
  ),
  syntaxHighlighting(sqlHighlightStyle),
  EditorView.contentAttributes.of({
    'aria-label': label,
    'aria-multiline': 'true',
  }),
  sqlEditorTheme,
  sqlSelectionTheme,
];
