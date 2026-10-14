import type { IQueryDef } from '../models/definition/query-def';
import type {
  FederatedOutputPage,
  FederatedQueryObserver,
  FederatedQueryProgress,
  FederatedQueryResult,
} from './federated-query-executor';
import type { FederatedSourceRights } from './federated-source-rights';
import { localResultBytes } from './local-result-bytes';
import { readOvdbOrdinaryResult } from './ovdb-ordinary-result';
import { ovdbResultColumns, ovdbStreamRow } from './ovdb-stream-values';

/** Consumes the released ordinary /dtql envelope. The worker may stage rows
 * using its existing direct-result sink, but no rows are exposed until the
 * entire response and current source-rights evidence have been validated. */
export async function consumeOvdbOrdinaryQuery(
  response: Response,
  definition: IQueryDef,
  base: string,
  database: string,
  rights: FederatedSourceRights,
  signal?: AbortSignal,
  onProgress?: (progress: FederatedQueryProgress) => void,
  onOutputPage?: FederatedOutputPage,
  observer?: FederatedQueryObserver,
): Promise<FederatedQueryResult & { readonly nativeDirect: true }> {
  const result = await readOvdbOrdinaryResult(response, signal);
  signal?.throwIfAborted();
  rights.acceptWholeQuery(result.evidence as Record<string, unknown>);
  const columns = ovdbResultColumns(result.columns, definition);
  const preview: Readonly<Record<string, unknown>>[] = [];
  let previewBytes = 0;
  let firstRecord = true;
  for (const record of result.records) {
    signal?.throwIfAborted();
    if (firstRecord) {
      // The ordinary JSON envelope is fully received and validated before rows
      // are exposed, unlike the streaming endpoint's per-record callbacks.
      observer?.onFirstRecord?.();
      firstRecord = false;
    }
    if (!observer?.onNativeRecord) {
      const bytes = localResultBytes(record.data);
      if (preview.length >= 100 || previewBytes + bytes > 1024 * 1024)
        throw new Error(
          'The ordinary query needs a paged result sink beyond the direct preview limit.',
        );
      preview.push(record.data);
      previewBytes += bytes;
    }
    await observer?.onNativeRecord?.(record.data, signal);
  }
  signal?.throwIfAborted();
  const rows = preview.map((record) => ovdbStreamRow(record, columns));
  if (onOutputPage && !observer?.onNativeRecord) await onOutputPage(rows);
  onProgress?.({
    stage: 'complete',
    rowsLoaded: result.records.length,
    rowsProcessed: result.records.length,
    requestsCompleted: 1,
    requestsInFlight: 0,
    requestsPending: 0,
  });
  return {
    ...rights.evidence(),
    ...(result.evidence['providerReads'] === undefined
      ? {}
      : { providerReads: result.evidence['providerReads'] }),
    recordset: { columns, rows },
    totalRows: result.records.length,
    hasMore: false,
    nativeDirect: true,
    limitations: [],
    bindingsApplied: [],
    truncated: false,
    provenance: {
      source: `${base}/v1/databases/${database} (direct OVDB)`,
      queryId: definition.id,
      mode: 'live',
      observedAt: new Date().toISOString(),
      executionProfile: 'protected',
    },
  };
}
