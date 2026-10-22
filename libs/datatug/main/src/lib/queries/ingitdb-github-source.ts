// inGitDB databases read by the browser straight from GitHub. An OVDB
// descriptor (YAML: an `ovdb-manifest/draft-1` with `storage.engine: ingitdb`
// and a GitHub repository pinned to a commit) says where the database lives;
// every collection is then one published default-view file
// (`$ingitdb/<collection>/<file>.ingr`), fetched anonymously from
// raw.githubusercontent.com. No DataTug or OVDB server is in the path.
//
// Only published views are read. A collection without one is reported as
// unavailable: listing record files would cost hundreds of GitHub requests per
// visitor and run into GitHub's anonymous rate limit.
import { parseCollectionSchema, parseYaml } from '@ingitdb/client';
import { parseIngr } from '@ingr/codec';
import { browserGitFileCache, gitFilePolicy, type CacheControlLayers, type GitFileCache } from './ingitdb-github-cache';

type Data = Record<string, unknown>;

/** A query's reference to one inGitDB database on GitHub, by its OVDB descriptor URL. */
export interface IngitdbSourceRef {
  readonly database: string;
  readonly descriptor: string;
}

export interface IngitdbRow {
  readonly key: string;
  readonly data: Data;
}

/** Shown next to results: what was read and where its source lives. */
export interface IngitdbGitSource {
  readonly title: string;
  /** https://github.com/<owner>/<repo> — never a raw file or API URL. */
  readonly repositoryUrl: string;
  readonly revision: string;
}

interface Descriptor {
  readonly title: string;
  readonly repository: string;
  readonly revision: string;
  /** RFC 9111 Cache-Control for files at `revision`, from `storage.github.cacheControl`. */
  readonly cacheControl?: string;
  readonly collections?: ReadonlySet<string>;
}

const RAW_ORIGIN = 'https://raw.githubusercontent.com';
const TIMEOUT_MS = 10000;
const DESCRIPTOR_MAX_BYTES = 65536;
const FILE_MAX_BYTES = 4 * 1024 * 1024;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** A full commit SHA: SHA-1 or SHA-256. */
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * A failure the query page shows as is: the source's name and one recovery
 * action, never a URL or status. `detail` keeps the sanitised reason.
 */
export class IngitdbSourceError extends Error {
  constructor(title: string, readonly detail: string) {
    super(`${title} is unavailable right now. Run the query again in a minute.`);
    this.name = 'IngitdbSourceError';
  }
}

function isRecord(value: unknown): value is Data {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** inGitDB's `cache_control` (database settings or collection definition): a standard Cache-Control value. */
function cacheControlOf(value: unknown): string | undefined {
  const raw = isRecord(value) ? value['cache_control'] : undefined;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function descriptorUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
      ? url : undefined;
  } catch {
    return undefined;
  }
}

function parseDescriptor(text: string, database: string): Descriptor {
  const raw = parseYaml(text);
  if (!isRecord(raw)) throw new IngitdbSourceError(database, 'descriptor is not a YAML mapping');
  const title = typeof raw['title'] === 'string' && raw['title'].trim() ? raw['title'].trim() : database;
  const storage = raw['storage'];
  const github = isRecord(storage) ? storage['github'] : undefined;
  if (raw['format'] !== 'ovdb-manifest/draft-1' || !isRecord(storage) || storage['engine'] !== 'ingitdb' ||
    !isRecord(github) || typeof github['repository'] !== 'string' || !REPOSITORY.test(github['repository']) ||
    typeof github['revision'] !== 'string' || !REVISION.test(github['revision']))
    throw new IngitdbSourceError(title, 'descriptor has no ingitdb storage pinned to a GitHub commit');
  const schemas = raw['schemas'];
  const collections = isRecord(schemas) && isRecord(schemas['collections'])
    ? new Set(Object.keys(schemas['collections'])) : undefined;
  const cacheControl = typeof github['cacheControl'] === 'string' && github['cacheControl'].trim()
    ? github['cacheControl'].trim() : undefined;
  return { title, repository: github['repository'], revision: github['revision'],
    ...(cacheControl ? { cacheControl } : {}), ...(collections ? { collections } : {}) };
}

