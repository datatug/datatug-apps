import { describe, expect, it } from 'vitest';
import {
  ALLOWED_DATA_ADDRESS_PREFIXES,
  beginsWithAllowedDataPrefix,
  checkAllowedDataAddress,
  checkProjectAddress,
  expandUrlTemplate,
} from './project-address-rules';

const PINNED =
  'https://cdn.jsdelivr.net/gh/datatug/chinookdb@0b6bb6ba22f680c9fb2fea9ec8107a8638dd8dc4/public/data/json/chinook.{table}.json';

describe('checkProjectAddress: addresses every project must pass (3.6)', () => {
  it.each([
    'https://chinookdb.com/data/json/chinook.{table}.json',
    PINNED,
    'https://chinookdb.com',
    'https://example.org/a/b.json?x=1',
    'https://203.0.113.9/data/chinook.Invoice.json', // a public number is not refused by the general rules
    'https://[2606:4700::1111]/data/x.json',
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
    'https://app.localhost/x',
    'https://printer.local/x',
    'https://db.internal/x',
    'https://host.localdomain/x',
    'https://router.home.arpa/x',
    'https://intranet/x', // a single-label name can only be a local machine
    'https://metadata/x',
  ])('refuses the local name %s', (address) => {
    expect(checkProjectAddress(address)).toBeTruthy();
  });

  it.each([
    ['loopback', 'https://127.0.0.1/x'],
    ['loopback, whole /8', 'https://127.255.255.254/x'],
    ['this network', 'https://0.0.0.0/x'],
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
    ['multicast', 'https://224.0.0.1/x'],
    ['broadcast', 'https://255.255.255.255/x'],
    ['decimal spelling of 127.0.0.1', 'https://2130706433/x'],
    ['hexadecimal spelling', 'https://0x7f000001/x'],
    ['dotted hexadecimal', 'https://0x7f.0x0.0x0.0x1/x'],
    ['octal spelling', 'https://0177.0.0.1/x'],
    ['short form', 'https://127.1/x'],
    ['IPv6 loopback', 'https://[::1]/x'],
    ['IPv6 unspecified', 'https://[::]/x'],
    ['IPv4-mapped loopback', 'https://[::ffff:127.0.0.1]/x'],
    ['IPv4-mapped private', 'https://[::ffff:10.1.2.3]/x'],
    ['IPv4-compatible loopback', 'https://[::7f00:1]/x'],
    ['NAT64 of a private address', 'https://[64:ff9b::a00:1]/x'],
    ['6to4 of a private address', 'https://[2002:a00:1::]/x'],
    ['IPv6 unique local', 'https://[fd00::1]/x'],
    ['IPv6 unique local, fc', 'https://[fc12:3456::1]/x'],
    ['IPv6 link-local', 'https://[fe80::1]/x'],
    ['IPv6 multicast', 'https://[ff02::1]/x'],
    ['IPv6 documentation', 'https://[2001:db8::1]/x'],
  ])('refuses a number: %s', (_name, address) => {
    expect(checkProjectAddress(address)).toBeTruthy();
  });

  it.each([
    ['a port', 'https://chinookdb.com:8443/data/x.json'],
    ['an empty port', 'https://chinookdb.com:/data/x.json'],
    ['a fragment', 'https://chinookdb.com/data/x.json#a'],
    ['a space', 'https://chinookdb.com/data/x y.json'],
    ['a newline', 'https://chinookdb.com/data/x\n.json'],
    ['a backslash', 'https://chinookdb.com\\data\\x.json'],
    ['a non-ASCII character', 'https://chinookdb.com/data/é.json'],
    ['an internationalised host', 'https://chïnookdb.com/data/x.json'],
    ['an unterminated IPv6 literal', 'https://[::1/x'],
    ['a malformed host', 'https://exa%mple.com/x'],
    [
      'a brace that is not the table placeholder',
      'https://chinookdb.com/data/{name}.json',
    ],
    ['a nested placeholder', 'https://chinookdb.com/{{table}}.json'],
    [
      'an address over 2048 characters',
      `https://chinookdb.com/${'a'.repeat(2048)}`,
    ],
  ])('refuses %s', (_name, address) => {
    expect(checkProjectAddress(address)).toBeTruthy();
  });
});

describe('the allow-list of address prefixes (3.6, trusted project)', () => {
  it('lists exactly the chinookdb.com data path and a pinned jsDelivr mirror', () => {
    expect(ALLOWED_DATA_ADDRESS_PREFIXES).toEqual([
      'https://chinookdb.com/data/',
    ]);
    expect(beginsWithAllowedDataPrefix(PINNED)).toBe(true);
  });

  it.each([
    'https://chinookdb.com/data/json/chinook.{table}.json',
    'https://chinookdb.com/data/chinook.json',
    PINNED,
  ])('accepts %s', (address) => {
    expect(checkAllowedDataAddress(address)).toBeUndefined();
  });

  it.each([
    [
      'another path on chinookdb.com',
      'https://chinookdb.com/other/chinook.{table}.json',
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
      'another repository on jsDelivr',
      'https://cdn.jsdelivr.net/gh/attacker/chinookdb@0b6bb6ba22f680c9fb2fea9ec8107a8638dd8dc4/x/{table}.json',
    ],
    [
      'the right repository at a branch',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@main/public/data/json/chinook.{table}.json',
    ],
    [
      'the right repository at a tag',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@v1.0.0/public/data/json/chinook.{table}.json',
    ],
    [
      'a short commit',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@0b6bb6b/public/data/json/chinook.{table}.json',
    ],
    [
      'a 41-character commit',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@0b6bb6ba22f680c9fb2fea9ec8107a8638dd8dc4a/x/{table}.json',
    ],
    [
      'an upper-case commit',
      'https://cdn.jsdelivr.net/gh/datatug/chinookdb@0B6BB6BA22F680C9FB2FEA9EC8107A8638DD8DC4/x/{table}.json',
    ],
    [
      'jsDelivr npm',
      'https://cdn.jsdelivr.net/npm/chinookdb@1.0.0/{table}.json',
    ],
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
});

describe('expandUrlTemplate', () => {
  it('fills every placeholder', () => {
    expect(
      expandUrlTemplate(
        'https://chinookdb.com/data/json/chinook.{table}.json',
        'Invoice',
      ),
    ).toBe('https://chinookdb.com/data/json/chinook.Invoice.json');
    expect(expandUrlTemplate('https://h.example/{table}/{table}', 'A')).toBe(
      'https://h.example/A/A',
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
  ])('refuses the table name %j', (table) => {
    expect(() =>
      expandUrlTemplate('https://chinookdb.com/data/{table}.json', table),
    ).toThrow();
  });
});
