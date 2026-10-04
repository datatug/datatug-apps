// What a project-supplied address may be (design 3.6, "Rules for every project read from GitHub"), as pure
// functions with no network access. A browser cannot check what a public name resolves to, so these rules
// refuse loopback, private and link-local addresses by name and by number, and the allow-list of
// prefixes (for a trusted project) is what closes the rest in the first release.
//
// Two kinds of text are checked here and they are kept apart on purpose:
//   - an address: a concrete https URL (`checkProjectAddress`, `checkAllowedDataAddress`);
//   - a URL template: an address with one `{table}` placeholder (`checkUrlTemplate`).
// A template is never fetched. The only way to a fetchable URL is `expandUrlTemplate`, which fills in a
// table name, parses the result and checks the parsed URL, the one the browser would request, against the
// same rules. Enforcing the size cap while the response streams in, and refusing redirects, are the
// fetching code's job (G-A2): nothing here reads a response.

import {
  MAX_NAME_LENGTH,
  MAX_URL_LENGTH,
  NAME_PATTERN,
  TABLE_PLACEHOLDER,
} from './project-file-limits';

/** Whether the project is on the app's own list (3.6). Always chosen by the caller, never defaulted. */
export type ProjectTrust = 'trusted' | 'untrusted';

/**
 * The prefixes a trusted project's data addresses must begin with. A prefix of the full address, not a
 * host: a host alone would let any repository on jsDelivr through.
 */
export const ALLOWED_DATA_ADDRESS_PREFIXES: readonly string[] = [
  'https://chinook.demodb.dev/data/',
  // Existing pinned project files may still use the previous domain.
  'https://chinookdb.com/data/',
];

/**
 * `https://cdn.jsdelivr.net/gh/datatug/chinookdb@<40 hexadecimal characters>/`, lower case.
 *
 * A pin by commit is only as trustworthy as the project that names it: GitHub serves a fork's commits
 * through the parent repository's address (design 3.6), so a 40-hex commit under `datatug/chinookdb` may be
 * a stranger's. That is why this prefix is accepted for a trusted project only, whose own file names the
 * commit, and why the mirror's rows are used only when their SHA-256 equals the project's (4.8).
 */
const ALLOWED_PINNED_MIRROR =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/datatug\/chinookdb@[0-9a-f]{40}\//;

/** Why an address is refused, in words a visitor can be shown. `undefined` means it passes. */
export type AddressProblem = string | undefined;

/** Stands for the table name while a template is checked. A real name starts with a letter, like this one. */
const PLACEHOLDER_STAND_IN = 'Table';

/** The one shape a path segment holding the placeholder may have, once the stand-in is in: it starts with a
 * letter or digit, so no expansion can make it `.` or `..`. */
const PLACEHOLDER_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Names that mean "this machine or this network", whatever they resolve to. */
const LOCAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
  '.lan',
  '.intranet',
];

// Characters a concrete address may not have: controls and space, everything outside ASCII, `\` and `#`.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_ADDRESS_CHARACTERS = /[\u0000-\u0020\u007f-\uffff\\#]/;

/**
 * Checks a concrete address as the rules of 3.6 say for every project, trusted or not: `https` only; no user
 * name or password; no port; no `localhost`, loopback, private or link-local address, by name or by number
 * (the host is read as the URL parser reads it, so `2130706433`, `0x7f.1` and `[::ffff:7f00:1]` are what
 * they are); no fragment, backslash or non-ASCII character; no braces.
 */
export function checkProjectAddress(address: string): AddressProblem {
  if (typeof address !== 'string' || address.length === 0)
    return 'the address is empty';
  if (address.length > MAX_URL_LENGTH)
    return `the address is longer than ${MAX_URL_LENGTH} characters`;
  if (FORBIDDEN_ADDRESS_CHARACTERS.test(address))
    return 'the address has a space, control character, non-ASCII character, backslash or fragment';
  if (!address.startsWith('https://'))
    return 'only https addresses are allowed';
  if (/[{}]/.test(address)) return 'the address must not contain a brace';

  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return 'the address is not a valid URL';
  }
  if (parsed.protocol !== 'https:') return 'only https addresses are allowed';
  // The authority as written, which the URL parser may have rewritten (it reads `\` as `/`, for one).
  const authority = address.slice('https://'.length).split(/[/?]/)[0];
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    authority.includes('@')
  ) {
    return 'the address must not contain a user name or password';
  }
  const afterHost = authority.startsWith('[')
    ? authority.slice(authority.indexOf(']') + 1)
    : authority;
  if (parsed.port !== '' || afterHost.includes(':'))
    return 'the address must not name a port';
  return checkHostName(parsed.hostname);
}

