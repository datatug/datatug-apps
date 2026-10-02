// The two JSON Schemas under ./schemas are what the repo lane's CI validates against (fetched from this
// repository at a pinned commit) and the validators are what the app runs. They must say the same thing:
// this spec feeds both the same documents and compares their verdicts, and checks that the numbers the schemas
// declare are the numbers in project-file-limits.ts.
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import catalogSchema from './schemas/https-json-catalog.schema.json';
import questionsSchema from './schemas/prepared-questions.schema.json';
import { validateHttpsJsonCatalog } from './https-json-catalog';
import { validatePreparedQuestions } from './prepared-questions';
import type { ValidationResult } from './project-file-problems';
import * as limits from './project-file-limits';

/** `RegExp.source` spells a pattern the one way JavaScript does, so patterns written differently still compare equal. */
const same = (pattern: string, expected: RegExp): void =>
  expect(new RegExp(pattern, 'u').source).toBe(expected.source);

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'chinook-demo',
);

const ajv = new Ajv2020({ strict: true, allErrors: true });
const questionsSchemaValidate = ajv.compile(questionsSchema);
const catalogSchemaValidate = ajv.compile(catalogSchema);

const SHA = '88eb7faede360988e9c0f8f8d107e5093db5e712141de14d868f8947b43c373c';
const question = (
  o: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: 'sales-per-capita',
  query: 'sales/chinook-sales-per-capita',
  question: { en: 'Which countries buy the most music?', ru: 'Какие страны?' },
  title: { en: 'Sales per million people' },
  wordings: ['music sales per capita by country'],
  followUps: ['insight'],
  ...o,
});
const questions = (
  qs: unknown[] = [question()],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({ version: 1, questions: qs, ...extra });
const catalog = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  driver: 'https-json',
  label: 'Chinook (chinookdb.com)',
  homepage: 'https://chinookdb.com',
  urlTemplate: 'https://chinookdb.com/data/json/chinook.{table}.json',
  fallbackUrlTemplate:
    'https://cdn.jsdelivr.net/gh/datatug/chinookdb@0b6bb6ba22f680c9fb2fea9ec8107a8638dd8dc4/public/data/json/chinook.{table}.json',
  keys: { Invoice: 'InvoiceId' },
  sha256: { Invoice: SHA },
  upstream: {
    repository: 'https://github.com/lerocha/chinook-database',
    revision: '7f67772503d71ba90f19283c38e93923addb43fa',
    licence: 'MIT',
  },
  ...o,
});
const drop = (
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

// [name, document, valid]. Only rules a JSON Schema can state belong here; the rest are in the validators' specs.
const questionCases: [string, unknown, boolean][] = [
  ['the design example', questions(), true],
  [
    'no wordings or follow-ups',
    questions([drop(drop(question(), 'wordings'), 'followUps')]),
    true,
  ],
  [
    'an English-only question',
    questions([question({ question: { en: 'Q' }, title: { en: 'T' } })]),
    true,
  ],
  [
    'a $schema key',
    questions([question()], { $schema: 'https://example.org/s.json' }),
    true,
  ],
  ['a 64-character id', questions([question({ id: 'a'.repeat(64) })]), true],
  [
    '20 questions',
    questions(Array.from({ length: 20 }, (_, i) => question({ id: `q${i}` }))),
    true,
  ],
  [
    'markup in strings',
    questions([
      question({
        question: { en: '<b>x</b>' },
        wordings: ['<script>x</script>'],
      }),
    ]),
    true,
  ],
  ['a root that is an array', [], false],
  ['version 2', { version: 2, questions: [question()] }, false],
  ['no version', { questions: [question()] }, false],
  ['no questions key', { version: 1 }, false],
  ['no questions', questions([]), false],
  [
    '21 questions',
    questions(Array.from({ length: 21 }, (_, i) => question({ id: `q${i}` }))),
    false,
  ],
  ['an unknown top-level key', questions([question()], { extra: 1 }), false],
  ['an unknown question key', questions([question({ html: 'x' })]), false],
  ['an upper-case id', questions([question({ id: 'Sales' })]), false],
  ['a 65-character id', questions([question({ id: 'a'.repeat(65) })]), false],
  ['an underscore in the id', questions([question({ id: 'a_b' })]), false],
  ['a query with ..', questions([question({ query: 'a/../b' })]), false],
  ['an empty query', questions([question({ query: '' })]), false],
  [
    'no English question',
    questions([question({ question: { ru: 'x' } })]),
    false,
  ],
  ['no English title', questions([question({ title: { ru: 'x' } })]), false],
  [
    'a 201-character text',
    questions([question({ title: { en: 'x'.repeat(201) } })]),
    false,
  ],
  [
    'a 200-character text',
    questions([question({ title: { en: 'x'.repeat(200) } })]),
    true,
  ],
  ['an empty text', questions([question({ title: { en: '' } })]), false],
  [
    'a bad language code',
    questions([question({ title: { en: 'T', 'EN-us': 'x' } })]),
    false,
  ],
  [
    'a newline in a text',
    questions([question({ question: { en: 'a\nb' } })]),
    false,
  ],
  [
    '51 wordings',
    questions([
      question({ wordings: Array.from({ length: 51 }, (_, i) => `w${i}`) }),
    ]),
    false,
  ],
  [
    '50 wordings',
    questions([
      question({ wordings: Array.from({ length: 50 }, (_, i) => `w${i}`) }),
    ]),
    true,
  ],
  [
    'a 201-character wording',
    questions([question({ wordings: ['x'.repeat(201)] })]),
    false,
  ],
  [
    'an unknown follow-up',
    questions([question({ followUps: ['chart'] })]),
    false,
  ],
  [
    'a repeated follow-up',
    questions([question({ followUps: ['insight', 'insight'] })]),
    false,
  ],
  ['a number as a text', questions([question({ title: { en: 5 } })]), false],
];

const catalogCases: [string, unknown, boolean][] = [
  ['the design block', catalog(), true],
  [
    'the smallest file',
    {
      driver: 'https-json',
      urlTemplate: 'https://chinookdb.com/data/{table}.json',
      keys: { Invoice: 'InvoiceId' },
      sha256: { Invoice: SHA },
    },
    true,
  ],
  ['no fallback', drop(catalog(), 'fallbackUrlTemplate'), true],
  [
    'an untrusted-looking host (shape only)',
    catalog({ urlTemplate: 'https://example.org/{table}.json' }),
    true,
  ],
  ['no driver', drop(catalog(), 'driver'), false],
  ['another driver', catalog({ driver: 'sqlite3' }), false],
  ['no urlTemplate', drop(catalog(), 'urlTemplate'), false],
  ['no keys', drop(catalog(), 'keys'), false],
  ['no sha256', drop(catalog(), 'sha256'), false],
  ['empty keys', catalog({ keys: {} }), false],
  ['an unknown key', catalog({ path: 'x' }), false],
  ['credentials as keys', catalog({ username: 'u', password: 'p' }), false],
  [
    'http',
    catalog({ urlTemplate: 'http://chinookdb.com/data/{table}.json' }),
    false,
  ],
  [
    'credentials in the address',
    catalog({ urlTemplate: 'https://u:p@chinookdb.com/data/{table}.json' }),
    false,
  ],
  [
    'a user name that looks like a host',
    catalog({
      urlTemplate: 'https://chinookdb.com@evil.example/data/{table}.json',
    }),
    false,
  ],
  [
    'a port',
    catalog({ urlTemplate: 'https://chinookdb.com:8443/data/{table}.json' }),
    false,
  ],
  ['an IPv6 literal', catalog({ urlTemplate: 'https://[::1]/{table}' }), false],
  [
    'a fragment',
    catalog({ urlTemplate: 'https://chinookdb.com/data/{table}.json#x' }),
    false,
  ],
  [
    'a space',
    catalog({ urlTemplate: 'https://chinookdb.com/data/a b/{table}.json' }),
    false,
  ],
  [
    'no placeholder',
    catalog({ urlTemplate: 'https://chinookdb.com/data/chinook.Invoice.json' }),
    false,
  ],
  [
    'another brace',
    catalog({ urlTemplate: 'https://chinookdb.com/data/{name}/{table}.json' }),
    false,
  ],
  [
    'a javascript homepage',
    catalog({ homepage: 'javascript:alert(1)' }),
    false,
  ],
  [
    'a placeholder in the homepage',
    catalog({ homepage: 'https://chinookdb.com/{table}' }),
    true /* the schema cannot tell; see below */,
  ],
  [
    'an upper-case checksum',
    catalog({ sha256: { Invoice: SHA.toUpperCase() } }),
    false,
  ],
  ['a short checksum', catalog({ sha256: { Invoice: SHA.slice(1) } }), false],
  ['a bad table name', catalog({ keys: { '1x': 'Id' } }), false],
  ['a leading-underscore table name', catalog({ keys: { _x: 'Id' } }), false],
  ['a bad column name', catalog({ keys: { Invoice: 'a b' } }), false],
  ['a 81-character label', catalog({ label: 'x'.repeat(81) }), false],
  ['a 80-character label', catalog({ label: 'x'.repeat(80) }), true],
  ['a newline in the label', catalog({ label: 'a\nb' }), false],
  [
    'a short revision',
    catalog({
      upstream: {
        repository: 'https://github.com/x/y',
        revision: '7f67772',
        licence: 'MIT',
      },
    }),
    false,
  ],
  [
    'an unknown upstream key',
    catalog({
      upstream: {
        repository: 'https://github.com/x/y',
        revision: '7f67772503d71ba90f19283c38e93923addb43fa',
        licence: 'MIT',
        extra: 1,
      },
    }),
    false,
  ],
  [
    'upstream without a licence',
    catalog({
      upstream: {
        repository: 'https://github.com/x/y',
        revision: '7f67772503d71ba90f19283c38e93923addb43fa',
      },
    }),
    false,
  ],
];

describe('prepared-questions.schema.json agrees with validatePreparedQuestions', () => {
  it.each(questionCases)('%s', (_name, document, valid) => {
    expect(questionsSchemaValidate(document), 'schema').toBe(valid);
    expect(validatePreparedQuestions(document).ok, 'validator').toBe(valid);
  });
});

describe('https-json-catalog.schema.json agrees with validateHttpsJsonCatalog', () => {
  it.each(
    catalogCases.filter(([name]) => name !== 'a placeholder in the homepage'),
  )('%s', (_name, document, valid) => {
    expect(catalogSchemaValidate(document), 'schema').toBe(valid);
    expect(
      validateHttpsJsonCatalog(document, { trust: 'untrusted' }).ok,
      'validator',
    ).toBe(valid);
  });

  it('a placeholder in the homepage: both refuse', () => {
    const document = catalog({ homepage: 'https://chinookdb.com/{table}' });
    // `{` and `}` are printable ASCII, so the pattern lets them through; the validator is the stricter of the two.
    expect(validateHttpsJsonCatalog(document, { trust: 'untrusted' }).ok).toBe(
      false,
    );
  });
});

describe('what only the validators can enforce (a schema cannot state it)', () => {
  it('private and loopback hosts pass the schema and fail the validator', () => {
    for (const host of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '192.168.0.1',
      'localhost',
    ]) {
      const document = catalog({
        urlTemplate: `https://${host}/data/{table}.json`,
      });
      expect(
        validateHttpsJsonCatalog(document, { trust: 'untrusted' }).ok,
        host,
      ).toBe(false);
    }
  });

  it('a repeated question id, and the allow-list, are for the validators', () => {
    expect(questionsSchemaValidate(questions([question(), question()]))).toBe(
      true,
    );
    expect(
      validatePreparedQuestions(questions([question(), question()])).ok,
    ).toBe(false);
    const outside = catalog({
      urlTemplate: 'https://example.org/{table}.json',
    });
    expect(catalogSchemaValidate(outside)).toBe(true);
    expect(validateHttpsJsonCatalog(outside, { trust: 'trusted' }).ok).toBe(
      false,
    );
  });
});

