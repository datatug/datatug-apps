// The `https-json` catalog file (design 4.8 and 5.2a): `<catalog>.db.json` of an environment whose rows
// come from plain JSON row arrays over https, one file per table. JSON Schema:
// ./schemas/https-json-catalog.schema.json. Written by the repo lane, read by the app.
//
// Every address in it is project-supplied and so follows 3.6: https only, no credentials, no port, no
// loopback or private address, and, for a trusted project, an address that begins with one of the app's own
// prefixes. Labels are shown as text; a link is shown only if it is https.

import {
  checkProjectAddress,
  checkUrlTemplate,
  expandUrlTemplate,
  type ExpandedUrl,
  type ProjectTrust,
} from './project-address-rules';
import {
  GIT_REVISION_PATTERN,
  HTTPS_URL_PATTERN,
  MAX_LABEL_LENGTH,
  MAX_LICENCE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PROJECT_FILE_BYTES,
  MAX_TABLES,
  MAX_URL_LENGTH,
  NAME_PATTERN,
  PLAIN_TEXT_PATTERN,
  SHA256_PATTERN,
  TABLE_PLACEHOLDER,
  URL_NO_BRACES_PATTERN,
  URL_TEMPLATE_ONE_PLACEHOLDER_PATTERN,
  URL_TEMPLATE_PLAIN_PATTERN,
} from './project-file-limits';
import {
  parseProjectFileText,
  ProblemCollector,
  type PlainRecord,
  type ValidationResult,
} from './project-file-problems';

export type { ProjectTrust } from './project-address-rules';

export const HTTPS_JSON_DRIVER = 'https-json';

export interface HttpsJsonUpstream {
  /** Where the data comes from before it reaches the hosting site, e.g. `https://github.com/lerocha/chinook-database`. */
  readonly repository: string;
  /** A full 40-character git revision. */
  readonly revision: string;
  readonly licence: string;
}

export interface HttpsJsonCatalog {
  readonly driver: typeof HTTPS_JSON_DRIVER;
  /** Shown as text, never as HTML. */
  readonly label?: string;
  /** Linked only when https (the validator refuses anything else). */
  readonly homepage?: string;
  /** Address of one table's rows, with `{table}` standing for the table name. */
  readonly urlTemplate: string;
  /** Read when `urlTemplate` does not answer; accepted only when the rows' SHA-256 equals the project's. */
  readonly fallbackUrlTemplate?: string;
  /** Table name to its primary-key column, so a plain row array can be served as `{ key, data }` records. */
  readonly keys: Readonly<Record<string, string>>;
  /** Table name to the lower-case hexadecimal SHA-256 of that table's file as served. */
  readonly sha256: Readonly<Record<string, string>>;
  readonly upstream?: HttpsJsonUpstream;
}

export interface HttpsJsonCatalogOptions {
  readonly trust: ProjectTrust;
}

const CATALOG_KEYS = [
  '$schema',
  'driver',
  'label',
  'homepage',
  'urlTemplate',
  'fallbackUrlTemplate',
  'keys',
  'sha256',
  'upstream',
];
const UPSTREAM_KEYS = ['repository', 'revision', 'licence'];

/**
 * Validates a parsed `https-json` catalog file. Rules for every project: shape, sizes, unknown keys refused,
 * addresses as 3.6 says. For a `trusted` project the two templates must also begin with an allowed prefix.
 * A fallback template needs a checksum for every table that has a key, since a mirror's rows are accepted only
 * when their SHA-256 equals the project's (4.8).
 */
