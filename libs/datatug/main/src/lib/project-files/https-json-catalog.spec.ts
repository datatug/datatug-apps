import { describe, expect, it } from 'vitest';
import { MAX_PROJECT_FILE_BYTES, MAX_TABLES } from './project-file-limits';
import {
  parseHttpsJsonCatalog,
  tableUrls,
  validateHttpsJsonCatalog,
  type ProjectTrust,
} from './https-json-catalog';
import type { FileProblem, ValidationResult } from './project-file-problems';

const MIRROR =
  'https://cdn.jsdelivr.net/gh/datatug/chinookdb@0b6bb6ba22f680c9fb2fea9ec8107a8638dd8dc4/public/data/json/chinook.{table}.json';
const SHA = '88eb7faede360988e9c0f8f8d107e5093db5e712141de14d868f8947b43c373c';

/** The block of design 4.8, verbatim. */
const catalog = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  driver: 'https-json',
  label: 'Chinook (chinookdb.com)',
  homepage: 'https://chinookdb.com',
  urlTemplate: 'https://chinookdb.com/data/json/chinook.{table}.json',
  fallbackUrlTemplate: MIRROR,
  keys: { Invoice: 'InvoiceId' },
  sha256: { Invoice: SHA },
  upstream: {
    repository: 'https://github.com/lerocha/chinook-database',
    revision: '7f67772503d71ba90f19283c38e93923addb43fa',
    licence: 'MIT',
  },
  ...overrides,
});

const without = (
  record: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.includes(key)),
  );

const errorsOf = (
  result: ValidationResult<unknown>,
): readonly FileProblem[] => {
  if (result.ok) throw new Error('expected the file to be refused');
  return result.errors;
};
const refusedAt = (
  input: unknown,
  path: string,
  code?: string,
  trust: ProjectTrust = 'trusted',
): void => {
  const found = errorsOf(validateHttpsJsonCatalog(input, { trust })).filter(
    (e) => e.path === path,
  );
  expect(found.length, `no problem at ${path}`).toBeGreaterThan(0);
  if (code) expect(found.map((e) => e.code)).toContain(code);
};
const trusted = (input: unknown) =>
  validateHttpsJsonCatalog(input, { trust: 'trusted' });
const untrusted = (input: unknown) =>
  validateHttpsJsonCatalog(input, { trust: 'untrusted' });

describe('validateHttpsJsonCatalog: the shape of 4.8 and 5.2a', () => {
  it('accepts the block the design shows, for a trusted project, and returns it unchanged', () => {
    const input = catalog();
    expect(trusted(input)).toEqual({ ok: true, value: input });
  });

  it('accepts the smallest valid file', () => {
    const minimal = {
      driver: 'https-json',
      urlTemplate: 'https://chinookdb.com/data/json/chinook.{table}.json',
      keys: { Invoice: 'InvoiceId' },
      sha256: { Invoice: SHA },
    };
    expect(trusted(minimal)).toEqual({ ok: true, value: minimal });
  });

  it('accepts an optional $schema', () => {
    expect(trusted(catalog({ $schema: 'https://example.org/s.json' })).ok).toBe(
      true,
    );
  });

  it.each([null, 'x', 1, [], true])('refuses a root that is %j', (root) => {
    refusedAt(root, '', 'type');
  });

  it.each(['driver', 'urlTemplate', 'keys', 'sha256'])('requires %s', (key) => {
    refusedAt(without(catalog(), key), `/${key}`, 'required');
  });

  it.each(['label', 'homepage', 'fallbackUrlTemplate', 'upstream'])(
    'does not require %s',
    (key) => {
      expect(trusted(without(catalog(), key)).ok).toBe(true);
    },
  );

  it.each(['sqlite3', 'ingitdb', 'HTTPS-JSON', '', 3, null])(
    'refuses driver %j',
    (driver) => {
      refusedAt(catalog({ driver }), '/driver', 'const');
    },
  );

  it('refuses unknown keys at the top and in upstream, never ignoring them', () => {
    refusedAt(catalog({ path: 'x' }), '/path', 'unknown-key');
    refusedAt(
      catalog({ username: 'u', password: 'p' }),
      '/username',
      'unknown-key',
    );
    refusedAt(
      catalog({ headers: { Authorization: 'x' } }),
      '/headers',
      'unknown-key',
    );
    refusedAt(
      catalog({ upstream: { ...(catalog()['upstream'] as object), extra: 1 } }),
      '/upstream/extra',
      'unknown-key',
    );
    refusedAt(
      JSON.parse('{"driver":"https-json","__proto__":{"x":1}}') as unknown,
      '/__proto__',
      'unknown-key',
    );
  });
});

