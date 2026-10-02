// What a project-supplied address may be (design 3.6, "Rules for every project read from GitHub"), as pure
// functions with no network access. A browser cannot check what a public name resolves to, so these rules
// refuse loopback, private and link-local addresses by name and by number, and the allow-list of
// prefixes (for a trusted project) is what closes the rest in the first release.

import {
  MAX_URL_LENGTH,
  MAX_NAME_LENGTH,
  NAME_PATTERN,
  TABLE_PLACEHOLDER,
} from './project-file-limits';

/**
 * The prefixes a trusted project's data addresses must begin with. A prefix of the full address, not a
 * host: a host alone would let any repository on jsDelivr through.
 */
export const ALLOWED_DATA_ADDRESS_PREFIXES: readonly string[] = [
  'https://chinookdb.com/data/',
];

/** `https://cdn.jsdelivr.net/gh/datatug/chinookdb@<40 hexadecimal characters>/`, lower case. */
const ALLOWED_PINNED_MIRROR =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/datatug\/chinookdb@[0-9a-f]{40}\//;

/** Why an address is refused, in words a visitor can be shown. `undefined` means it passes. */
export type AddressProblem = string | undefined;

const PLACEHOLDER_STAND_IN = 'Table';

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

/**
 * Checks an address as the rules of 3.6 say for every project, trusted or not: `https` only; no user name
 * or password; no `localhost`, loopback, private or link-local address, by name or by number; no
 * fragment; no backslash; no port. A `{table}` placeholder is allowed (and only that brace).
 */
export function checkProjectAddress(address: string): AddressProblem {
  if (typeof address !== 'string' || address.length === 0)
    return 'the address is empty';
  if (address.length > MAX_URL_LENGTH)
    return `the address is longer than ${MAX_URL_LENGTH} characters`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f-￿\\#]/.test(address))
    return 'the address has a space, control character, non-ASCII character, backslash or fragment';
  if (!address.startsWith('https://'))
    return 'only https addresses are allowed';
  const withoutPlaceholder = address
    .split(TABLE_PLACEHOLDER)
    .join(PLACEHOLDER_STAND_IN);
  if (/[{}]/.test(withoutPlaceholder))
    return `the only placeholder allowed is ${TABLE_PLACEHOLDER}`;

  let parsed: URL;
  try {
    parsed = new URL(withoutPlaceholder);
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

function checkHostName(rawHost: string): AddressProblem {
  const host = rawHost.toLowerCase().replace(/\.$/, '');
  if (host === '') return 'the address has no host';
  if (host.startsWith('[')) {
    const groups = parseIPv6(host.slice(1, -1));
    if (!groups) return 'the host is not a valid address';
    return isPrivateIPv6(groups)
      ? 'the host is a loopback, private or link-local address'
      : undefined;
  }
  // The URL parser has already turned decimal, octal and hexadecimal spellings of an IPv4 address into dotted form.
  const octets = parseIPv4(host);
  if (octets)
    return isPrivateIPv4(octets)
      ? 'the host is a loopback, private or link-local address'
      : undefined;
  if (/^[0-9.x]+$/i.test(host)) return 'the host is not a valid address';
  if (
    host === 'localhost' ||
    LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
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

function isPrivateIPv4([a, b, c]: readonly number[]): boolean {
  return (
    a === 0 || // this network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // shared address space
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expands a (WHATWG-normalised) IPv6 literal into eight 16-bit groups, or undefined if it is malformed. */
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

function isPrivateIPv6(groups: readonly number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const embeddedV4 = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  const upperZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (upperZero && g5 === 0 && g6 === 0 && g7 <= 1) return true; // :: and ::1
  if (upperZero && (g5 === 0xffff || g5 === 0))
    return isPrivateIPv4(embeddedV4); // IPv4-mapped, IPv4-compatible
  if (
    g0 === 0x64 &&
    g1 === 0xff9b &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0
  )
    return isPrivateIPv4(embeddedV4); // NAT64
  if (g0 === 0x2002)
    return isPrivateIPv4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]); // 6to4
  return (
    (g0 & 0xfe00) === 0xfc00 || // unique local
    (g0 & 0xffc0) === 0xfe80 || // link-local
    (g0 & 0xff00) === 0xff00 || // multicast
    (g0 === 0x2001 && g1 === 0xdb8) // documentation
  );
}

/** True when `address` begins with one of the app's own data prefixes, compared on the text as written. */
export function beginsWithAllowedDataPrefix(address: string): boolean {
  return (
    ALLOWED_DATA_ADDRESS_PREFIXES.some((prefix) =>
      address.startsWith(prefix),
    ) || ALLOWED_PINNED_MIRROR.test(address)
  );
}

/**
 * The allow-list of 3.6 for a trusted project: the text must begin with an allowed prefix, and the address
 * the URL parser makes of it must still lie under that prefix (so `/data/../other/` and an encoded `..`
 * cannot climb out of it).
 */
export function checkAllowedDataAddress(address: string): AddressProblem {
  if (!beginsWithAllowedDataPrefix(address)) {
    return `the address must begin with one of: ${[...ALLOWED_DATA_ADDRESS_PREFIXES, 'https://cdn.jsdelivr.net/gh/datatug/chinookdb@<40 hexadecimal characters>/'].join(', ')}`;
  }
  const normalised = new URL(
    address.split(TABLE_PLACEHOLDER).join(PLACEHOLDER_STAND_IN),
  ).href;
  if (!beginsWithAllowedDataPrefix(normalised))
    return 'the address leaves the allowed prefix once its path is resolved';
  return undefined;
}

/** Fills the `{table}` placeholder. The table name must be a plain name (letters, digits, underscore). */
export function expandUrlTemplate(template: string, table: string): string {
  if (!NAME_PATTERN.test(table) || table.length > MAX_NAME_LENGTH) {
    throw new Error(
      'A table name may only have letters, digits and underscores.',
    );
  }
  return template.split(TABLE_PLACEHOLDER).join(table);
}