function checkHostName(hostname: string): AddressProblem {
  let host = hostname.toLowerCase();
  if (host.startsWith('[')) {
    const groups = parseIPv6(host.slice(1, -1));
    if (!groups) return 'the host is not a valid address';
    return isNonPublicIPv6(groups)
      ? 'the host is a loopback, private, link-local or reserved address'
      : undefined;
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === '' || host.split('.').includes(''))
    return 'the host has an empty name';
  // The URL parser has already turned decimal, octal and hexadecimal spellings of an IPv4 address into dotted form.
  const octets = parseIPv4(host);
  if (octets)
    return isNonPublicIPv4(octets)
      ? 'the host is a loopback, private or link-local address'
      : undefined;
  if (/^[0-9.x]+$/i.test(host)) return 'the host is not a valid address';
  if (host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return 'the host is a local name';
  }
  if (!host.includes('.'))
    return 'the host is a single-label name, which can only be a local machine';
  return undefined;
}

function parseIPv4(host: string): readonly number[] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) =>
    /^[0-9]{1,3}$/.test(part) ? Number(part) : NaN,
  );
  return octets.every((octet) => octet >= 0 && octet <= 255)
    ? octets
    : undefined;
}

function isNonPublicIPv4([a, b, c]: readonly number[]): boolean {
  return (
    a === 0 || // this network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // shared address space
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // documentation
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

/**
 * Expands an IPv6 literal, as the URL parser writes it (lower case, `::` compressed, an embedded IPv4 tail
 * already turned into two groups), into eight 16-bit groups; undefined if it is malformed.
 */
function parseIPv6(text: string): readonly number[] | undefined {
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const toGroups = (part: string): number[] | undefined => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const piece of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return undefined;
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tail) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const fill = 8 - head.length - tail.length;
  return fill < 1
    ? undefined
    : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * Whether an IPv6 address, as eight groups, is not a plain public address: the whole of `::/8` (unspecified,
 * loopback, IPv4-compatible, IPv4-mapped and IPv4-translated in any spelling), the discard prefix, unique
 * local, link-local, site-local, multicast, documentation, Teredo, ORCHID, the NAT64 prefixes (the
 * well-known one when it embeds a non-public IPv4 address, the local-use one always) and 6to4 embedding a
 * non-public IPv4 address.
 */
function isNonPublicIPv6(groups: readonly number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (g0 >> 8 === 0) return true; // ::/8
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard 100::/64
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo 2001::/32
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // documentation
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x10) return true; // ORCHID 2001:10::/28
  if (g0 === 0x2002)
    return isNonPublicIPv4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]); // 6to4
  if (g0 === 0x64 && g1 === 0xff9b) {
    const wellKnown = g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0; // 64:ff9b::/96
    return wellKnown
      ? isNonPublicIPv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff])
      : true; // 64:ff9b:1::/48 local-use, and the rest of 64:ff9b::/32
  }
  return false;
}

/** True when `address` begins with one of the app's own data prefixes, compared on the text as written. */
export function beginsWithAllowedDataPrefix(address: string): boolean {
  return (
    ALLOWED_DATA_ADDRESS_PREFIXES.some((prefix) =>
      address.startsWith(prefix),
    ) || ALLOWED_PINNED_MIRROR.test(address)
  );
}

const ALLOWED_PREFIXES_TEXT = [
  ...ALLOWED_DATA_ADDRESS_PREFIXES,
  'https://cdn.jsdelivr.net/gh/datatug/chinookdb@<40 hexadecimal characters>/',
].join(', ');

/**
 * The allow-list of 3.6 for a trusted project, on a concrete address: the text must begin with an allowed
 * prefix, and the address the URL parser makes of it must still lie under that prefix (so `/data/../other/`
 * cannot climb out of it).
 */
export function checkAllowedDataAddress(address: string): AddressProblem {
  if (!beginsWithAllowedDataPrefix(address)) {
    return `the address must begin with one of: ${ALLOWED_PREFIXES_TEXT}`;
  }
  let normalised: string;
  try {
    normalised = new URL(address).href;
  } catch {
    return 'the address is not a valid URL';
  }
  if (!beginsWithAllowedDataPrefix(normalised))
    return 'the address leaves the allowed prefix once its path is resolved';
  return undefined;
}

/**
 * Checks a URL template: an https address with exactly one `{table}`, standing for a table name.
 *
 * Because the expanded address is what the browser requests, a template is held to a fixed pattern:
 * - no `%`, `?` or `#` anywhere (so no encoded dot segment can be spelled, however the name is spliced in);
 * - no path segment is empty or starts with a dot;
 * - the placeholder is in the path, in a segment that, with a name in it, starts with a letter or digit and
 *   has only letters, digits, `.`, `_` and `-`, and a table name starts with a letter, so the segment can
 *   never be `.` or `..`;
 * - it is the placeholder of a concrete address that passes `checkProjectAddress` and that the URL parser
 *   leaves exactly as written;
 * - for a trusted project, the text begins with an allowed prefix (the placeholder is therefore after it).
 */