describe('addresses: the rules of 3.6 for every project', () => {
  const bad: [string, string][] = [
    ['plain http', 'http://chinookdb.com/data/json/chinook.{table}.json'],
    [
      "http to the visitor's own DataTug agent",
      'http://127.0.0.1:8989/data/{table}.json',
    ],
    [
      'credentials',
      'https://user:secret@chinookdb.com/data/json/chinook.{table}.json',
    ],
    [
      'a user name that looks like the trusted host',
      'https://chinookdb.com@evil.example/data/json/chinook.{table}.json',
    ],
    ['localhost', 'https://localhost/data/json/chinook.{table}.json'],
    ['loopback', 'https://127.0.0.1/data/json/chinook.{table}.json'],
    ['a private address', 'https://10.0.0.5/data/json/chinook.{table}.json'],
    ['a link-local address', 'https://169.254.169.254/{table}'],
    ['a number in decimal', 'https://2130706433/{table}'],
    ['an IPv6 loopback', 'https://[::1]/{table}'],
    ['an IPv6 unique local', 'https://[fd00::1]/{table}'],
    ['a port', 'https://chinookdb.com:8443/data/json/chinook.{table}.json'],
    ['a fragment', 'https://chinookdb.com/data/json/chinook.{table}.json#x'],
    ['a javascript address', 'javascript:alert(1)'],
    ['a data address', 'data:text/plain,{table}'],
    ['a relative address', '/data/json/chinook.{table}.json'],
  ];

  // A bracketed IPv6 literal and credentials are refused by the shape of the address already (the schema's
  // pattern); project-address-rules.spec.ts covers their ranges and the rules behind them.
  it.each(['urlTemplate', 'fallbackUrlTemplate'])(
    'refuses unsafe addresses in %s, for a trusted and an untrusted project',
    (key) => {
      for (const [, address] of bad) {
        refusedAt(catalog({ [key]: address }), `/${key}`, undefined, 'trusted');
        refusedAt(
          catalog({ [key]: address }),
          `/${key}`,
          undefined,
          'untrusted',
        );
      }
    },
  );

  it.each(
    bad.filter(
      ([name]) =>
        !/^(plain http|a javascript|a data|a relative|a fragment|a port|credentials|a user name|an IPv6|http to)/.test(
          name,
        ),
    ),
  )(
    'names loopback and private addresses as unsafe, not merely as outside the list: %s',
    (_name, address) => {
      const errors = errorsOf(untrusted(catalog({ urlTemplate: address })));
      expect(errors.map((e) => e.code)).toContain('unsafe-address');
    },
  );

  it('refuses a template without the placeholder, or with another brace', () => {
    refusedAt(
      catalog({
        urlTemplate: 'https://chinookdb.com/data/json/chinook.Invoice.json',
      }),
      '/urlTemplate',
      'missing-placeholder',
    );
    refusedAt(
      catalog({
        urlTemplate: 'https://chinookdb.com/data/json/chinook.{name}.json',
      }),
      '/urlTemplate',
      'missing-placeholder',
    );
    refusedAt(
      catalog({
        urlTemplate: 'https://chinookdb.com/data/{table}/{table2}.json',
      }),
      '/urlTemplate',
      'pattern',
    );
    refusedAt(
      catalog({
        urlTemplate: 'https://chinookdb.com/data/{table}/{table}.json',
      }),
      '/urlTemplate',
      'pattern',
    );
    refusedAt(
      catalog({ urlTemplate: 'https://{table}.chinookdb.com/data/x.json' }),
      '/urlTemplate',
    );
  });

  it('refuses addresses that are too long, empty, or not strings', () => {
    refusedAt(
      catalog({
        urlTemplate: `https://chinookdb.com/data/${'a'.repeat(2048)}{table}`,
      }),
      '/urlTemplate',
      'length',
    );
    refusedAt(catalog({ urlTemplate: '' }), '/urlTemplate', 'length');
    refusedAt(catalog({ urlTemplate: 5 }), '/urlTemplate', 'type');
    refusedAt(
      catalog({ fallbackUrlTemplate: null }),
      '/fallbackUrlTemplate',
      'type',
    );
  });

  it('refuses a homepage that is not a plain https link', () => {
    for (const homepage of [
      'http://chinookdb.com',
      'javascript:alert(1)',
      'https://chinookdb.com/{table}',
      'https://u:p@chinookdb.com',
      'https://localhost',
      'chinookdb.com',
      7,
    ]) {
      refusedAt(catalog({ homepage }), '/homepage');
    }
  });

  it('refuses an upstream repository that is not a plain https link', () => {
    refusedAt(
      catalog({
        upstream: {
          repository: 'git@github.com:lerocha/chinook-database.git',
          revision: '7f67772503d71ba90f19283c38e93923addb43fa',
          licence: 'MIT',
        },
      }),
      '/upstream/repository',
    );
  });
});