export function validateHttpsJsonCatalog(
  input: unknown,
  options: HttpsJsonCatalogOptions,
): ValidationResult<HttpsJsonCatalog> {
  const problems = new ProblemCollector();
  const root = problems.record(input, '');
  if (!root) return { ok: false, errors: problems.problems };

  problems.onlyKeys(root, '', CATALOG_KEYS);
  problems.requireKeys(root, '', ['driver', 'urlTemplate', 'keys', 'sha256']);
  if ('$schema' in root) problems.text(root['$schema'], '/$schema', 300);
  if ('driver' in root && root['driver'] !== HTTPS_JSON_DRIVER)
    problems.add('/driver', 'const', `must be ${HTTPS_JSON_DRIVER}`);

  const label =
    'label' in root
      ? problems.text(
          root['label'],
          '/label',
          MAX_LABEL_LENGTH,
          PLAIN_TEXT_PATTERN,
        )
      : undefined;
  const homepage =
    'homepage' in root
      ? checkLink(root['homepage'], '/homepage', problems)
      : undefined;
  const urlTemplate =
    'urlTemplate' in root
      ? checkTemplate(root['urlTemplate'], '/urlTemplate', options, problems)
      : undefined;
  const fallbackUrlTemplate =
    'fallbackUrlTemplate' in root
      ? checkTemplate(
          root['fallbackUrlTemplate'],
          '/fallbackUrlTemplate',
          options,
          problems,
        )
      : undefined;
  const keys =
    'keys' in root
      ? checkNameMap(root['keys'], '/keys', NAME_PATTERN, problems)
      : undefined;
  const sha256 =
    'sha256' in root
      ? checkNameMap(root['sha256'], '/sha256', SHA256_PATTERN, problems, 64)
      : undefined;
  const upstream =
    'upstream' in root
      ? checkUpstream(root['upstream'], '/upstream', problems)
      : undefined;

  if (fallbackUrlTemplate !== undefined && keys && sha256) {
    for (const table of Object.keys(keys)) {
      if (!Object.prototype.hasOwnProperty.call(sha256, table)) {
        problems.add(
          ProblemCollector.child('/sha256', table),
          'checksum-missing',
          'is required for every table when a fallback address is given',
        );
      }
    }
  }

  if (
    problems.problems.length > 0 ||
    urlTemplate === undefined ||
    !keys ||
    !sha256
  ) {
    return { ok: false, errors: problems.problems };
  }
  const value: HttpsJsonCatalog = {
    driver: HTTPS_JSON_DRIVER,
    ...(label !== undefined && { label }),
    ...(homepage !== undefined && { homepage }),
    urlTemplate,
    ...(fallbackUrlTemplate !== undefined && { fallbackUrlTemplate }),
    keys,
    sha256,
    ...(upstream !== undefined && { upstream }),
  };
  return { ok: true, value };
}

/** The text of the file: size cap, JSON syntax, then validateHttpsJsonCatalog. */
export function parseHttpsJsonCatalog(
  text: string,
  options: HttpsJsonCatalogOptions,
): ValidationResult<HttpsJsonCatalog> {
  const parsed = parseProjectFileText(text, MAX_PROJECT_FILE_BYTES);
  return parsed.ok ? validateHttpsJsonCatalog(parsed.value, options) : parsed;
}

/** A link: https, no credentials, no local host; no brace. Shown only when it passes. */
function checkLink(
  raw: unknown,
  path: string,
  problems: ProblemCollector,
): string | undefined {
  const text = checkAddressShape(raw, path, problems);
  if (text === undefined) return undefined;
  if (!URL_NO_BRACES_PATTERN.test(text)) {
    problems.add(path, 'pattern', 'must not contain a placeholder or a brace');
    return undefined;
  }
  return checkSafe(text, path, problems);
}

/**
 * A URL template, held to the fixed pattern of `checkUrlTemplate`: one `{table}`, no `%` or `?`, the placeholder
 * in a path segment that cannot become a dot segment, and, for a trusted project, an allowed prefix.
 */
function checkTemplate(
  raw: unknown,
  path: string,
  options: HttpsJsonCatalogOptions,
  problems: ProblemCollector,
): string | undefined {
  const text = checkAddressShape(raw, path, problems);
  if (text === undefined) return undefined;
  if (!text.includes(TABLE_PLACEHOLDER)) {
    problems.add(
      path,
      'missing-placeholder',
      `must contain ${TABLE_PLACEHOLDER}`,
    );
    return undefined;
  }
  if (!URL_TEMPLATE_ONE_PLACEHOLDER_PATTERN.test(text)) {
    problems.add(
      path,
      'pattern',
      `${TABLE_PLACEHOLDER} must appear exactly once and no other brace is allowed`,
    );
    return undefined;
  }
  if (!URL_TEMPLATE_PLAIN_PATTERN.test(text)) {
    problems.add(path, 'pattern', 'a template must not contain % or ?');
    return undefined;
  }
  const unsafe = checkUrlTemplate(text, 'untrusted');
  if (unsafe) {
    problems.add(path, 'unsafe-address', unsafe);
    return undefined;
  }
  if (options.trust === 'trusted') {
    const outside = checkUrlTemplate(text, 'trusted');
    if (outside) {
      problems.add(path, 'outside-allowed-prefixes', outside);
      return undefined;
    }
  }
  return text;
}

