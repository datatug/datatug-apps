import { describe, expect, it } from 'vitest';
import {
  MAX_FOLLOW_UPS,
  MAX_PROJECT_FILE_BYTES,
  MAX_QUESTIONS,
  MAX_TEXT_LENGTH,
  MAX_WORDINGS,
} from './project-file-limits';
import {
  parsePreparedQuestions,
  validatePreparedQuestions,
} from './prepared-questions';
import type { FileProblem, ValidationResult } from './project-file-problems';

const question = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: 'sales-per-capita',
  query: 'sales/chinook-sales-per-capita',
  question: {
    en: 'Which countries buy the most music?',
    ru: 'Какие страны покупают больше всего музыки?',
  },
  title: { en: 'Sales per million people', ru: 'Продажи на миллион человек' },
  wordings: ['music sales per capita by country'],
  followUps: ['insight'],
  ...overrides,
});
const file = (
  questions: unknown[] = [question()],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  version: 1,
  questions,
  ...extra,
});

const errorsOf = (
  result: ValidationResult<unknown>,
): readonly FileProblem[] => {
  if (result.ok) throw new Error('expected the file to be refused');
  return result.errors;
};
const refusedAt = (input: unknown, path: string, code?: string): void => {
  const found = errorsOf(validatePreparedQuestions(input)).filter(
    (e) => e.path === path,
  );
  expect(found.length, `no problem at ${path}`).toBeGreaterThan(0);
  if (code) expect(found.map((e) => e.code)).toContain(code);
};