/** Removes the `$` prefix and `:type` suffix INGR puts on column names; `$ID` becomes the key. */
function ingrRows(text: string): IngitdbRow[] {
  return parseIngr(text).records.map((record) => {
    const data: Data = {};
    let key: unknown;
    for (const [column, value] of Object.entries(record)) {
      const name = column.replace(/^\$/, '').replace(/:[^:]*$/, '');
      if (name === 'ID') key = value;
      else data[name] = value;
    }
    if (typeof key !== 'string' && typeof key !== 'number') throw new Error('a view record has no $ID');
    // The record key is also a joinable field, as `id` unless a column already has that name.
    if (!('id' in data)) data['id'] = String(key);
    return { key: String(key), data };
  });
}

function jsonRows(text: string): IngitdbRow[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error('a JSON view is not an array');
  return raw.map((item) => {
    if (!isRecord(item)) throw new Error('a JSON view record is not an object');
    const id = item['id'];
    if (typeof id !== 'string' && typeof id !== 'number') throw new Error('a JSON view record has no id');
    return { key: String(id), data: { ...item } };
  });
}

/** Loads descriptors once per run and reads collections from their published views. */
export class IngitdbGithubSources {
  private readonly refs = new Map<string, IngitdbSourceRef>();
  private readonly descriptors = new Map<string, Promise<Descriptor>>();
  private readonly roots = new Map<string, Promise<{ readonly roots: Data; readonly cacheControl?: string }>>();
  private readonly read_: Map<string, IngitdbGitSource> = new Map();

  constructor(refs: readonly IngitdbSourceRef[] | undefined,
    private readonly fetcher: typeof fetch, private readonly signal?: AbortSignal,
    private readonly cache: GitFileCache = browserGitFileCache(), private readonly now: () => number = Date.now) {
    for (const ref of refs ?? []) {
      if (!/^[A-Za-z0-9_-]+$/.test(ref.database) || !descriptorUrl(ref.descriptor))
        throw new IngitdbSourceError(ref.database,
          'ingitdbSources entries need a simple database name and a public HTTPS descriptor URL without a query string');
      this.refs.set(ref.database, ref);
    }
  }

  has(database: string | undefined): boolean {
    return database !== undefined && this.refs.has(database);
  }

  /** The Git sources this run actually read, in first-read order. */
  get sources(): readonly IngitdbGitSource[] {
    return [...this.read_.values()];
  }

  /**
   * Fresh cached files are used with no request; others are fetched (with
   * browser revalidation when a copy exists) and stored under the effective
   * Cache-Control policy, see ingitdb-github-cache.ts.
   */
  private async text(url: URL, maxBytes: number, title: string, what: string,
    layers: CacheControlLayers = {}, pinned = false, dataFile = false): Promise<string> {
    const cached = await this.cache.get(url.href);
    if (cached && this.now() - cached.storedAt < cached.ttlMs) return cached.text;
    const { text, cacheControl } = await this.network(url, maxBytes, title, what, !!cached);
    const policy = gitFilePolicy(url.href, cacheControl, layers, pinned, dataFile);
    if (policy.storable && policy.ttlMs > 0) await this.cache.put(url.href, text, policy.ttlMs);
    return text;
  }

