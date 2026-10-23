/** Only finite diagnostics cross the worker boundary. Original causes stay in
 * the executor realm; never serialize Error, stack, response text or URL. */
export interface NativeQueryDiagnostic {
  readonly stage: 'capability_discovery' | 'query_execution';
  readonly reason: 'network' | 'http_status' | 'redirect' | 'invalid_response';
  readonly status?: number;
  readonly code?: 'query_budget_exceeded' | 'query_failed' | 'unsupported';
}

const stages = ['capability_discovery', 'query_execution'];
const reasons = ['network', 'http_status', 'redirect', 'invalid_response'];
const codes = ['query_budget_exceeded', 'query_failed', 'unsupported'];

export function decodeNativeQueryDiagnostic(
  value: unknown,
): NativeQueryDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const d = value as Record<string, unknown>;
  if (
    !Object.hasOwn(d, 'stage') ||
    !Object.hasOwn(d, 'reason') ||
    Object.keys(d).some(
      (key) => !['stage', 'reason', 'status', 'code'].includes(key),
    ) ||
    !stages.includes(d['stage'] as string) ||
    !reasons.includes(d['reason'] as string) ||
    (d['status'] !== undefined &&
      (!Number.isInteger(d['status']) ||
        Number(d['status']) < 100 ||
        Number(d['status']) > 599)) ||
    (d['reason'] === 'http_status' &&
      (Number(d['status']) < 300 || d['status'] === undefined)) ||
    (d['code'] !== undefined && !codes.includes(d['code'] as string))
  )
    return undefined;
  return {
    stage: d['stage'],
    reason: d['reason'],
    ...(d['status'] !== undefined ? { status: d['status'] } : {}),
    ...(d['code'] !== undefined ? { code: d['code'] } : {}),
  } as NativeQueryDiagnostic;
}

export function nativeQueryDiagnosticMessage(
  value: unknown,
): string | undefined {
  const d = decodeNativeQueryDiagnostic(value);
  if (!d) return undefined;
  const subject =
    d.stage === 'capability_discovery' ? 'OVDB metadata' : 'OVDB query';
  const reason =
    d.reason === 'network'
      ? 'could not be reached'
      : d.reason === 'http_status'
        ? `request failed (HTTP ${d.status})`
        : d.reason === 'redirect'
          ? 'redirect was refused'
          : 'response could not be validated';
  return `${subject} ${reason}${d.code ? ` [${d.code}]` : ''}. Retry or open the saved query to inspect it.`;
}

export class NativeQueryFailure extends Error {
  constructor(
    readonly diagnostic: NativeQueryDiagnostic,
    options?: ErrorOptions,
  ) {
    super(
      nativeQueryDiagnosticMessage(diagnostic) ?? 'The OVDB request failed.',
      options,
    );
    this.name = 'NativeQueryFailure';
  }
}

export function nativeQueryDiagnostic(
  error: unknown,
): NativeQueryDiagnostic | undefined {
  return error instanceof NativeQueryFailure
    ? decodeNativeQueryDiagnostic(error.diagnostic)
    : undefined;
}

export async function nativeQueryFetch(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  stage: NativeQueryDiagnostic['stage'],
): Promise<Response> {
  try {
    return await fetcher(input, init);
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw new NativeQueryFailure({ stage, reason: 'network' }, { cause });
  }
}

/** Like {@link nativeQueryFetch}, but only the browser's own network failure
 * (`TypeError: Failed to fetch`, a CORS block, an unreachable host) is mapped.
 * Errors a wrapping transport throws on purpose (byte budget, bounds, identity
 * checks) keep their own message. */
export async function ovdbNetworkFetch(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  stage: NativeQueryDiagnostic['stage'],
): Promise<Response> {
  try {
    return await fetcher(input, init);
  } catch (cause) {
    if (init.signal?.aborted || !(cause instanceof TypeError)) throw cause;
    throw new NativeQueryFailure({ stage, reason: 'network' }, { cause });
  }
}

export async function withNativeQueryStage<T>(
  stage: NativeQueryDiagnostic['stage'],
  signal: AbortSignal | undefined,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (cause) {
    if (signal?.aborted || cause instanceof NativeQueryFailure) throw cause;
    throw new NativeQueryFailure(
      { stage, reason: 'invalid_response' },
      { cause },
    );
  }
}

/** The existing bounded reader validates mapped JSON. Its arbitrary message is
 * kept only as a local cause; the wire admits these explicitly known codes. */
export function nativeHttpFailure(
  stage: NativeQueryDiagnostic['stage'],
  response: Pick<Response, 'status' | 'redirected'>,
  mapped?: string,
): NativeQueryFailure {
  const code = /^OVDB query failed \(([^)]+)\):/.exec(mapped ?? '')?.[1];
  return new NativeQueryFailure(
    {
      stage,
      reason: response.redirected
        ? 'redirect'
        : response.status >= 300 && response.status <= 599
          ? 'http_status'
          : 'invalid_response',
      ...(Number.isInteger(response.status) &&
      response.status >= 100 &&
      response.status <= 599
        ? { status: response.status }
        : {}),
      ...(code && codes.includes(code)
        ? { code: code as NativeQueryDiagnostic['code'] }
        : {}),
    },
    mapped ? { cause: new Error(mapped) } : undefined,
  );
}
