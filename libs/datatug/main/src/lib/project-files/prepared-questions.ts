// `ai/prepared-questions.json` (design 5.2a): which wordings run which saved query, per language, and the
// follow-ups. JSON Schema: ./schemas/prepared-questions.schema.json. Every string in it is shown to a
// visitor as text, never as HTML: there is no markup field, and nothing here sanitises or interprets markup.

import {
  LANGUAGE_PATTERN,
  MAX_FOLLOW_UPS,
  MAX_ID_LENGTH,
  MAX_LANGUAGES,
  MAX_PROJECT_FILE_BYTES,
  MAX_QUERY_REF_LENGTH,
  MAX_QUESTIONS,
  MAX_TEXT_LENGTH,
  MAX_WORDINGS,
  PLAIN_TEXT_PATTERN,
  PREPARED_FOLLOW_UPS,
  QUERY_REF_PATTERN,
  QUESTION_ID_PATTERN,
} from './project-file-limits';
import {
  parseProjectFileText,
  ProblemCollector,
  type PlainRecord,
  type ValidationResult,
} from './project-file-problems';

export type PreparedFollowUp = (typeof PREPARED_FOLLOW_UPS)[number];

/** Text per language; `en` is always present. */
export type LocalizedText = { readonly en: string } & Readonly<
  Record<string, string>
>;

export interface PreparedQuestion {
  readonly id: string;
  /** The id of a saved query of the project, as `folder/id`. */
  readonly query: string;
  readonly question: LocalizedText;
  readonly title: LocalizedText;
  /** Other ways to ask it. The `question` texts always count as wordings too. */
  readonly wordings: readonly string[];
  readonly followUps: readonly PreparedFollowUp[];
}

export interface PreparedQuestionsFile {
  readonly version: 1;
  readonly questions: readonly PreparedQuestion[];
}

export interface PreparedQuestionsOptions {
  /**
   * Ids of the saved queries that exist in the project (`folder/id`). When given, a `query` that is not
   * among them is refused; when absent that cross-check is the caller's to do.
   */
  readonly knownQueryIds?: ReadonlySet<string>;
}

const FILE_KEYS = ['$schema', 'version', 'questions'];
const QUESTION_KEYS = [
  'id',
  'query',
  'question',
  'title',
  'wordings',
  'followUps',
];

/** Validates a parsed `ai/prepared-questions.json`. On success `value` is a fresh object holding only known keys. */
export function validatePreparedQuestions(
  input: unknown,
  options: PreparedQuestionsOptions = {},
): ValidationResult<PreparedQuestionsFile> {
  const problems = new ProblemCollector();
  const root = problems.record(input, '');
  if (!root) return { ok: false, errors: problems.problems };

  problems.onlyKeys(root, '', FILE_KEYS);
  problems.requireKeys(root, '', ['version', 'questions']);
  if ('$schema' in root) problems.text(root['$schema'], '/$schema', 300);
  if ('version' in root && root['version'] !== 1)
    problems.add('/version', 'const', 'must be 1');

  const questions: PreparedQuestion[] = [];
  const rawQuestions =
    'questions' in root
      ? problems.array(root['questions'], '/questions', 1, MAX_QUESTIONS)
      : undefined;
  const seenIds = new Set<string>();
  rawQuestions?.forEach((raw, index) => {
    const question = checkQuestion(
      raw,
      ProblemCollector.child('/questions', index),
      problems,
      options,
    );
    if (!question) return;
    if (seenIds.has(question.id)) {
      problems.add(
        ProblemCollector.child(
          ProblemCollector.child('/questions', index),
          'id',
        ),
        'duplicate',
        'must be unique',
      );
    }
    seenIds.add(question.id);
    questions.push(question);
  });

  if (problems.problems.length > 0)
    return { ok: false, errors: problems.problems };
  return { ok: true, value: { version: 1, questions } };
}

/** The text of the file: size cap, JSON syntax, then validatePreparedQuestions. */
export function parsePreparedQuestions(
  text: string,
  options: PreparedQuestionsOptions = {},
): ValidationResult<PreparedQuestionsFile> {
  const parsed = parseProjectFileText(text, MAX_PROJECT_FILE_BYTES);
  return parsed.ok ? validatePreparedQuestions(parsed.value, options) : parsed;
}