  private async network(url: URL, maxBytes: number, title: string, what: string,
    revalidate: boolean): Promise<{ text: string; cacheControl: string | null }> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
    let response: Response;
    try {
      // No headers and no credentials: a CORS simple request, no preflight.
      response = await this.fetcher(url.href, {
        method: 'GET', credentials: 'omit', redirect: 'error', signal,
        // `no-cache` lets the browser revalidate its copy with GitHub's ETag.
        ...(revalidate ? { cache: 'no-cache' as const } : {}),
      });
    } catch {
      this.signal?.throwIfAborted();
      throw new IngitdbSourceError(title, `${what}: ${timeout.aborted ? `no answer within ${TIMEOUT_MS}ms` : 'network request failed'}`);
    }
    if (!response.ok) throw new IngitdbSourceError(title, `${what}: HTTP ${response.status}`);
    // Cache-Control is a CORS-safelisted response header, readable cross-origin.
    const cacheControl = response.headers.get('cache-control');
    const reader = response.body?.getReader();
    if (!reader) return { text: await response.text(), cacheControl };
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new IngitdbSourceError(title, `${what}: larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { text: new TextDecoder().decode(joined), cacheControl };
  }

  /** A metadata file at the pinned revision; its caching follows the origin. */
  private file(descriptor: Descriptor, path: string, maxBytes: number, what: string): Promise<string> {
    return this.text(this.rawUrl(descriptor, path), maxBytes, descriptor.title, what, {}, true);
  }

  /** A data file (a collection view): `ingitdbCacheControl` is the collection's, else the database's. */
  private dataFile(descriptor: Descriptor, path: string, what: string, ingitdbCacheControl?: string): Promise<string> {
    return this.text(this.rawUrl(descriptor, path), FILE_MAX_BYTES, descriptor.title, what,
      { ingitdb: ingitdbCacheControl, descriptor: descriptor.cacheControl }, true, true);
  }

  private rawUrl(descriptor: Descriptor, path: string): URL {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return new URL(`${RAW_ORIGIN}/${descriptor.repository}/${descriptor.revision}/${encoded}`);
  }

  private descriptor(database: string): Promise<Descriptor> {
    let promise = this.descriptors.get(database);
    if (!promise) {
      const ref = this.refs.get(database) as IngitdbSourceRef;
      promise = this.text(new URL(ref.descriptor), DESCRIPTOR_MAX_BYTES, database, 'descriptor')
        .then((text) => parseDescriptor(text, database));
      this.descriptors.set(database, promise);
    }
    return promise;
  }

  /** Root collections, and the database-level `cache_control` from `.ingitdb/settings.yaml` when it has one. */
  private rootCollections(database: string, descriptor: Descriptor): Promise<{ readonly roots: Data; readonly cacheControl?: string }> {
    let promise = this.roots.get(database);
    if (!promise) {
      promise = (async () => {
        // Settings only carry a cache hint here; a missing or unreadable file is no hint.
        const settings = await this.file(descriptor, '.ingitdb/settings.yaml', DESCRIPTOR_MAX_BYTES, 'settings')
          .then((text) => parseYaml(text), () => undefined);
        const cacheControl = cacheControlOf(settings);
        const parsed = parseYaml(await this.file(descriptor, '.ingitdb/root-collections.yaml', DESCRIPTOR_MAX_BYTES,
          'root collections'));
        if (!isRecord(parsed)) throw new IngitdbSourceError(descriptor.title, 'root collections are not a mapping');
        return { roots: parsed, ...(cacheControl ? { cacheControl } : {}) };
      })();
      this.roots.set(database, promise);
    }
    return promise;
  }

  async read(database: string, collection: string): Promise<IngitdbRow[]> {
    const descriptor = await this.descriptor(database);
    if (descriptor.collections && !descriptor.collections.has(collection))
      throw new IngitdbSourceError(descriptor.title, `descriptor declares no collection ${collection}`);
    const { roots, cacheControl: databaseCacheControl } = await this.rootCollections(database, descriptor);
    const path = roots[collection];
    if (typeof path !== 'string' || !path || path.split('/').some((part) => !part || part === '.' || part === '..'))
      throw new IngitdbSourceError(descriptor.title, `collection ${collection} is not a root collection`);
    const schema = parseCollectionSchema(
      await this.file(descriptor, `${path}/.collection/definition.yaml`, DESCRIPTOR_MAX_BYTES, `${collection} definition`));
    const view = schema.default_view;
    if (!isRecord(view))
      throw new IngitdbSourceError(descriptor.title, `collection ${collection} publishes no default view`);
    if (typeof view['max_batch_size'] === 'number' && view['max_batch_size'] > 0)
      throw new IngitdbSourceError(descriptor.title, `collection ${collection} publishes its view in batches`);
    const format = view['format'] === undefined ? 'ingr' : view['format'];
    if (format !== 'ingr' && format !== 'json')
      throw new IngitdbSourceError(descriptor.title, `collection ${collection} publishes an unsupported ${String(format)} view`);
    const named = view['file_name'] ?? view['file'];
    const base = typeof named === 'string' && /^[A-Za-z0-9_.-]+$/.test(named)
      ? named.replace(/\.(ingr|json)$/, '') : (path.split('/').pop() as string);
    // inGitDB precedence: the collection's cache_control replaces the database's whole.
    const text = await this.dataFile(descriptor, `$ingitdb/${path}/${base}.${format}`, `${collection} view`,
      cacheControlOf(schema) ?? databaseCacheControl);
    let rows: IngitdbRow[];
    try {
      rows = format === 'ingr' ? ingrRows(text) : jsonRows(text);
    } catch (error) {
      throw new IngitdbSourceError(descriptor.title,
        `${collection} view: ${error instanceof Error ? error.message : 'cannot be parsed'}`);
    }
    if (!this.read_.has(database))
      this.read_.set(database, {
        title: descriptor.title,
        repositoryUrl: `https://github.com/${descriptor.repository}`,
        revision: descriptor.revision,
      });
    return rows;
  }
}