describe('the allow-list of address prefixes (3.6): a trusted project only', () => {
  const outside: [string, string][] = [
    [
      'another path on chinookdb.com',
      'https://chinookdb.com/other/chinook.{table}.json',
    ],
    ['another host', 'https://example.org/data/chinook.{table}.json'],
    [
      'another repository on jsDelivr',
      'https://cdn.jsdelivr.net/gh/attacker/chinookdb@0b6bb6ba22f680c9fb2fea9ec8107a8638dd8dc4/public/data/json/chinook.{table}.json',
    ],
    [
      'the right repository at a branch',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@main/public/data/json/chinook.{table}.json',
    ],
    [
      'the right repository at a short commit',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@0b6bb6b/public/data/json/chinook.{table}.json',
    ],
    [
      'a look-alike host',
      'https://chinookdb.com.evil.example/data/chinook.{table}.json',
    ],
    [
      'raw.githubusercontent.com, which is a file host but not ours',
      'https://raw.githubusercontent.com/datatug/chinookdb/main/public/data/json/chinook.{table}.json',
    ],
  ];

  it.each(outside)('refuses %s in urlTemplate', (_name, address) => {
    refusedAt(
      catalog({ urlTemplate: address }),
      '/urlTemplate',
      'outside-allowed-prefixes',
      'trusted',
    );
  });

  it.each(outside)('refuses %s in fallbackUrlTemplate', (_name, address) => {
    refusedAt(
      catalog({ fallbackUrlTemplate: address }),
      '/fallbackUrlTemplate',
      'outside-allowed-prefixes',
      'trusted',
    );
  });

  it('accepts the same addresses, shape-wise, for an untrusted project: the rule is about what may be read, not what may be written', () => {
    for (const [, address] of outside.filter(
      ([name]) => !/dot-dot|look-alike/.test(name),
    )) {
      expect(untrusted(catalog({ urlTemplate: address })).ok, address).toBe(
        true,
      );
    }
  });

  it('accepts the chinookdb.com data path and a jsDelivr mirror pinned to 40 characters', () => {
    expect(trusted(catalog()).ok).toBe(true);
    expect(trusted(catalog({ urlTemplate: MIRROR })).ok).toBe(true);
  });
});

describe('checksums and keys', () => {
  it('requires every sha256 to be 64 lower-case hexadecimal characters', () => {
    for (const sum of [
      '',
      'abc',
      SHA.toUpperCase(),
      SHA + '0',
      SHA.slice(1),
      'g'.repeat(64),
      5,
    ]) {
      refusedAt(catalog({ sha256: { Invoice: sum } }), '/sha256/Invoice');
    }
  });

  it('needs a checksum for every keyed table when a fallback address is given', () => {
    refusedAt(
      catalog({ keys: { Invoice: 'InvoiceId', Customer: 'CustomerId' } }),
      '/sha256/Customer',
      'checksum-missing',
    );
    expect(
      trusted(
        catalog({
          keys: { Invoice: 'InvoiceId', Customer: 'CustomerId' },
          sha256: { Invoice: SHA, Customer: SHA },
        }),
      ).ok,
    ).toBe(true);
  });

  it('lets a project without a fallback keep a table without a checksum', () => {
    const input = without(
      catalog({ keys: { Invoice: 'InvoiceId', Customer: 'CustomerId' } }),
      'fallbackUrlTemplate',
    );
    expect(trusted(input).ok).toBe(true);
  });

  it('requires one to 100 tables, with plain names and plain column names', () => {
    refusedAt(catalog({ keys: {} }), '/keys', 'count');
    refusedAt(catalog({ sha256: {} }), '/sha256', 'count');
    const many = Object.fromEntries(
      Array.from({ length: MAX_TABLES + 1 }, (_, i) => [`T${i}`, 'Id']),
    );
    refusedAt(
      catalog({ keys: many, fallbackUrlTemplate: undefined }),
      '/keys',
      'count',
    );
    for (const table of [
      '__proto__',
      '_x',
      '1x',
      'a b',
      'a/b',
      '../x',
      'a.b',
      'x'.repeat(65),
      '',
    ]) {
      const keys = JSON.parse(`{${JSON.stringify(table)}:"Id"}`) as unknown;
      refusedAt(
        catalog({ keys }),
        `/keys/${table.replace(/~/g, '~0').replace(/\//g, '~1')}`,
        'unknown-key',
      );
    }
    for (const column of ['', '_id', 'a b', 'Id;DROP', 'x'.repeat(65), 5]) {
      refusedAt(catalog({ keys: { Invoice: column } }), '/keys/Invoice');
    }
    refusedAt(catalog({ keys: 'InvoiceId' }), '/keys', 'type');
    refusedAt(catalog({ sha256: [SHA] }), '/sha256', 'type');
  });

  it('returns maps with only the declared tables', () => {
    const result = trusted(catalog({ keys: { Invoice: 'InvoiceId' } }));
    expect(result.ok && Object.keys(result.value.keys)).toEqual(['Invoice']);
  });
});