export function checkUrlTemplate(
  template: string,
  trust: ProjectTrust,
): AddressProblem {
  if (typeof template !== 'string' || template.length === 0)
    return 'the address is empty';
  if (template.length > MAX_URL_LENGTH)
    return `the address is longer than ${MAX_URL_LENGTH} characters`;
  if (/[%?#]/.test(template)) return 'a template must not contain %, ? or #';
  const parts = template.split(TABLE_PLACEHOLDER);
  if (parts.length !== 2)
    return `a template must contain ${TABLE_PLACEHOLDER} exactly once`;
  const standIn = parts.join(PLACEHOLDER_STAND_IN);
  const unsafe = checkProjectAddress(standIn);
  if (unsafe) return unsafe;

  const authorityEnd = standIn.indexOf('/', 'https://'.length);
  if (authorityEnd < 0 || parts[0].length <= authorityEnd)
    return `${TABLE_PLACEHOLDER} may only be in the path`;
  const segment = standIn.slice(
    standIn.lastIndexOf('/', parts[0].length) + 1,
    standIn.indexOf('/', parts[0].length) < 0
      ? undefined
      : standIn.indexOf('/', parts[0].length),
  );
  if (!PLACEHOLDER_SEGMENT.test(segment))
    return `${TABLE_PLACEHOLDER} must be in a path segment that starts with a letter or digit and has only letters, digits, ".", "_" and "-"`;

  const segments = standIn.slice(authorityEnd + 1).split('/');
  if (segments.some((s) => s === ''))
    return 'a template must not have an empty path segment or end in a slash';
  if (segments.some((s) => s.startsWith('.')))
    return 'a template must not have a path segment that starts with a dot';
  if (new URL(standIn).href !== standIn)
    return 'the address is not in its normal form (upper-case host, dot segments or a missing path)';
  if (trust === 'trusted') {
    if (!beginsWithAllowedDataPrefix(template))
      return `the address must begin with one of: ${ALLOWED_PREFIXES_TEXT}`;
    const outside = checkAllowedDataAddress(standIn);
    if (outside) return outside;
  }
  return undefined;
}

/** A URL a fetch may use: only `expandUrlTemplate` makes one, after checking the address the browser would request. */
export class CheckedDataUrl {
  /** The URL as the URL parser writes it: exactly what the browser requests. */
  readonly href: string;

  private constructor(href: string) {
    this.href = href;
  }

  /** @internal Only this module makes one. */
  static issue(href: string): CheckedDataUrl {
    return new CheckedDataUrl(href);
  }
}

export type ExpandedUrl =
  | { readonly ok: true; readonly url: CheckedDataUrl }
  | { readonly ok: false; readonly problem: string };

/**
 * Fills the `{table}` placeholder and returns the URL to fetch, checked as a whole: the template, the table
 * name (a plain name: starts with a letter, then letters, digits and underscores, at most 64), and, on the
 * expanded address as the URL parser reads it, the general rules, the allow-list when the project is trusted,
 * and the absence of dot segments. This is the only way to a fetchable URL.
 */
export function expandUrlTemplate(
  template: string,
  table: string,
  trust: ProjectTrust,
): ExpandedUrl {
  const refuse = (problem: string): ExpandedUrl => ({ ok: false, problem });
  if (
    typeof table !== 'string' ||
    !NAME_PATTERN.test(table) ||
    table.length > MAX_NAME_LENGTH
  ) {
    return refuse(
      'a table name starts with a letter and has only letters, digits and underscores',
    );
  }
  const badTemplate = checkUrlTemplate(template, trust);
  if (badTemplate) return refuse(badTemplate);

  const expanded = template.split(TABLE_PLACEHOLDER).join(table);
  let parsed: URL;
  try {
    parsed = new URL(expanded);
  } catch {
    return refuse('the address is not a valid URL');
  }
  if (parsed.href !== expanded)
    return refuse('the address changes when it is normalised');
  if (parsed.pathname.split('/').some((s) => s === '.' || s === '..'))
    return refuse('the address has a dot segment');
  const unsafe = checkProjectAddress(parsed.href);
  if (unsafe) return refuse(unsafe);
  if (trust === 'trusted') {
    const outside = checkAllowedDataAddress(parsed.href);
    if (outside) return refuse(outside);
  }
  return { ok: true, url: CheckedDataUrl.issue(parsed.href) };
}