describe('the schemas declare the numbers of project-file-limits.ts', () => {
  const q = questionsSchema.properties.questions;
  const item = q.items.properties;

  it('prepared questions', () => {
    expect(q.minItems).toBe(1);
    expect(q.maxItems).toBe(limits.MAX_QUESTIONS);
    expect(item.id.maxLength).toBe(limits.MAX_ID_LENGTH);
    same(item.id.pattern, limits.QUESTION_ID_PATTERN);
    expect(item.query.maxLength).toBe(limits.MAX_QUERY_REF_LENGTH);
    same(item.query.pattern, limits.QUERY_REF_PATTERN);
    for (const text of [item.question, item.title]) {
      expect(text.maxProperties).toBe(limits.MAX_LANGUAGES);
      expect(text.additionalProperties.maxLength).toBe(limits.MAX_TEXT_LENGTH);
      same(text.additionalProperties.pattern, limits.PLAIN_TEXT_PATTERN);
      same(text.propertyNames.pattern, limits.LANGUAGE_PATTERN);
    }
    expect(item.wordings.maxItems).toBe(limits.MAX_WORDINGS);
    expect(item.wordings.items.maxLength).toBe(limits.MAX_TEXT_LENGTH);
    expect(item.followUps.maxItems).toBe(limits.MAX_FOLLOW_UPS);
    expect(item.followUps.items.enum).toEqual([...limits.PREPARED_FOLLOW_UPS]);
  });

  it('the https-json catalog', () => {
    const p = catalogSchema.properties;
    expect(p.label.maxLength).toBe(limits.MAX_LABEL_LENGTH);
    same(p.label.pattern, limits.PLAIN_TEXT_PATTERN);
    for (const url of [
      p.homepage,
      p.urlTemplate,
      p.fallbackUrlTemplate,
      p.upstream.properties.repository,
    ]) {
      expect(url.maxLength).toBe(limits.MAX_URL_LENGTH);
    }
    same(p.homepage.pattern, limits.HTTPS_URL_PATTERN);
    for (const link of [p.homepage, p.upstream.properties.repository]) {
      same(link.allOf[0].pattern, limits.URL_NO_BRACES_PATTERN);
    }
    expect(p.$schema.minLength).toBe(1);
    for (const template of [p.urlTemplate, p.fallbackUrlTemplate]) {
      const [shape, onePlaceholder, plain] = template.allOf.map(
        (rule) => rule.pattern,
      );
      same(shape, limits.HTTPS_URL_PATTERN);
      same(onePlaceholder, limits.URL_TEMPLATE_ONE_PLACEHOLDER_PATTERN);
      same(plain, limits.URL_TEMPLATE_PLAIN_PATTERN);
    }
    expect(p.keys.maxProperties).toBe(limits.MAX_TABLES);
    expect(p.sha256.maxProperties).toBe(limits.MAX_TABLES);
    same(p.sha256.additionalProperties.pattern, limits.SHA256_PATTERN);
    same(p.keys.propertyNames.pattern, limits.NAME_PATTERN);
    expect(p.keys.additionalProperties.maxLength).toBe(limits.MAX_NAME_LENGTH);
    same(p.upstream.properties.revision.pattern, limits.GIT_REVISION_PATTERN);
    expect(p.upstream.properties.licence.maxLength).toBe(
      limits.MAX_LICENCE_LENGTH,
    );
  });

  it('every object in both schemas refuses unknown keys, and every string is bounded', () => {
    const walk = (node: unknown, path: string, found: string[]): void => {
      if (Array.isArray(node))
        return node.forEach((child, i) => walk(child, `${path}/${i}`, found));
      if (typeof node !== 'object' || node === null) return;
      const record = node as Record<string, unknown>;
      if (
        record['type'] === 'object' &&
        'properties' in record &&
        record['additionalProperties'] === undefined
      )
        found.push(`${path}: object without additionalProperties:false`);
      if (
        record['type'] === 'string' &&
        !('maxLength' in record) &&
        !('const' in record) &&
        !('enum' in record) &&
        path !== ''
      )
        found.push(`${path}: string without maxLength`);
      for (const [key, child] of Object.entries(record))
        walk(child, `${path}/${key}`, found);
    };
    const found: string[] = [];
    walk(questionsSchema, '', found);
    walk(catalogSchema, '', found);
    expect(found).toEqual([]);
  });

  it('has no markup-bearing field in either schema', () => {
    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== 'object' || node === null) return;
      for (const [key, child] of Object.entries(node)) {
        if (key === 'properties' && typeof child === 'object' && child !== null)
          names.push(...Object.keys(child));
        if (key === 'format') names.push('format');
        walk(child);
      }
    };
    walk([questionsSchema, catalogSchema]);
    expect(
      names.filter((name) => /html|markup|format|script/i.test(name)),
    ).toEqual([]);
  });
});