describe('text fields are text', () => {
  const markup = '<img src=x onerror=alert(1)><script>alert(2)</script>';

  it('carries markup in the label as written: the page renders it as text', () => {
    const result = trusted(catalog({ label: markup }));
    expect(result.ok && result.value.label).toBe(markup);
  });

  it('keeps the label to 80 characters and one line', () => {
    expect(trusted(catalog({ label: 'x'.repeat(80) })).ok).toBe(true);
    refusedAt(catalog({ label: 'x'.repeat(81) }), '/label', 'length');
    refusedAt(catalog({ label: '' }), '/label', 'length');
    refusedAt(catalog({ label: 'a\nb' }), '/label', 'pattern');
    refusedAt(catalog({ label: 5 }), '/label', 'type');
  });

  it('has no field meant to hold markup', () => {
    refusedAt(catalog({ labelHtml: '<b>x</b>' }), '/labelHtml', 'unknown-key');
  });

  it('checks upstream: a full revision, a short licence', () => {
    refusedAt(
      catalog({
        upstream: {
          repository: 'https://github.com/x/y',
          revision: 'main',
          licence: 'MIT',
        },
      }),
      '/upstream/revision',
    );
    refusedAt(
      catalog({
        upstream: {
          repository: 'https://github.com/x/y',
          revision: '7f67772',
          licence: 'MIT',
        },
      }),
      '/upstream/revision',
    );
    refusedAt(
      catalog({
        upstream: {
          repository: 'https://github.com/x/y',
          revision: '7f67772503d71ba90f19283c38e93923addb43fa',
          licence: 'x'.repeat(65),
        },
      }),
      '/upstream/licence',
      'length',
    );
    refusedAt(
      catalog({
        upstream: {
          revision: '7f67772503d71ba90f19283c38e93923addb43fa',
          licence: 'MIT',
        },
      }),
      '/upstream/repository',
      'required',
    );
    refusedAt(catalog({ upstream: 'x' }), '/upstream', 'type');
  });
});

describe('parseHttpsJsonCatalog: the text of the file', () => {
  it('parses and validates', () => {
    expect(
      parseHttpsJsonCatalog(JSON.stringify(catalog()), { trust: 'trusted' }).ok,
    ).toBe(true);
  });

  it('refuses text that is not JSON', () => {
    expect(
      errorsOf(parseHttpsJsonCatalog('nope', { trust: 'trusted' }))[0].code,
    ).toBe('not-json');
  });

  it('refuses a file over 256 KB, measured in bytes', () => {
    const big = JSON.stringify(catalog()) + ' '.repeat(MAX_PROJECT_FILE_BYTES);
    expect(
      errorsOf(parseHttpsJsonCatalog(big, { trust: 'trusted' }))[0].code,
    ).toBe('too-large');
  });

  it('applies the trust it is given', () => {
    const text = JSON.stringify(
      catalog({ urlTemplate: 'https://example.org/{table}.json' }),
    );
    expect(parseHttpsJsonCatalog(text, { trust: 'untrusted' }).ok).toBe(true);
    expect(
      errorsOf(parseHttpsJsonCatalog(text, { trust: 'trusted' }))[0].code,
    ).toBe('outside-allowed-prefixes');
  });
});

