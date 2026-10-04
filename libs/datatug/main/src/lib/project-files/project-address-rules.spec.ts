import { describe, expect, it } from 'vitest';
import {
  ALLOWED_DATA_ADDRESS_PREFIXES,
  beginsWithAllowedDataPrefix,
  checkAllowedDataAddress,
  checkProjectAddress,
  checkUrlTemplate,
  CheckedDataUrl,
  expandUrlTemplate,
  type ProjectTrust,
} from './project-address-rules';

const SHA = '0b6bb6ba22f680c9fb2fea9ec8107a8638dd8dc4';
const MIRROR = `https://cdn.jsdelivr.net/gh/datatug/chinookdb@${SHA}/`;
const MIRROR_TEMPLATE = `${MIRROR}public/data/json/chinook.{table}.json`;
const CHINOOKDB_TEMPLATE =
  'https://chinookdb.com/data/json/chinook.{table}.json';

describe('checkProjectAddress: concrete addresses every project must pass (3.6)', () => {
  it.each([
    'https://chinookdb.com/data/json/chinook.Invoice.json',
    `${MIRROR}public/data/json/chinook.Invoice.json`,
    'https://chinookdb.com',
    'https://example.org/a/b.json?x=1',
    'https://8.8.8.8/data/chinook.Invoice.json', // a public number is not refused by the general rules
    'https://[2606:4700::1111]/data/x.json',
    'https://example.com./x',
    'https://xn--80ak6aa92e.com/x',
    'https://127.0.0.1.nip.io/x', // a name; what it resolves to is what the allow-list is for
  ])('accepts %s', (address) => {
    expect(checkProjectAddress(address)).toBeUndefined();
  });

  it.each([
    ['plain http', 'http://chinookdb.com/data/x.json'],
    [
      'http to localhost, which the executor allows today',
      'http://localhost:50501/v1/databases/x/dtql',
    ],
    ['http to 127.0.0.1', 'http://127.0.0.1/x'],
    ['http to [::1]', 'http://[::1]/x'],
    ['ftp', 'ftp://chinookdb.com/data/x'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:application/json,[]'],
    ['file', 'file:///etc/passwd'],
    ['scheme-relative', '//chinookdb.com/data/x.json'],
    ['relative path', '/data/x.json'],
    ['one slash', 'https:/example.com/x'],
    ['no slashes', 'https:example.com'],
    ['upper-case scheme not normalised', 'HTTPS://chinookdb.com/data/x.json'],
    ['empty', ''],
  ])('refuses %s', (_name, address) => {
    expect(checkProjectAddress(address)).toBeTruthy();
  });

  it.each([
    ['a user name', 'https://user@chinookdb.com/data/x.json'],
    [
      'a user name and password',
      'https://user:secret@chinookdb.com/data/x.json',
    ],
    ['a password only', 'https://:secret@chinookdb.com/data/x.json'],
    [
      'a trusted-looking user name before another host',
      'https://chinookdb.com@evil.example/data/x.json',
    ],
    [
      'an @ in the authority with a backslash',
      'https://evil.example\\@chinookdb.com/data/x.json',
    ],
    [
      'an encoded @ in the user part',
      'https://chinookdb.com%40evil.example@host.example/x',
    ],
  ])('refuses credentials: %s', (_name, address) => {
    expect(checkProjectAddress(address)).toBeTruthy();
  });

  it.each([
    'https://localhost/x',
    'https://LOCALHOST/x',
    'https://localhost./x',
    'https://localhost../x',
    'https://localhost.../x',
    'https://app.localhost/x',
    'https://printer.local/x',
    'https://db.internal/x',
    'https://metadata.google.internal/x',
    'https://host.localdomain/x',
    'https://router.home.arpa/x',
    'https://intranet/x', // a single-label name can only be a local machine
    'https://metadata/x',
    'https://router/x',
    'https://%6c%6f%63%61%6c%68%6f%73%74/x', // percent-encoded localhost
    'https://a..b/x', // an empty label
  ])('refuses the local or malformed name %s', (address) => {
    expect(checkProjectAddress(address)).toBeTruthy();
  });

  it.each([
    ['loopback', 'https://127.0.0.1/x'],
    ['loopback, whole /8', 'https://127.255.255.254/x'],
    ['this network', 'https://0.0.0.0/x'],
    ['zero', 'https://0/x'],
    ['10/8', 'https://10.0.0.1/x'],
    ['172.16/12 low', 'https://172.16.0.1/x'],
    ['172.16/12 high', 'https://172.31.255.255/x'],
    ['192.168/16', 'https://192.168.1.1/x'],
    [
      'link-local and cloud metadata',
      'https://169.254.169.254/latest/meta-data',
    ],
    ['shared address space', 'https://100.64.0.1/x'],
    ['benchmarking', 'https://198.18.0.1/x'],
    ['documentation 192.0.2/24', 'https://192.0.2.1/x'],
    ['documentation 203.0.113/24', 'https://203.0.113.9/x'],
    ['multicast', 'https://224.0.0.1/x'],
    ['broadcast', 'https://255.255.255.255/x'],
    ['decimal spelling of 127.0.0.1', 'https://2130706433/x'],
    ['hexadecimal spelling', 'https://0x7f000001/x'],
    ['dotted hexadecimal', 'https://0x7f.0x0.0x0.0x1/x'],
    ['hexadecimal with empty parts', 'https://0x.0x.0x.0x/x'],
    ['octal spelling', 'https://0177.0.0.1/x'],
    ['short form', 'https://127.1/x'],
    ['loopback with a trailing dot', 'https://127.0.0.1./x'],
    ['IPv6 loopback', 'https://[::1]/x'],
    ['IPv6 unspecified', 'https://[::]/x'],
    ['IPv4-mapped loopback, dotted', 'https://[::ffff:127.0.0.1]/x'],
    ['IPv4-mapped loopback, hex', 'https://[::ffff:7f00:1]/x'],
    [
      'IPv4-mapped loopback, fully written',
      'https://[0:0:0:0:0:ffff:7f00:1]/x',
    ],
    [
      'IPv4-mapped loopback, fully written with a dotted tail',
      'https://[0:0:0:0:0:ffff:127.0.0.1]/x',
    ],
    ['IPv4-mapped private', 'https://[::ffff:10.1.2.3]/x'],
    [
      'IPv4-mapped public (the whole ::/8 is refused)',
      'https://[::ffff:8.8.8.8]/x',
    ],
    ['IPv4-translated loopback', 'https://[::ffff:0:7f00:1]/x'],
    ['IPv4-translated, dotted', 'https://[::ffff:0:127.0.0.1]/x'],
    ['IPv4-compatible loopback, hex', 'https://[::7f00:1]/x'],
    ['IPv4-compatible loopback, dotted', 'https://[::127.0.0.1]/x'],
    ['NAT64 well-known prefix, private', 'https://[64:ff9b::a00:1]/x'],
    [
      'NAT64 well-known prefix, loopback, dotted',
      'https://[64:ff9b::127.0.0.1]/x',
    ],
    ['NAT64 local-use prefix', 'https://[64:ff9b:1::7f00:1]/x'],
    ['NAT64 local-use prefix, public tail', 'https://[64:ff9b:1::808:808]/x'],
    ['6to4 of a private address', 'https://[2002:a00:1::]/x'],
    ['6to4 of loopback', 'https://[2002:7f00:1::]/x'],
    ['Teredo', 'https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/x'],
    ['Teredo, short', 'https://[2001::1]/x'],
    ['IPv6 unique local, fd', 'https://[fd00::1]/x'],
    ['IPv6 unique local, fc', 'https://[fc12:3456::1]/x'],
    ['IPv6 link-local', 'https://[fe80::1]/x'],
    ['IPv6 site-local', 'https://[fec0::1]/x'],
    ['IPv6 multicast', 'https://[ff02::1]/x'],
    ['IPv6 documentation', 'https://[2001:db8::1]/x'],
    ['IPv6 discard', 'https://[100::1]/x'],
    ['IPv6 ORCHID', 'https://[2001:10::1]/x'],
  ])('refuses a number: %s', (_name, address) => {
    expect(checkProjectAddress(address)).toBeTruthy();
  });

  it.each([
    ['a port', 'https://chinookdb.com:8443/data/x.json'],
    ['an empty port', 'https://chinookdb.com:/data/x.json'],
    ['a port on an IPv6 literal', 'https://[2606:4700::1111]:8443/x'],
    ['a fragment', 'https://chinookdb.com/data/x.json#a'],
    ['a space', 'https://chinookdb.com/data/x y.json'],
    ['a newline', 'https://chinookdb.com/data/x\n.json'],
    ['a backslash', 'https://chinookdb.com\\data\\x.json'],
    ['a non-ASCII character', 'https://chinookdb.com/data/é.json'],
    ['an internationalised host', 'https://chïnookdb.com/data/x.json'],
    [
      'a full-width dot host',
      `https://127${String.fromCodePoint(0x3002)}0${String.fromCodePoint(0x3002)}0${String.fromCodePoint(0x3002)}1/x`,
    ],
    ['an unterminated IPv6 literal', 'https://[::1/x'],
    ['a malformed host', 'https://exa%mple.com/x'],
    ['an unscoped zone identifier', 'https://[fe80::1%25eth0]/x'],
    ['a brace', 'https://chinookdb.com/data/{name}.json'],
    [
      'the table placeholder (a template is not an address)',
      'https://chinookdb.com/data/{table}.json',
    ],
    [
      'an address over 2048 characters',
      `https://chinookdb.com/${'a'.repeat(2048)}`,
    ],
  ])('refuses %s', (_name, address) => {
    expect(checkProjectAddress(address)).toBeTruthy();
  });
});

describe('the allow-list of address prefixes on a concrete address (3.6, trusted project)', () => {
  it('lists the canonical and legacy Chinook data paths and a pinned jsDelivr mirror', () => {
    expect(ALLOWED_DATA_ADDRESS_PREFIXES).toEqual([
      'https://chinook.demodb.dev/data/',
      'https://chinookdb.com/data/',
    ]);
    expect(beginsWithAllowedDataPrefix(`${MIRROR}x.json`)).toBe(true);
  });

  it.each([
    'https://chinook.demodb.dev/data/json/chinook.Invoice.json',
    'https://chinookdb.com/data/json/chinook.Invoice.json',
    'https://chinookdb.com/data/chinook.json',
    `${MIRROR}public/data/json/chinook.Invoice.json`,
  ])('accepts %s', (address) => {
    expect(checkAllowedDataAddress(address)).toBeUndefined();
  });

  it.each([
    ['canonical look-alike host', 'https://chinook.demodb.dev.evil.example/data/x.json'],
    ['canonical sibling host', 'https://evil.demodb.dev/data/x.json'],
    ['canonical wrong path', 'https://chinook.demodb.dev/database/x.json'],
    ['canonical traversal', 'https://chinook.demodb.dev/data/%2e%2e/private/x.json'],
    [
      'another path on chinookdb.com',
      'https://chinookdb.com/other/chinook.Invoice.json',
    ],
    ['the site root', 'https://chinookdb.com/'],
    [
      'a path that merely begins like data',
      'https://chinookdb.com/database/x.json',
    ],
    [
      'a host that begins with chinookdb.com',
      'https://chinookdb.com.evil.example/data/x.json',
    ],
    ['a sub-domain', 'https://evil.chinookdb.com/data/x.json'],
    [
      "the allowed text inside another host's path",
      'https://evil.example/https://chinookdb.com/data/x.json',
    ],
    [
      'a dot-dot that climbs out of the prefix',
      'https://chinookdb.com/data/../private/x.json',
    ],
    ['an encoded dot-dot', 'https://chinookdb.com/data/%2e%2e/private/x.json'],
    [
      'a dot-dot that climbs out of the mirror',
      `${MIRROR}../../../evil/repo@main/x.json`,
    ],
    [
      'another repository on jsDelivr',
      `https://cdn.jsdelivr.net/gh/attacker/chinookdb@${SHA}/x.json`,
    ],
    [
      'the right repository at a branch',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@main/public/x.json',
    ],
    [
      'the right repository at a tag',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@v1.0.0/public/x.json',
    ],
    [
      'a short commit',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@0b6bb6b/public/x.json',
    ],
    [
      'a 41-character commit',
      `https://cdn.jsdelivr.net/gh/datatug/chinookdb@${SHA}a/x.json`,
    ],
    [
      'an upper-case commit',
      `https://cdn.jsdelivr.net/gh/datatug/chinookdb@${SHA.toUpperCase()}/x.json`,
    ],
    [
      'another repository whose name begins the same',
      `https://cdn.jsdelivr.net/gh/datatug/chinookdb-evil@${SHA}/x.json`,
    ],
    [
      'another owner in another case',
      `https://cdn.jsdelivr.net/gh/Datatug/chinookdb@${SHA}/x.json`,
    ],
    ['jsDelivr npm', 'https://cdn.jsdelivr.net/npm/chinookdb@1.0.0/x.json'],
    ['plain http', 'http://chinookdb.com/data/x.json'],
    ['unrelated host', 'https://example.org/data/x.json'],
  ])('refuses %s', (_name, address) => {
    expect(checkAllowedDataAddress(address)).toBeTruthy();
  });

  it('compares text, never a host', () => {
    expect(beginsWithAllowedDataPrefix('https://chinookdb.com/data')).toBe(
      false,
    );
    expect(beginsWithAllowedDataPrefix('https://chinookdb.com/data/')).toBe(
      true,
    );
  });

  it('refuses an address the URL parser cannot read', () => {
    expect(
      checkAllowedDataAddress('https://chinookdb.com/data/['),
    ).toBeUndefined(); // parses; the general rules are checkProjectAddress's
    expect(
      checkAllowedDataAddress('https://chinookdb.com/data/x:y@@'),
    ).toBeUndefined();
  });
});

describe('checkUrlTemplate: a template is held to a fixed pattern', () => {
  it.each([
    CHINOOKDB_TEMPLATE,
    MIRROR_TEMPLATE,
    `${MIRROR}public/{table}.json`,
    'https://chinookdb.com/data/{table}',
  ])('accepts %s for a trusted project', (template) => {
    expect(checkUrlTemplate(template, 'trusted')).toBeUndefined();
    expect(checkUrlTemplate(template, 'untrusted')).toBeUndefined();
  });

  // Review r1, blocker B1: an encoded dot segment spelled with the table name splices into `..` and climbs out of the prefix.
  it.each([
    [
      "the reviewer's jsDelivr case",
      `${MIRROR}.%2{table}/.%2{table}/evil/repo@main/x.json`,
    ],
    [
      'the same on chinookdb.com',
      'https://chinookdb.com/data/.%2{table}/x.json',
    ],
    [
      'two splices in one segment',
      'https://chinookdb.com/data/%2{table}%2{table}/x.json',
    ],
    [
      'mirror with both splices in two segments',
      `${MIRROR}%2{table}%2{table}/%2{table}%2{table}/evil/repo@main/{table}.json`,
    ],
    ['an encoded dot-dot', 'https://chinookdb.com/data/%2e%2e/{table}'],
    [
      'an encoded dot-dot, upper case, twice',
      'https://chinookdb.com/data/%2E%2E/%2e%2E/{table}',
    ],
    ['a dot and an encoded dot', 'https://chinookdb.com/data/.%2e/{table}'],
    [
      'an encoded slash with dots',
      'https://chinookdb.com/data/%2e%2e%2f{table}',
    ],
    [
      'a double-encoded dot-dot',
      'https://chinookdb.com/data/%252e%252e/{table}',
    ],
    [
      'an encoded dot-dot on the mirror',
      `${MIRROR}%2e%2e/%2e%2e/other/repo/{table}`,
    ],
    [
      'an encoded slash after the placeholder',
      `${MIRROR}{table}/..%2f..%2f..%2fgh/evil/repo@main/x`,
    ],
    ['a percent sign anywhere', 'https://chinookdb.com/data/a%20b/{table}'],
  ])('refuses, for both kinds of project, %s', (_name, template) => {
    expect(checkUrlTemplate(template, 'trusted')).toMatch(/%/);
    expect(checkUrlTemplate(template, 'untrusted')).toMatch(/%/);
  });

  it.each([
    ['a dot-dot segment', 'https://chinookdb.com/data/../../x/{table}'],
    [
      'a dot-dot after the placeholder',
      'https://chinookdb.com/data/{table}/../../../x',
    ],
    ['a dot-dot on the mirror', `${MIRROR}../../other/repo@main/{table}`],
    ['a single-dot segment', 'https://chinookdb.com/data/./{table}'],
    [
      'a segment that starts with a dot',
      'https://chinookdb.com/data/..;/{table}',
    ],
    ['a hidden segment', 'https://chinookdb.com/data/.x/{table}'],
    ['a semicolon dot-dot', 'https://chinookdb.com/data/;/../{table}'],
    ['an empty segment', 'https://chinookdb.com/data//evil.example/{table}'],
    ['an empty segment on the mirror', `${MIRROR}/{table}`],
    ['a trailing slash', 'https://chinookdb.com/data/{table}/'],
    [
      'a placeholder that adjoins a dot-only segment',
      'https://chinookdb.com/data/./.{table}',
    ],
  ])('refuses %s', (_name, template) => {
    expect(checkUrlTemplate(template, 'untrusted')).toBeTruthy();
    expect(checkUrlTemplate(template, 'trusted')).toBeTruthy();
  });

  it.each([
    ['the placeholder twice', 'https://chinookdb.com/data/{table}{table}'],
    [
      'the placeholder twice in two segments',
      'https://chinookdb.com/data/{table}/{table}',
    ],
    ['no placeholder', 'https://chinookdb.com/data'],
    ['an unclosed placeholder', 'https://chinookdb.com/data/{table'],
    ['another placeholder name', 'https://chinookdb.com/data/{Table}'],
    ['a placeholder in the host', 'https://{table}.evil.example/x'],
    ['a placeholder in the user part', 'https://{table}@evil.example/x'],
    ['a placeholder in a query', 'https://chinookdb.com/data/x.json?t={table}'],
    ['a query', 'https://chinookdb.com/data/{table}?x=1'],
    ['a fragment', 'https://chinookdb.com/data/{table}#frag'],
    [
      'a placeholder joined to an @ in its segment',
      'https://chinookdb.com/data/{table}@evil.example/',
    ],
    ['a placeholder joined to a colon', 'https://chinookdb.com/data/{table}:x'],
    ['a port', 'https://chinookdb.com:443/data/{table}'],
    ['http', 'http://chinookdb.com/data/{table}'],
    ['credentials', 'https://chinookdb.com@evil.example/data/{table}'],
    ['an upper-case host', 'https://CHINOOKDB.com/data/{table}'],
    ['a backslash', 'https://chinookdb.com/data\\..\\{table}'],
    ['a tab', 'https://chinookdb.com/data/\t../{table}'],
    ['a newline', 'https://chinookdb.com/data/\n{table}'],
    ['localhost', 'https://localhost/{table}.json'],
    ['a private number', 'https://10.0.0.5/{table}.json'],
    ['no path at all', 'https://chinookdb.com{table}'],
    ['an empty template', ''],
  ])('refuses %s', (_name, template) => {
    expect(checkUrlTemplate(template, 'untrusted')).toBeTruthy();
    expect(checkUrlTemplate(template, 'trusted')).toBeTruthy();
  });

  it.each([
    ['another host', 'https://example.org/data/{table}.json'],
    [
      'another path on chinookdb.com',
      'https://chinookdb.com/other/{table}.json',
    ],
    ['a path that begins like data', 'https://chinookdb.com/database/{table}'],
    ['the placeholder in the prefix', 'https://chinookdb.com/data{table}'],
    ['a look-alike host', 'https://chinookdb.com.evil.example/data/{table}'],
    ['a trailing-dot host', 'https://chinookdb.com./data/{table}'],
    [
      'another repository on jsDelivr',
      `https://cdn.jsdelivr.net/gh/attacker/chinookdb@${SHA}/public/{table}.json`,
    ],
    [
      'the right repository at a branch',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@main/{table}',
    ],
    [
      'a short commit',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@0b6bb6b/{table}',
    ],
    [
      'an upper-case commit',
      `https://cdn.jsdelivr.net/gh/datatug/chinookdb@${SHA.toUpperCase()}/{table}`,
    ],
    [
      'a 41-character commit',
      `https://cdn.jsdelivr.net/gh/datatug/chinookdb@${SHA}f/{table}`,
    ],
    [
      'a 39-character commit',
      `https://cdn.jsdelivr.net/gh/datatug/chinookdb@${SHA.slice(1)}/{table}`,
    ],
    [
      'a repository that begins the same',
      `https://cdn.jsdelivr.net/gh/datatug/chinookdb-evil@${SHA}/{table}`,
    ],
    [
      'another owner in another case',
      `https://cdn.jsdelivr.net/gh/Datatug/chinookdb@${SHA}/{table}`,
    ],
    ['jsDelivr npm', `https://cdn.jsdelivr.net/npm/x@${SHA}/{table}`],
  ])('refuses %s for a trusted project only', (_name, template) => {
    expect(checkUrlTemplate(template, 'untrusted')).toBeUndefined();
    expect(checkUrlTemplate(template, 'trusted')).toBeTruthy();
  });
});

describe('expandUrlTemplate: the only way to a fetchable URL', () => {
  const expand = (
    template: string,
    table: string,
    trust: ProjectTrust = 'trusted',
  ) => expandUrlTemplate(template, table, trust);

  it('returns the parsed address, checked, as a CheckedDataUrl', () => {
    const result = expand(CHINOOKDB_TEMPLATE, 'Invoice');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBeInstanceOf(CheckedDataUrl);
      expect(result.url.href).toBe(
        'https://chinookdb.com/data/json/chinook.Invoice.json',
      );
    }
    const mirror = expand(MIRROR_TEMPLATE, 'Invoice');
    expect(mirror.ok && mirror.url.href).toBe(
      `${MIRROR}public/data/json/chinook.Invoice.json`,
    );
  });

  it("returns what the browser requests: the URL parser's own text", () => {
    const result = expand(CHINOOKDB_TEMPLATE, 'Invoice');
    expect(result.ok && new URL(result.url.href).href === result.url.href).toBe(
      true,
    );
  });

  it.each([
    '',
    '../x',
    'a/b',
    'a.b',
    'a b',
    '_x',
    '1x',
    'x'.repeat(65),
    'Invoice?x=1',
    '%2e',
    '%2e%2e',
    '..',
    '.',
    'a%2fb',
    'a\\b',
    'é',
  ])('refuses the table name %j before any expansion', (table) => {
    const result = expand(CHINOOKDB_TEMPLATE, table);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem).toMatch(/table name/);
  });

  it('refuses a table name that is not a string', () => {
    expect(expand(CHINOOKDB_TEMPLATE, undefined as unknown as string).ok).toBe(
      false,
    );
  });

  it('refuses every template checkUrlTemplate refuses, whatever the table name', () => {
    for (const template of [
      `${MIRROR}.%2{table}/.%2{table}/evil/repo@main/x.json`,
      'https://chinookdb.com/data/.%2{table}/x.json',
      'https://chinookdb.com/data/{table}{table}',
      'https://example.org/data/{table}',
    ]) {
      for (const table of ['Invoice', 'e', 'E', 'a2e']) {
        expect(expand(template, table).ok, `${template} ${table}`).toBe(false);
      }
    }
  });

  // Review r1, blocker B1: `e` or `E` is a valid table name and `%2e` is a dot.
  it("does not let the reviewer's splice reach another repository, with a table named e or E", () => {
    for (const table of ['e', 'E']) {
      const result = expand(
        `${MIRROR}.%2{table}/.%2{table}/evil/repo@main/x.json`,
        table,
      );
      expect(result.ok).toBe(false);
    }
  });

  it('refuses for an untrusted project what is not a safe address, and allows another host', () => {
    expect(
      expand('https://example.org/data/{table}.json', 'Invoice', 'untrusted')
        .ok,
    ).toBe(true);
    expect(
      expand('https://example.org/data/{table}.json', 'Invoice', 'trusted').ok,
    ).toBe(false);
    expect(
      expand('https://127.0.0.1/{table}.json', 'Invoice', 'untrusted').ok,
    ).toBe(false);
  });
});

