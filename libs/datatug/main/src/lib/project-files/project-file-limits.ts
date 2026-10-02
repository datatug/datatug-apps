// Limits and patterns shared by the validators of the two project-file formats described in
// docs/design/demo-as-github-project.md (backstage), sections 3.6 and 5.2a. The JSON Schemas under
// ./schemas declare the same numbers; project-file-schemas.spec.ts fails if the two ever disagree.

/** A project file read from GitHub: at most 256 KB (3.6), counted in bytes of the text received. */
export const MAX_PROJECT_FILE_BYTES = 256 * 1024;

/** A data file a project points at (3.6): at most 5 MB, counted in bytes received. */
export const MAX_DATA_FILE_BYTES = 5 * 1024 * 1024;

/** Files one run may read from a project (3.6). */
export const MAX_FILES_PER_RUN = 40;

/** Prepared questions (5.2a). */
export const MAX_QUESTIONS = 20;
export const MAX_WORDINGS = 50;
export const MAX_FOLLOW_UPS = 8;
export const MAX_TEXT_LENGTH = 200;
export const MAX_LANGUAGES = 20;
export const MAX_ID_LENGTH = 64;
export const MAX_QUERY_REF_LENGTH = 200;

/** The `https-json` catalog file (4.8, 5.2a). */
export const MAX_URL_LENGTH = 2048;
export const MAX_TABLES = 100;
export const MAX_LABEL_LENGTH = 80;
export const MAX_NAME_LENGTH = 64;
export const MAX_LICENCE_LENGTH = 64;

/** The follow-ups the app knows. First release: `insight` (5.2a). */
export const PREPARED_FOLLOW_UPS = ['insight'] as const;

/** `[a-z0-9-]` (5.2a), at most MAX_ID_LENGTH characters. */
export const QUESTION_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
/** A saved query's id inside the project: `folder/id`, every segment starts with a letter or digit, so no `..`. */
export const QUERY_REF_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
/** A language code such as `en`, `ru` or `pt-BR`. */
export const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
/**
 * Text shown to a visitor. Rendered as text, never as HTML, but kept to one line and free of characters that
 * make one string look like another: C0 and C1 controls, the Arabic letter mark, zero-width space and the
 * left-to-right and right-to-left marks, the line and paragraph separators, every bidirectional override and
 * isolate (U+202A to U+202E, U+2066 to U+2069) and the rest of U+2060 to U+206F, the byte order mark,
 * interlinear annotation characters and the tag characters (U+E0000 to U+E007F). The zero-width joiners
 * (U+200C, U+200D) stay: emoji sequences and some scripts need them.
 */
export const PLAIN_TEXT_PATTERN = new RegExp(
  String.raw`^[^\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]*$`,
  'u',
);
/** A table or column name. No leading underscore, so `__proto__` can never be a key. */
export const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/;

/**
 * The shape of an address a project may carry: `https`, a name made of letters, digits, dots and
 * hyphens (no user name or password, no port, no bracketed IPv6 literal), then an optional path of
 * printable ASCII without `#` or `\`. What this cannot say (loopback and private numbers, the allow-list) is
 * checked by project-address-rules.ts.
 */
export const HTTPS_URL_PATTERN =
  /^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(\/[!"$-[\]-~]*)?$/;
/** A link, not a template: no brace. */
export const URL_NO_BRACES_PATTERN = /^[^{}]*$/;
/** A URL template has `{table}` exactly once and no other brace. */
export const URL_TEMPLATE_ONE_PLACEHOLDER_PATTERN = /^[^{}]*\{table\}[^{}]*$/;
/** A URL template has no `%` (so no encoded dot segment) and no query. */
export const URL_TEMPLATE_PLAIN_PATTERN = /^[^%?]*$/;

export const TABLE_PLACEHOLDER = '{table}';