describe('labels that look like other labels, and the template that cannot become a different address (review r1)', () => {
  it.each([
    0x202e, 0x2066, 0x2069, 0x200f, 0x2028, 0x2029, 0x200b, 0xfeff, 0xe0041,
  ])('refuses U+%s in a label', (code) => {
    refusedAt(
      catalog({ label: `Chinook${String.fromCodePoint(code)}DB` }),
      '/label',
      'pattern',
    );
  });

  it('counts a label in code points', () => {
    expect(
      trusted(catalog({ label: String.fromCodePoint(0x1f600).repeat(80) })).ok,
    ).toBe(true);
    refusedAt(
      catalog({ label: String.fromCodePoint(0x1f600).repeat(81) }),
      '/label',
      'length',
    );
  });

  it('refuses an empty $schema', () => {
    refusedAt(catalog({ $schema: '' }), '/$schema', 'length');
  });

  it.each(['homepage'])('refuses a placeholder or any brace in %s', (key) => {
    refusedAt(
      catalog({ [key]: 'https://chinookdb.com/{table}' }),
      `/${key}`,
      'pattern',
    );
    refusedAt(
      catalog({ [key]: 'https://chinookdb.com/{x}' }),
      `/${key}`,
      'pattern',
    );
  });

  it('refuses a placeholder or any brace in upstream.repository', () => {
    const upstream = {
      repository: 'https://github.com/{table}/x',
      revision: '7f67772503d71ba90f19283c38e93923addb43fa',
      licence: 'MIT',
    };
    refusedAt(catalog({ upstream }), '/upstream/repository', 'pattern');
  });

  // Blocker B1: the template the reviewer used, checked here as a whole catalog, for a trusted project.
  const COMMIT = '0b6bb6ba22f680c9fb2fea9ec8107a8638dd8dc4';
  it.each([
    `https://cdn.jsdelivr.net/gh/datatug/chinookdb@${COMMIT}/.%2{table}/.%2{table}/evil/repo@main/x.json`,
    'https://chinookdb.com/data/.%2{table}/x.json',
    `https://cdn.jsdelivr.net/gh/datatug/chinookdb@${COMMIT}/%2{table}%2{table}/%2{table}%2{table}/evil/repo@main/{table}.json`,
  ])(
    'refuses the encoded-dot template %s, whatever the tables are called',
    (template) => {
      const keys = { Invoice: 'InvoiceId', e: 'Id', E: 'Id', a2e: 'Id' };
      const sha256 = Object.fromEntries(Object.keys(keys).map((k) => [k, SHA]));
      for (const trust of ['trusted', 'untrusted'] as const) {
        for (const key of ['urlTemplate', 'fallbackUrlTemplate']) {
          const found = errorsOf(
            validateHttpsJsonCatalog(
              catalog({ [key]: template, keys, sha256 }),
              { trust },
            ),
          ).filter((e) => e.path === `/${key}`);
          expect(found.length, `${trust} ${key}`).toBeGreaterThan(0);
        }
      }
    },
  );

  it('accepts a fallback address only through the checked expansion: tableUrls', () => {
    const result = trusted(catalog());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const urls = tableUrls(result.value, 'Invoice', 'trusted');
    expect(urls.primary.ok && urls.primary.url.href).toBe(
      'https://chinookdb.com/data/json/chinook.Invoice.json',
    );
    expect(urls.fallback?.ok && urls.fallback.url.href).toBe(
      `https://cdn.jsdelivr.net/gh/datatug/chinookdb@${COMMIT}/public/data/json/chinook.Invoice.json`,
    );
    const bad = tableUrls(result.value, 'in/valid', 'trusted');
    expect(bad.primary.ok).toBe(false);
    expect(bad.fallback?.ok).toBe(false);
    const noFallback = tableUrls(
      without(
        result.value as unknown as Record<string, unknown>,
        'fallbackUrlTemplate',
      ) as never,
      'Invoice',
      'trusted',
    );
    expect(noFallback.fallback).toBeUndefined();
  });

  it('expands under the same trust it was validated with: an outside address passes untrusted, not trusted', () => {
    const result = untrusted(
      without(
        catalog({ urlTemplate: 'https://example.org/{table}.json' }),
        'fallbackUrlTemplate',
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(tableUrls(result.value, 'Invoice', 'untrusted').primary.ok).toBe(
      true,
    );
    expect(tableUrls(result.value, 'Invoice', 'trusted').primary.ok).toBe(
      false,
    );
  });

  it('is a BOM-tolerant file reader too', () => {
    const text = String.fromCodePoint(0xfeff) + JSON.stringify(catalog());
    expect(parseHttpsJsonCatalog(text, { trust: 'trusted' }).ok).toBe(true);
  });
});
