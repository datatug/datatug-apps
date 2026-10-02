/** One reason a project file was refused. `path` is a JSON Pointer into the document ("" is the root). */
export interface FileProblem {
  readonly path: string;
  readonly code: FileProblemCode;
  readonly message: string;
}

export type FileProblemCode =
  | 'too-large'
  | 'not-json'
  | 'type'
  | 'required'
  | 'unknown-key'
  | 'const'
  | 'enum'
  | 'pattern'
  | 'length'
  | 'count'
  | 'duplicate'
  | 'unsafe-address'
  | 'outside-allowed-prefixes'
  | 'missing-placeholder'
  | 'checksum-missing'
  | 'unknown-query';

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FileProblem[] };

export type PlainRecord = Readonly<Record<string, unknown>>;

export const isPlainRecord = (value: unknown): value is PlainRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Collects problems with the paths of the values being checked; shared by both validators. */
export class ProblemCollector {
  private readonly list: FileProblem[] = [];

  get problems(): readonly FileProblem[] {
    return this.list;
  }

  add(path: string, code: FileProblemCode, message: string): void {
    this.list.push({ path, code, message });
  }

  /** JSON Pointer of a child, with `~` and `/` escaped as RFC 6901 says. */
  static child(path: string, key: string | number): string {
    return `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
  }

  /** Returns the record, or records a `type` problem and returns undefined. */
  record(value: unknown, path: string): PlainRecord | undefined {
    if (isPlainRecord(value)) return value;
    this.add(path, 'type', 'must be an object');
    return undefined;
  }

  /** Unknown keys are refused, never ignored. */
  onlyKeys(
    record: PlainRecord,
    path: string,
    allowed: readonly string[],
  ): void {
    for (const key of Object.keys(record)) {
      if (!allowed.includes(key))
        this.add(
          ProblemCollector.child(path, key),
          'unknown-key',
          'is not a known key',
        );
    }
  }

  requireKeys(
    record: PlainRecord,
    path: string,
    required: readonly string[],
  ): void {
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        this.add(ProblemCollector.child(path, key), 'required', 'is required');
      }
    }
  }

  /** A string within the length bounds and, if given, matching `pattern`; returns it, or undefined after recording why. */
  text(
    value: unknown,
    path: string,
    max: number,
    pattern?: RegExp,
    min = 1,
  ): string | undefined {
    if (typeof value !== 'string') {
      this.add(path, 'type', 'must be a string');
      return undefined;
    }
    if (value.length < min || value.length > max) {
      this.add(
        path,
        'length',
        `must be ${min === max ? `${max}` : `${min} to ${max}`} characters`,
      );
      return undefined;
    }
    if (pattern && !pattern.test(value)) {
      this.add(path, 'pattern', 'has characters or a form that is not allowed');
      return undefined;
    }
    return value;
  }

  array(
    value: unknown,
    path: string,
    min: number,
    max: number,
  ): readonly unknown[] | undefined {
    if (!Array.isArray(value)) {
      this.add(path, 'type', 'must be an array');
      return undefined;
    }
    if (value.length < min || value.length > max) {
      this.add(
        path,
        'count',
        `must have ${min === 0 ? `at most ${max}` : `${min} to ${max}`} items`,
      );
      return undefined;
    }
    return value;
  }
}

/** Counts UTF-8 bytes of a string, which is what the size caps of 3.6 are measured in. */
export const utf8Length = (text: string): number =>
  new TextEncoder().encode(text).length;

/**
 * Size cap and JSON syntax for a project file's text, shared by both validators. The cap is on the bytes
 * received (3.6), so it is checked here and not on a header.
 */
export function parseProjectFileText(
  text: string,
  maxBytes: number,
): ValidationResult<unknown> {
  if (utf8Length(text) > maxBytes) {
    return {
      ok: false,
      errors: [
        {
          path: '',
          code: 'too-large',
          message: `the file is larger than ${maxBytes} bytes`,
        },
      ],
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      errors: [
        { path: '', code: 'not-json', message: 'the file is not valid JSON' },
      ],
    };
  }
}