function checkAddressShape(
  raw: unknown,
  path: string,
  problems: ProblemCollector,
): string | undefined {
  return problems.text(raw, path, MAX_URL_LENGTH, HTTPS_URL_PATTERN, 9);
}

function checkSafe(
  address: string,
  path: string,
  problems: ProblemCollector,
): string | undefined {
  const reason = checkProjectAddress(address);
  if (reason) {
    problems.add(path, 'unsafe-address', reason);
    return undefined;
  }
  return address;
}

/** A map from a table name to a string, e.g. its key column or its checksum. */
function checkNameMap(
  raw: unknown,
  path: string,
  valuePattern: RegExp,
  problems: ProblemCollector,
  valueMax: number = MAX_NAME_LENGTH,
): Readonly<Record<string, string>> | undefined {
  const record: PlainRecord | undefined = problems.record(raw, path);
  if (!record) return undefined;
  const names = Object.keys(record);
  if (names.length < 1 || names.length > MAX_TABLES) {
    problems.add(path, 'count', `must have 1 to ${MAX_TABLES} entries`);
    return undefined;
  }
  const entries: [string, string][] = [];
  for (const name of names) {
    const childPath = ProblemCollector.child(path, name);
    if (!NAME_PATTERN.test(name)) {
      problems.add(
        childPath,
        'unknown-key',
        'is not a table name (letters, digits, underscore)',
      );
      continue;
    }
    const value = problems.text(
      record[name],
      childPath,
      valueMax,
      valuePattern,
    );
    if (value !== undefined) entries.push([name, value]);
  }
  return entries.length === names.length
    ? Object.fromEntries(entries)
    : undefined;
}

function checkUpstream(
  raw: unknown,
  path: string,
  problems: ProblemCollector,
): HttpsJsonUpstream | undefined {
  const record = problems.record(raw, path);
  if (!record) return undefined;
  problems.onlyKeys(record, path, UPSTREAM_KEYS);
  problems.requireKeys(record, path, UPSTREAM_KEYS);
  const repository =
    'repository' in record
      ? checkLink(record['repository'], `${path}/repository`, problems)
      : undefined;
  const revision =
    'revision' in record
      ? problems.text(
          record['revision'],
          `${path}/revision`,
          40,
          GIT_REVISION_PATTERN,
          40,
        )
      : undefined;
  const licence =
    'licence' in record
      ? problems.text(
          record['licence'],
          `${path}/licence`,
          MAX_LICENCE_LENGTH,
          PLAIN_TEXT_PATTERN,
        )
      : undefined;
  return repository !== undefined &&
    revision !== undefined &&
    licence !== undefined
    ? { repository, revision, licence }
    : undefined;
}

/** The two addresses to read one table's rows from, each checked as the browser would request it. */
export interface TableUrls {
  readonly primary: ExpandedUrl;
  /** Absent when the catalog has no `fallbackUrlTemplate`. Its rows count only if their SHA-256 equals the project's. */
  readonly fallback?: ExpandedUrl;
}

/**
 * The way to a fetchable URL for a table of a validated catalog: expands both templates and re-checks the
 * expanded, parsed addresses (`expandUrlTemplate`). `trust` must be the same as the one the catalog was
 * validated with.
 */
export function tableUrls(
  catalog: HttpsJsonCatalog,
  table: string,
  trust: ProjectTrust,
): TableUrls {
  return {
    primary: expandUrlTemplate(catalog.urlTemplate, table, trust),
    ...(catalog.fallbackUrlTemplate !== undefined && {
      fallback: expandUrlTemplate(catalog.fallbackUrlTemplate, table, trust),
    }),
  };
}