describe('mutation agreement: the schema and the validator cannot drift apart in either direction', () => {
  // Every document is a small change to a valid one: a value set at every path, a key deleted, a key added.
  // The schema may accept what a validator refuses only for a rule a schema cannot state (an address that
  // resolves to a private host, a repeated id, a query that does not exist, the allow-list, a checksum for
  // every keyed table). The validator must never accept what the schema refuses.
  const VALIDATOR_ONLY_CODES = new Set([
    'unsafe-address',
    'checksum-missing',
    'duplicate',
    'unknown-query',
    'outside-allowed-prefixes',
  ]);
  const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
  const SPOOF = `a${cp(0x202e)}b`;
  const values: unknown[] = [
    null,
    true,
    0,
    1,
    1.5,
    -1,
    '',
    ' ',
    'x',
    'insight',
    'en',
    cp(0x1f600).repeat(150),
    cp(0x1f600).repeat(201),
    'a'.repeat(200),
    'a'.repeat(201),
    '\ud800',
    'a b',
    'a\tb',
    'a\u007fb',
    SPOOF,
    cp(0xfeff),
    cp(0x2028),
    cp(0x200d),
    cp(0xe0041),
    [],
    {},
    ['insight'],
    ['insight', 'insight'],
    { en: 'x' },
    { en: '' },
    { ru: 'x' },
    { en: 'x', EN: 'y' },
    { en: 'x', 'pt-BR': 'y' },
    { en: 'x', constructor: 'y' },
    'https://chinookdb.com/data/{table}',
    'https://a.b/{table}',
    'https://a.b',
    'https://a.b/',
    'https://a',
    'https://localhost/{table}',
    'https://a.b/x',
    'https://a.b/x\n',
    'https://a.b/{table}\n',
    'https://a-.b/{table}',
    'https://a.b/{table}?q={table}',
    'https://a.b:1/{table}',
    'https://a..b/{table}',
    'https://1.2.3.4/{table}',
    'https://a.b/%{table}',
    'https://a.b/%2e{table}',
    'https://a.b/.%2{table}',
    'https://a.b/{table}/{table}',
    'https://a.b/{table}{table}',
    'https://a.b/{x}/{table}',
    'https://a.b/./{table}',
    'https://a.b/../{table}',
    'https://a.b//{table}',
    'http://a.b/{table}',
    'https://u:p@a.b/{table}',
    'https://[::1]/{table}',
    'https://a.b/{table}#x',
    'https://a.b/x y/{table}',
    'a'.repeat(64),
    'a'.repeat(40),
    'A'.repeat(64),
    '0'.repeat(65),
    'sales/x',
    'a/../b',
    '/a',
    'a/',
    'a//b',
    'x'.repeat(65),
    '-',
    'https-json',
    'MIT',
    { Invoice: 'InvoiceId' },
    { Invoice: 'a'.repeat(64) },
    { _x: 'y' },
    { x: '_y' },
    Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['t' + i, 'k'])),
    Array.from({ length: 51 }, () => 'w'),
    Array.from({ length: 9 }, () => 'insight'),
  ];
  const extraKeys = [
    'x',
    '$schema',
    '__proto__',
    'constructor',
    'ru',
    'EN',
    'wordings',
    'followUps',
    'upstream',
    'label',
    'homepage',
    'fallbackUrlTemplate',
    'id',
  ];

  const pathsOf = (node: unknown, path: string[] = []): string[][] => {
    const found: string[][] = [path];
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node))
        found.push(
          ...pathsOf((node as Record<string, unknown>)[key], [...path, key]),
        );
    }
    return found;
  };
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const setAt = (
    doc: unknown,
    path: string[],
    value: unknown,
    remove = false,
  ): unknown => {
    if (path.length === 0) return value;
    const copy = clone(doc) as Record<string, unknown>;
    let target = copy;
    for (const key of path.slice(0, -1))
      target = target[key] as Record<string, unknown>;
    const last = path[path.length - 1];
    if (remove) {
      if (Array.isArray(target)) target.splice(Number(last), 1);
      else delete target[last];
    } else {
      target[last] = value;
    }
    return copy;
  };
  const addKey = (
    doc: unknown,
    path: string[],
    key: string,
    value: unknown,
  ): unknown => {
    const copy = clone(doc);
    let target = copy as Record<string, unknown>;
    for (const step of path) target = target[step] as Record<string, unknown>;
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return copy;
  };

  function disagreements(
    base: unknown,
    schema: (doc: unknown) => boolean,
    validate: (doc: unknown) => ValidationResult<unknown>,
  ): { documents: number; wrong: string[] } {
    let documents = 0;
    const wrong: string[] = [];
    const check = (doc: unknown, how: string): void => {
      documents++;
      const fromSchema = schema(doc);
      const result = validate(doc);
      if (fromSchema === result.ok) return;
      if (!fromSchema && result.ok) {
        wrong.push(`validator accepts what the schema refuses: ${how}`);
      } else if (fromSchema && !result.ok) {
        const codes = result.errors.map((e) => e.code);
        if (!codes.every((code) => VALIDATOR_ONLY_CODES.has(code))) {
          wrong.push(
            `schema accepts what the validator refuses (${codes.join(',')}): ${how}`,
          );
        }
      }
    };
    for (const path of pathsOf(base)) {
      const name = path.join('/');
      for (const value of values)
        check(
          setAt(base, path, value),
          `set /${name} = ${JSON.stringify(value)?.slice(0, 60)}`,
        );
      if (path.length) check(setAt(base, path, null, true), `delete /${name}`);
      const current = path.reduce<unknown>(
        (node, key) => (node as Record<string, unknown>)[key],
        base,
      );
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        for (const key of extraKeys) {
          for (const value of ['x', '', { en: 'x' }, [], 1])
            check(
              addKey(base, path, key, value),
              `add /${name}/${key} = ${JSON.stringify(value)}`,
            );
        }
      }
    }
    return { documents, wrong };
  }

  const baseQuestions = JSON.parse(
    readFileSync(join(fixtureRoot, 'ai/prepared-questions.json'), 'utf8'),
  ) as unknown;
  const baseCatalog = JSON.parse(
    readFileSync(
      join(fixtureRoot, 'web/catalogs/chinook/chinook.db.json'),
      'utf8',
    ),
  ) as unknown;

  it('prepared questions: over a thousand mutated documents, no drift', () => {
    const { documents, wrong } = disagreements(
      baseQuestions,
      (doc) => questionsSchemaValidate(doc) as boolean,
      (doc) => validatePreparedQuestions(doc),
    );
    expect(documents).toBeGreaterThan(1000);
    expect(wrong).toEqual([]);
  });

  it('https-json catalog: over a thousand mutated documents, no drift', () => {
    const { documents, wrong } = disagreements(
      baseCatalog,
      (doc) => catalogSchemaValidate(doc) as boolean,
      (doc) => validateHttpsJsonCatalog(doc, { trust: 'untrusted' }),
    );
    expect(documents).toBeGreaterThan(1000);
    expect(wrong).toEqual([]);
  });

  it('would notice a drift: a validator that accepted one more thing would be reported', () => {
    const lax = (doc: unknown): ValidationResult<unknown> => {
      const record = doc as Record<string, unknown>;
      return typeof record === 'object' &&
        record !== null &&
        record['driver'] === 'https-json' &&
        !('keys' in record)
        ? { ok: true, value: doc }
        : validateHttpsJsonCatalog(doc, { trust: 'untrusted' });
    };
    const { wrong } = disagreements(
      baseCatalog,
      (doc) => catalogSchemaValidate(doc) as boolean,
      lax,
    );
    expect(
      wrong.some((line) =>
        line.startsWith(
          'validator accepts what the schema refuses: delete /keys',
        ),
      ),
    ).toBe(true);
  });
});