describe('validatePreparedQuestions: the shape of 5.2a', () => {
  it('accepts the file the design shows and returns it unchanged', () => {
    const input = file();
    const result = validatePreparedQuestions(input);
    expect(result).toEqual({ ok: true, value: input });
  });

  it('defaults wordings and followUps to empty lists when absent', () => {
    const bare = Object.fromEntries(
      Object.entries(question()).filter(
        ([key]) => key !== 'wordings' && key !== 'followUps',
      ),
    );
    const result = validatePreparedQuestions(file([bare]));
    expect(result.ok && result.value.questions[0].wordings).toEqual([]);
    expect(result.ok && result.value.questions[0].followUps).toEqual([]);
  });

  it('accepts only an English text and an optional $schema', () => {
    const result = validatePreparedQuestions(
      file([question({ question: { en: 'Q' }, title: { en: 'T' } })], {
        $schema: 'https://example.org/s.json',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it.each([null, 'text', 7, [], true])('refuses a root that is %j', (root) => {
    refusedAt(root, '', 'type');
  });

  it('requires version and questions', () => {
    refusedAt({}, '/version', 'required');
    refusedAt({}, '/questions', 'required');
  });

  it.each([2, 0, '1', null, 1.5])('refuses version %j', (version) => {
    refusedAt({ version, questions: [question()] }, '/version', 'const');
  });

  it('refuses unknown keys at the top and in a question, never ignoring them', () => {
    refusedAt(file([question()], { extra: 1 }), '/extra', 'unknown-key');
    refusedAt(
      file([question({ html: '<b>x</b>' })]),
      '/questions/0/html',
      'unknown-key',
    );
    refusedAt(
      JSON.parse('{"version":1,"questions":[],"__proto__":{"x":1}}') as unknown,
      '/__proto__',
      'unknown-key',
    );
  });

  it('counts questions: 1 to 20', () => {
    refusedAt(file([]), '/questions', 'count');
    refusedAt(
      file(
        Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) =>
          question({ id: `q-${i}` }),
        ),
      ),
      '/questions',
      'count',
    );
    const max = file(
      Array.from({ length: MAX_QUESTIONS }, (_, i) =>
        question({ id: `q-${i}` }),
      ),
    );
    expect(validatePreparedQuestions(max).ok).toBe(true);
  });

  it('refuses questions that are not an array', () => {
    refusedAt({ version: 1, questions: {} }, '/questions', 'type');
  });

  it('refuses a question that is not an object', () => {
    refusedAt(file(['x']), '/questions/0', 'type');
  });
});

describe('ids', () => {
  it.each(['a', 'sales-per-capita', '0-9', 'a'.repeat(64)])(
    'accepts %s',
    (id) => {
      expect(validatePreparedQuestions(file([question({ id })])).ok).toBe(true);
    },
  );

  it.each([
    '',
    'Sales',
    'sales_per_capita',
    'a b',
    'a/b',
    'é',
    'a'.repeat(65),
    '../x',
    'a.b',
  ])('refuses %j', (id) => {
    refusedAt(file([question({ id })]), '/questions/0/id');
  });

  it('refuses a non-string id', () => {
    refusedAt(file([question({ id: 5 })]), '/questions/0/id', 'type');
  });

  it('refuses a repeated id, at the second question', () => {
    refusedAt(file([question(), question()]), '/questions/1/id', 'duplicate');
  });
});

describe('the saved query a question runs', () => {
  it.each(['sales/chinook-sales-per-capita', 'x', 'a.b/c_d-e', 'q1/q2/q3'])(
    'accepts %s',
    (query) => {
      expect(validatePreparedQuestions(file([question({ query })])).ok).toBe(
        true,
      );
    },
  );

  it.each([
    '',
    '/x',
    'x/',
    'a//b',
    '../etc',
    'a/../b',
    '.hidden',
    'a b',
    'a\\b',
    'x'.repeat(201),
  ])('refuses %j', (query) => {
    refusedAt(file([question({ query })]), '/questions/0/query');
  });

  it('refuses a query that is not in the project when the project lists its queries', () => {
    const known = new Set(['sales/chinook-sales-per-capita']);
    expect(validatePreparedQuestions(file(), { knownQueryIds: known }).ok).toBe(
      true,
    );
    const result = validatePreparedQuestions(
      file([question({ query: 'sales/other' })]),
      { knownQueryIds: known },
    );
    expect(errorsOf(result)).toEqual([
      {
        path: '/questions/0/query',
        code: 'unknown-query',
        message: 'is not a saved query of this project',
      },
    ]);
  });

  it('leaves the cross-check to the caller when no list is given', () => {
    expect(
      validatePreparedQuestions(file([question({ query: 'anything/at-all' })]))
        .ok,
    ).toBe(true);
  });
});

describe('question and title texts', () => {
  it.each(['question', 'title'])('requires English in %s', (key) => {
    refusedAt(
      file([question({ [key]: { ru: 'только русский' } })]),
      `/questions/0/${key}/en`,
      'required',
    );
  });

  it.each(['question', 'title'])(
    'keeps each %s text to 200 characters',
    (key) => {
      expect(
        validatePreparedQuestions(
          file([question({ [key]: { en: 'x'.repeat(MAX_TEXT_LENGTH) } })]),
        ).ok,
      ).toBe(true);
      refusedAt(
        file([question({ [key]: { en: 'x'.repeat(MAX_TEXT_LENGTH + 1) } })]),
        `/questions/0/${key}/en`,
        'length',
      );
      refusedAt(
        file([
          question({ [key]: { en: 'x', ru: 'я'.repeat(MAX_TEXT_LENGTH + 1) } }),
        ]),
        `/questions/0/${key}/ru`,
        'length',
      );
    },
  );

  it('refuses an empty text', () => {
    refusedAt(
      file([question({ title: { en: '' } })]),
      '/questions/0/title/en',
      'length',
    );
  });

  it('refuses a text that is not a string, and a text that is not an object', () => {
    refusedAt(
      file([question({ title: { en: 3 } })]),
      '/questions/0/title/en',
      'type',
    );
    refusedAt(
      file([question({ title: 'Sales' })]),
      '/questions/0/title',
      'type',
    );
    refusedAt(
      file([question({ title: { en: { text: 'x' } } })]),
      '/questions/0/title/en',
      'type',
    );
  });

  it.each(['EN', 'english', 'e', 'en_US', 'ru-', '__proto__', 'constructor'])(
    'refuses the language code %j',
    (language) => {
      refusedAt(
        file([question({ title: { en: 'T', [language]: 'x' } })]),
        `/questions/0/title/${language}`,
      );
    },
  );

  it.each(['pt-BR', 'zh-Hans', 'ru', 'fil'])(
    'accepts the language code %s',
    (language) => {
      expect(
        validatePreparedQuestions(
          file([question({ title: { en: 'T', [language]: 'x' } })]),
        ).ok,
      ).toBe(true);
    },
  );

  it('allows at most 20 languages', () => {
    const many: Record<string, string> = { en: 'x' };
    for (let i = 0; i < 20; i++) many[`a${String.fromCharCode(97 + i)}`] = 'x';
    refusedAt(file([question({ title: many })]), '/questions/0/title', 'count');
  });

  it.each(['line\nbreak', 'tab\there', 'nul\u0000', 'bell\u0007', 'del\u007f'])(
    'refuses control characters: %j',
    (text) => {
      refusedAt(
        file([question({ question: { en: text } })]),
        '/questions/0/question/en',
        'pattern',
      );
    },
  );
});

describe('strings are text: markup is carried as written, never interpreted or removed', () => {
  const markup =
    '<img src=x onerror=alert(1)><script>alert(2)</script> &amp; <a href="javascript:alert(3)">x</a>';

  it('accepts markup in every string and returns it byte for byte', () => {
    const input = file([
      question({
        id: 'm',
        query: 'sales/chinook-sales-per-capita',
        question: { en: markup, ru: markup },
        title: { en: markup },
        wordings: [markup],
      }),
    ]);
    const result = validatePreparedQuestions(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const q = result.value.questions[0];
      expect([
        q.question['en'],
        q.question['ru'],
        q.title['en'],
        q.wordings[0],
      ]).toEqual([markup, markup, markup, markup]);
    }
  });

  it('has no field meant to hold markup: an html-ish key is an unknown key', () => {
    refusedAt(
      file([question({ html: '<b>x</b>', descriptionHtml: '<b>x</b>' })]),
      '/questions/0/html',
      'unknown-key',
    );
    refusedAt(
      file([question({ descriptionHtml: '<b>x</b>' })]),
      '/questions/0/descriptionHtml',
      'unknown-key',
    );
  });
});

describe('wordings', () => {
  it('allows 0 to 50, each 1 to 200 characters', () => {
    expect(
      validatePreparedQuestions(file([question({ wordings: [] })])).ok,
    ).toBe(true);
    expect(
      validatePreparedQuestions(
        file([
          question({
            wordings: Array.from({ length: MAX_WORDINGS }, (_, i) => `w ${i}`),
          }),
        ]),
      ).ok,
    ).toBe(true);
    refusedAt(
      file([
        question({
          wordings: Array.from(
            { length: MAX_WORDINGS + 1 },
            (_, i) => `w ${i}`,
          ),
        }),
      ]),
      '/questions/0/wordings',
      'count',
    );
    refusedAt(
      file([question({ wordings: ['x'.repeat(MAX_TEXT_LENGTH + 1)] })]),
      '/questions/0/wordings/0',
      'length',
    );
    refusedAt(
      file([question({ wordings: [''] })]),
      '/questions/0/wordings/0',
      'length',
    );
    refusedAt(
      file([question({ wordings: [7] })]),
      '/questions/0/wordings/0',
      'type',
    );
    refusedAt(
      file([question({ wordings: 'text' })]),
      '/questions/0/wordings',
      'type',
    );
  });
});

describe('follow-ups', () => {
  it('accepts only the fixed list the app knows: insight', () => {
    expect(
      validatePreparedQuestions(file([question({ followUps: ['insight'] })]))
        .ok,
    ).toBe(true);
    expect(
      validatePreparedQuestions(file([question({ followUps: [] })])).ok,
    ).toBe(true);
    refusedAt(
      file([question({ followUps: ['chart'] })]),
      '/questions/0/followUps/0',
      'enum',
    );
    refusedAt(
      file([question({ followUps: ['Insight'] })]),
      '/questions/0/followUps/0',
      'enum',
    );
    refusedAt(
      file([question({ followUps: ['insight', 'insight'] })]),
      '/questions/0/followUps/1',
      'duplicate',
    );
    refusedAt(
      file([
        question({
          followUps: Array.from(
            { length: MAX_FOLLOW_UPS + 1 },
            () => 'insight',
          ),
        }),
      ]),
      '/questions/0/followUps',
      'count',
    );
    refusedAt(
      file([question({ followUps: 'insight' })]),
      '/questions/0/followUps',
      'type',
    );
  });
});

describe('the returned value', () => {
  it('is a fresh object that holds only known keys, in a form safe to use as a map', () => {
    const input = file([question()], { $schema: 'https://example.org/s.json' });
    const result = validatePreparedQuestions(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBe(input);
      expect(Object.keys(result.value)).toEqual(['version', 'questions']);
    }
  });

  it('reports every problem, with a JSON Pointer path', () => {
    const errors = errorsOf(
      validatePreparedQuestions(
        file([question({ id: 'BAD', query: '' }), 'x']),
      ),
    );
    expect(errors.map((e) => e.path)).toEqual([
      '/questions/0/id',
      '/questions/0/query',
      '/questions/1',
    ]);
  });
});

describe('parsePreparedQuestions: the text of the file', () => {
  it('parses and validates', () => {
    expect(parsePreparedQuestions(JSON.stringify(file())).ok).toBe(true);
  });

  it('refuses text that is not JSON', () => {
    expect(errorsOf(parsePreparedQuestions('{nope'))[0].code).toBe('not-json');
    expect(errorsOf(parsePreparedQuestions(''))[0].code).toBe('not-json');
  });

  it('refuses a file over 256 KB, counted in bytes', () => {
    const big =
      JSON.stringify(file([question({ wordings: ['é'.repeat(100)] })])) +
      ' '.repeat(MAX_PROJECT_FILE_BYTES);
    expect(errorsOf(parsePreparedQuestions(big))[0].code).toBe('too-large');
    const multibyte = '"' + 'é'.repeat(MAX_PROJECT_FILE_BYTES / 2 + 1) + '"'; // fewer characters than bytes
    expect(multibyte.length).toBeLessThan(MAX_PROJECT_FILE_BYTES);
    expect(errorsOf(parsePreparedQuestions(multibyte))[0].code).toBe(
      'too-large',
    );
  });

  it('passes the project query list on', () => {
    const result = parsePreparedQuestions(JSON.stringify(file()), {
      knownQueryIds: new Set(['x/y']),
    });
    expect(errorsOf(result)[0].code).toBe('unknown-query');
  });
});
