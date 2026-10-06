import {
  decodeRightsInventory,
  decodeSourceRights,
  decodeSourceRightsEvidence,
  type SourceRight,
  type SourceRightsEvidence,
} from '@sneat/datatug-semantic';

export interface PlannedRightsSource {
  readonly database: string;
  readonly name: string;
}
const sourceKey = (target: PlannedRightsSource): string =>
  JSON.stringify([target.database, target.name]);
const size = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;
const identity = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(identity).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, value]) => JSON.stringify(key) + ':' + identity(value))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'undefined';
};
/** Frozen before any emitted rows. Never imports a declaration from a later
 * page or a changed saved plan. Empty legacy declarations remain undeclared. */
export class FederatedSourceRights {
  private readonly entries = new Map<string, SourceRight>();
  private readonly bySource = new Map<string, readonly SourceRight[]>();
  private readonly used = new Set<string>();
  private readonly undeclaredIds = new Map<string, string>();
  private reported = false;
  constructor(
    planned: readonly PlannedRightsSource[],
    inventories: ReadonlyMap<string, readonly SourceRight[] | undefined>,
    expectedSourceRights?: readonly SourceRight[],
  ) {
    for (const target of planned) {
      const entries = decodeSourceRights(
        inventories.get(target.database) ?? [],
      ).filter(
        (right) =>
          right.source.databaseId === target.database &&
          right.source.recordset === target.name,
      );
      this.bySource.set(sourceKey(target), entries);
      for (const right of entries) {
        const prior = this.entries.get(right.sourceId);
        if (prior && identity(prior) !== identity(right))
          throw new Error('Conflicting preflight source terms.');
        this.entries.set(right.sourceId, right);
      }
    }
    for (const right of decodeSourceRights(expectedSourceRights ?? [])) {
      if (
        !planned.some(
          (target) =>
            target.database === right.source.databaseId &&
            target.name === right.source.recordset,
        )
      )
        throw new Error('Unplanned expected source terms identity.');
      if (identity(this.entries.get(right.sourceId)) !== identity(right))
        throw new Error(
          'Expected structured source terms missing or changed in preflight.',
        );
    }
    if (size(this.evidence()) > 262144)
      throw new Error('Source terms inventory exceeds metadata budget.');
  }
  accept(target: PlannedRightsSource, response: Record<string, unknown>): void {
    const expected = this.bySource.get(sourceKey(target));
    if (!expected) throw new Error('Unplanned source terms identity.');
    const evidence = decodeSourceRightsEvidence(response);
    const got = evidence.sourceRights ?? [];
    if (identity(got) !== identity(expected))
      throw new Error('Source terms missing, late or changed after preflight.');
    if (
      got.length &&
      identity(evidence.usedSourceIds) !==
        identity(got.map((right) => right.sourceId).sort())
    )
      throw new Error('Structured source usage evidence missing.');
    for (const id of evidence.usedSourceIds ?? []) {
      const known = expected.some((right) => right.sourceId === id);
      // An undeclared used source is disclosed by the server, but must still
      // correspond to this exact authorized request. Compare escaped suffixes
      // without generating or rewriting the server-owned sourceId.
      const pieces = id.startsWith('ovdb:') ? id.slice(5).split('/') : [];
      let matches = false;
      try {
        matches =
          pieces.length === 3 &&
          decodeURIComponent(pieces[1]) === target.database &&
          decodeURIComponent(pieces[2]) === target.name;
      } catch {
        /* malformed id */
      }
      if (!known && (expected.length > 0 || !matches))
        throw new Error('Unknown source usage identity.');
      if (!known) {
        const previous = this.undeclaredIds.get(sourceKey(target));
        if (previous && previous !== id)
          throw new Error('Undeclared source usage identity changed.');
        this.undeclaredIds.set(sourceKey(target), id);
      }
      this.used.add(id);
    }
    if (
      response['sourceRights'] !== undefined ||
      response['usedSourceIds'] !== undefined
    )
      this.reported = true;
    if (size(this.evidence()) > 262144)
      throw new Error('Source terms inventory exceeds metadata budget.');
  }
  evidence(): SourceRightsEvidence {
    return this.entries.size || this.reported
      ? {
          sourceRights: [...this.entries.values()]
            .map((right) => structuredClone(right))
            .sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1)),
          usedSourceIds: [...this.used].sort(),
        }
      : {};
  }
}
export async function preflightSourceRights(
  base: string,
  planned: readonly PlannedRightsSource[],
  httpFetch: typeof fetch,
  headers: Record<string, string>,
  signal?: AbortSignal,
  onBytes?: (bytes: number) => void,
  expectedSourceRights?: readonly SourceRight[],
): Promise<FederatedSourceRights> {
  const inventories = new Map<string, readonly SourceRight[] | undefined>();
  let encoded = 0;
  for (const database of new Set(planned.map((source) => source.database))) {
    const timeout = AbortSignal.timeout(15000);
    const effectiveSignal = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;
    effectiveSignal.throwIfAborted();
    const response = await httpFetch(
      `${base}/v1/databases/${encodeURIComponent(database)}`,
      {
        headers: { Accept: 'application/json', ...headers },
        redirect: 'error',
        signal: effectiveSignal,
      },
    );
    if (response.redirected || !response.ok)
      throw new Error('Source terms preflight unavailable.');
    // Bounded stream, including discovery overhead; never read a terms URL.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Source terms preflight missing response.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await new Promise<ReadableStreamReadResult<Uint8Array>>(
          (resolve, reject) => {
            const abort = (): void => {
              reject(effectiveSignal.reason);
              void reader.cancel(effectiveSignal.reason).catch(() => undefined);
            };
            effectiveSignal.addEventListener('abort', abort, { once: true });
            if (effectiveSignal.aborted) abort();
            reader
              .read()
              .then(resolve, reject)
              .finally(() =>
                effectiveSignal.removeEventListener('abort', abort),
              );
          },
        );
        if (chunk.done) break;
        bytes += chunk.value.length;
        onBytes?.(chunk.value.length);
        if (bytes > 1048576)
          throw new Error('Source discovery response exceeds byte limit.');
        chunks.push(chunk.value);
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    const document: unknown = JSON.parse(new TextDecoder().decode(body));
    if (!document || typeof document !== 'object' || Array.isArray(document))
      throw new Error('Invalid source terms discovery.');
    const inventory = decodeRightsInventory(
      document as Record<string, unknown>,
    );
    if (inventory?.some((right) => right.source.databaseId !== database))
      throw new Error('Source discovery terms identity differs.');
    encoded += size(inventory ?? []);
    if (encoded > 262144)
      throw new Error('Source terms preflight exceeds metadata budget.');
    inventories.set(database, inventory);
  }
  return new FederatedSourceRights(planned, inventories, expectedSourceRights);
}