function checkQuestion(
  raw: unknown,
  path: string,
  problems: ProblemCollector,
  options: PreparedQuestionsOptions,
): PreparedQuestion | undefined {
  const before = problems.problems.length;
  const record = problems.record(raw, path);
  if (!record) return undefined;
  problems.onlyKeys(record, path, QUESTION_KEYS);
  problems.requireKeys(record, path, ['id', 'query', 'question', 'title']);

  const id = field(record, 'id')
    ? problems.text(
        record['id'],
        `${path}/id`,
        MAX_ID_LENGTH,
        QUESTION_ID_PATTERN,
      )
    : undefined;
  const query = field(record, 'query')
    ? problems.text(
        record['query'],
        `${path}/query`,
        MAX_QUERY_REF_LENGTH,
        QUERY_REF_PATTERN,
      )
    : undefined;
  if (
    query !== undefined &&
    options.knownQueryIds &&
    !options.knownQueryIds.has(query)
  ) {
    problems.add(
      `${path}/query`,
      'unknown-query',
      'is not a saved query of this project',
    );
  }
  const question = field(record, 'question')
    ? checkLocalized(record['question'], `${path}/question`, problems)
    : undefined;
  const title = field(record, 'title')
    ? checkLocalized(record['title'], `${path}/title`, problems)
    : undefined;
  const wordings = field(record, 'wordings')
    ? checkWordings(record['wordings'], `${path}/wordings`, problems)
    : [];
  const followUps = field(record, 'followUps')
    ? checkFollowUps(record['followUps'], `${path}/followUps`, problems)
    : [];

  if (
    problems.problems.length > before ||
    id === undefined ||
    query === undefined ||
    !question ||
    !title
  )
    return undefined;
  return { id, query, question, title, wordings, followUps };
}

const field = (record: PlainRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

function checkLocalized(
  raw: unknown,
  path: string,
  problems: ProblemCollector,
): LocalizedText | undefined {
  const record = problems.record(raw, path);
  if (!record) return undefined;
  const keys = Object.keys(record);
  if (keys.length > MAX_LANGUAGES) {
    problems.add(path, 'count', `must have at most ${MAX_LANGUAGES} languages`);
    return undefined;
  }
  problems.requireKeys(record, path, ['en']);
  const entries: [string, string][] = [];
  for (const language of keys) {
    const childPath = ProblemCollector.child(path, language);
    if (!LANGUAGE_PATTERN.test(language)) {
      problems.add(
        childPath,
        'unknown-key',
        'is not a language code such as en or ru',
      );
      continue;
    }
    const text = problems.text(
      record[language],
      childPath,
      MAX_TEXT_LENGTH,
      PLAIN_TEXT_PATTERN,
    );
    if (text !== undefined) entries.push([language, text]);
  }
  const text = Object.fromEntries(entries);
  return typeof text['en'] === 'string' ? (text as LocalizedText) : undefined;
}

function checkWordings(
  raw: unknown,
  path: string,
  problems: ProblemCollector,
): readonly string[] {
  const list = problems.array(raw, path, 0, MAX_WORDINGS);
  const wordings: string[] = [];
  list?.forEach((item, index) => {
    const text = problems.text(
      item,
      ProblemCollector.child(path, index),
      MAX_TEXT_LENGTH,
      PLAIN_TEXT_PATTERN,
    );
    if (text !== undefined) wordings.push(text);
  });
  return wordings;
}

function checkFollowUps(
  raw: unknown,
  path: string,
  problems: ProblemCollector,
): readonly PreparedFollowUp[] {
  const list = problems.array(raw, path, 0, MAX_FOLLOW_UPS);
  const followUps: PreparedFollowUp[] = [];
  list?.forEach((item, index) => {
    const itemPath = ProblemCollector.child(path, index);
    if (!PREPARED_FOLLOW_UPS.includes(item as PreparedFollowUp)) {
      problems.add(
        itemPath,
        'enum',
        `must be one of: ${PREPARED_FOLLOW_UPS.join(', ')}`,
      );
    } else if (followUps.includes(item as PreparedFollowUp)) {
      problems.add(itemPath, 'duplicate', 'must be unique');
    } else {
      followUps.push(item as PreparedFollowUp);
    }
  });
  return followUps;
}
