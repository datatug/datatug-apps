import { strictJson } from './strict-json';
export { strictJson } from './strict-json';
import { boundedResponseText } from './bounded-federation';

export interface ImmutableFile {
  readonly repository: string;
  readonly revision: string;
  readonly path: string;
  readonly sha256: string;
}
export interface CanonicalPins {
  readonly directory: ImmutableFile;
  readonly models: ImmutableFile;
  readonly meanings: ImmutableFile;
}
export const INITIAL_CANONICAL_PINS: CanonicalPins = {
  directory: {
    repository: 'https://github.com/openvaultdb/directory',
    revision: '02db362144d7924c6081dd6768cc0d7187ac9bc3',
    path: 'index.json',
    sha256: '2795164e7051fb5b3c59400e261a0219382d68c9d74178c13f86f3ac3ef11995',
  },
  models: {
    repository: 'https://github.com/modelspec-org/registry',
    revision: '48b30b250a61385d94d46a70968677870750ea35',
    path: 'index.json',
    sha256: '947e80bec116780f0ccb33c28caf4f2f5dbe53eb90e7b0e5c7f741116a69a320',
  },
  meanings: {
    repository: 'https://github.com/meaninggraph/registry',
    revision: '2d92bbdd45fc2552f231f8f993a5b8b8d5b7fa29',
    path: 'index.json',
    sha256: '5d710692a320374c02912c932d755b80f2cbe67a463ef419daa6a1d7c8bfc0b9',
  },
};

export type MetadataObject = Record<string, unknown>;
export function object(value: unknown, description: string): MetadataObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${description}.`);
  return value as MetadataObject;
}
export function array(value: unknown, description: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${description}.`);
  return value;
}
export function string(value: unknown, description: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096)
    throw new Error(`Invalid ${description}.`);
  return value;
}
export function exactFields(
  record: MetadataObject,
  consumed: readonly string[],
): void {
  for (const key of Object.keys(record))
    if (
      consumed.some(
        (name) => name !== key && name.toLowerCase() === key.toLowerCase(),
      )
    )
      throw new Error('Aliased consumed metadata field.');
}
export function immutableUrl(file: ImmutableFile): string {
  if (
    !/^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(
      file.repository,
    ) ||
    !/^[a-f0-9]{40}$/.test(file.revision) ||
    !/^[a-f0-9]{64}$/.test(file.sha256) ||
    !/^[A-Za-z0-9_./-]+$/.test(file.path) ||
    file.path.length > 1024 ||
    /(^\/|\/$|\/\/|(^|\/)(\.|\.\.|\.[gG][iI][tT])($|\/))/.test(file.path)
  )
    throw new Error(
      'Canonical metadata must use immutable GitHub files and exact hashes.',
    );
  return `https://raw.githubusercontent.com/${file.repository.slice('https://github.com/'.length)}/${file.revision}/${file.path}`;
}
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Rebuildable bytes keyed by every immutable coordinate; never stores decisions. */
export class CanonicalMetadataCache {
  private readonly entries = new Map<string, string>();
  private generation = '';
  begin(pins: CanonicalPins): void {
    const generation = JSON.stringify(pins);
    if (generation !== this.generation) {
      this.entries.clear();
      this.generation = generation;
    }
  }
  clear(): void {
    this.entries.clear();
    this.generation = '';
  }
  get(file: ImmutableFile): string | undefined {
    return this.entries.get(JSON.stringify(file));
  }
  set(file: ImmutableFile, text: string): void {
    this.entries.set(JSON.stringify(file), text);
  }
}

/** One discovery operation: aggregate budget also charges reused cache bytes. */
export class CanonicalMetadataReader {
  private admittedBytes = 0;
  private references = 0;
  private readonly admitted = new Map<string, Promise<string>>();
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly httpFetch: typeof fetch,
    private readonly cache: CanonicalMetadataCache,
    private readonly signal: AbortSignal,
  ) {}
  async text(
    file: ImmutableFile,
    ancestry: readonly string[] = [],
  ): Promise<string> {
    const url = immutableUrl(file);
    if (ancestry.length > 8 || ancestry.includes(url))
      throw new Error(
        'Canonical metadata has a cycle or exceeds reference depth.',
      );
    const identity = JSON.stringify(file);
    const previous = this.admitted.get(identity);
    if (previous) return previous;
    if (++this.references > 96)
      throw new Error('Canonical metadata exceeds the reference count bound.');
    const request = this.queue.then(async () => {
      this.signal.throwIfAborted();
      let text = this.cache.get(file);
      if (text === undefined) {
        const response = await this.httpFetch(url, {
          redirect: 'error',
          signal: this.signal,
          headers: { Accept: 'application/json, application/yaml, text/plain' },
        });
        const read = await boundedResponseText(
          response,
          2 * 1024 * 1024 - this.admittedBytes,
          this.signal,
        );
        if (!response.ok)
          throw new Error(
            `Canonical metadata unavailable (${response.status}).`,
          );
        text = read.text;
      }
      this.admittedBytes += new TextEncoder().encode(text).byteLength;
      if (this.admittedBytes > 2 * 1024 * 1024)
        throw new Error('Discovery metadata exceeds the aggregate 2MiB bound.');
      if ((await sha256(text)) !== file.sha256)
        throw new Error('Canonical metadata checksum mismatch.');
      this.cache.set(file, text);
      return text;
    });
    this.queue = request.then(
      () => undefined,
      () => undefined,
    );
    this.admitted.set(identity, request);
    return request;
  }
  async json(
    file: ImmutableFile,
    ancestry: readonly string[] = [],
  ): Promise<MetadataObject> {
    return object(
      strictJson(await this.text(file, ancestry)),
      'canonical document',
    );
  }
  get bytes(): number {
    return this.admittedBytes;
  }
}

export interface CanonicalIndexes {
  readonly pins: CanonicalPins;
  readonly directory: MetadataObject;
  readonly models: MetadataObject;
  readonly meanings: MetadataObject;
  readonly bytes: number;
}
export async function readCanonicalIndexes(
  pins: CanonicalPins,
  reader: CanonicalMetadataReader,
): Promise<CanonicalIndexes> {
  // Sequential traversal keeps aggregate admission atomic and bounded.
  const directory = await reader.json(pins.directory);
  const models = await reader.json(pins.models);
  const meanings = await reader.json(pins.meanings);
  exactFields(directory, ['format', 'databases']);
  exactFields(models, ['format', 'models']);
  exactFields(meanings, ['format', 'graphs']);
  if (
    directory['format'] !== 'ovdb-directory/draft-1' ||
    models['format'] !== 'modelspec-registry/draft-1' ||
    meanings['format'] !== 'meaning-registry/draft-1'
  )
    throw new Error('Unsupported canonical index format.');
  array(directory['databases'], 'Directory databases');
  array(models['models'], 'ModelSpec records');
  array(meanings['graphs'], 'MeaningGraph records');
  return { pins, directory, models, meanings, bytes: reader.bytes };
}