describe('property: whatever template is accepted for a trusted project, the expanded, parsed URL is under an allowed prefix with no dot segment', () => {
  // A small deterministic generator (no dependency): pieces a hostile template is made of.
  const seed = (n: number): (() => number) => {
    let state = n >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  };
  const pieces = [
    '/',
    '/',
    '/',
    '.',
    '..',
    '.%2',
    '%2',
    '%2e',
    '%2E',
    '%2f',
    '%5c',
    '%',
    '{table}',
    '{table}',
    '{table}',
    'chinook.',
    '.json',
    'x',
    'evil',
    'repo@main',
    '@',
    ':',
    ';',
    '?',
    '#',
    '\\',
    '..;',
    '/./',
    '/../',
    '-',
    '_',
    'public',
    'data',
    'ab12',
  ];
  const bases = [
    'https://chinook.demodb.dev/data/',
    'https://chinookdb.com/data/',
    `${MIRROR}`,
    'https://chinookdb.com/',
    'https://chinookdb.com/data',
    'https://cdn.jsdelivr.net/gh/datatug/chinookdb@main/',
    'https://example.org/',
  ];
  const tables = [
    'Invoice',
    'e',
    'E',
    'a2e',
    'A',
    'x',
    'Z9_',
    'dot',
    'Dot2e',
    'chinook',
  ];
  const underAllowedPrefix = (href: string): boolean =>
    href.startsWith('https://chinook.demodb.dev/data/') ||
    href.startsWith('https://chinookdb.com/data/') ||
    new RegExp(
      `^https://cdn\\.jsdelivr\\.net/gh/datatug/chinookdb@[0-9a-f]{40}/`,
    ).test(href);
  const hasDotSegment = (href: string): boolean =>
    new URL(href).pathname.split('/').some((s) => s === '.' || s === '..');

  it('holds for 20,000 generated templates and every table name', () => {
    const random = seed(20261002);
    let accepted = 0;
    for (let i = 0; i < 20000; i++) {
      const parts = Array.from(
        { length: 1 + Math.floor(random() * 7) },
        () => pieces[Math.floor(random() * pieces.length)],
      );
      const template =
        bases[Math.floor(random() * bases.length)] + parts.join('');
      if (checkUrlTemplate(template, 'trusted') !== undefined) continue;
      accepted++;
      for (const table of tables) {
        const result = expandUrlTemplate(template, table, 'trusted');
        expect(result.ok, `${template} ${table}`).toBe(true);
        if (!result.ok) continue;
        expect(
          underAllowedPrefix(result.url.href),
          `${template} ${table} -> ${result.url.href}`,
        ).toBe(true);
        expect(hasDotSegment(result.url.href), `${template} ${table}`).toBe(
          false,
        );
        expect(result.url.href).not.toMatch(/%/);
      }
    }
    expect(accepted).toBeGreaterThan(50); // the generator does produce acceptable templates, so the loop above proved something
  });

  it('holds for the same templates under every dot-spelling the reviewer tried', () => {
    for (const template of [
      `${MIRROR}.%2{table}/.%2{table}/evil/repo@main/x.json`,
      `${MIRROR}%2{table}%2{table}/%2{table}%2{table}/evil/repo@main/{table}.json`,
      'https://chinookdb.com/data/.%2{table}/x.json',
    ]) {
      expect(checkUrlTemplate(template, 'trusted')).toBeTruthy();
    }
  });
});
