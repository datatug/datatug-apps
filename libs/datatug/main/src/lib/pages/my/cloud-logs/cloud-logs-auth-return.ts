export interface CloudLogsFinishKeyBinding {
  readonly uid: string;
  readonly finishKey: string;
}

export type CloudLogsOAuthReturn =
  | { readonly status: 'complete'; readonly receipt: string }
  | { readonly status: 'failed' };

export interface TakenCloudLogsOAuthReturn {
  readonly callback: CloudLogsOAuthReturn;
  readonly binding?: CloudLogsFinishKeyBinding;
}

type PendingCloudLogsOAuthReturn = TakenCloudLogsOAuthReturn & {
  readonly version: 1;
  readonly expiresAt: number;
};

export const cloudLogsFinishKeyStorageKey =
  'datatug:google-cloud-logs:finish-key';
const pendingCloudLogsReturnStorageKey =
  'datatug:google-cloud-logs:pending-return';
const pendingReturnTtlMs = 10 * 60 * 1000;

declare global {
  interface Window {
    __datatugTakeGoogleLogsReturn?: () => CloudLogsOAuthReturn;
  }
}

export type PreserveCloudLogsReturnResult = 'none' | 'saved' | 'unavailable';

/**
 * Preserve the scrubbed bootstrap callback across a full-page auth redirect.
 * The short-lived receipt stays tab-scoped and is never placed in a URL/log.
 */
export function preserveCloudLogsReturnForAuthRecovery(): PreserveCloudLogsReturnResult {
  if (typeof window === 'undefined') return 'none';
  const callback = window.__datatugTakeGoogleLogsReturn?.();
  if (!callback) return 'none';

  const binding = readCloudLogsFinishKeyBinding();
  if (!binding) {
    restoreCallback(callback);
    return 'unavailable';
  }

  const pending: PendingCloudLogsOAuthReturn = {
    version: 1,
    callback,
    binding,
    expiresAt: Date.now() + pendingReturnTtlMs,
  };
  try {
    window.sessionStorage.setItem(
      pendingCloudLogsReturnStorageKey,
      JSON.stringify(pending),
    );
    return 'saved';
  } catch {
    restoreCallback(callback);
    return 'unavailable';
  }
}

/** Take either the bootstrap callback or its short-lived recovery copy once. */
export function takeCloudLogsOAuthReturn():
  | TakenCloudLogsOAuthReturn
  | undefined {
  if (typeof window === 'undefined') return undefined;
  const callback = window.__datatugTakeGoogleLogsReturn?.();
  if (callback) {
    return { callback, binding: readCloudLogsFinishKeyBinding() };
  }

  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(pendingCloudLogsReturnStorageKey);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;

  const pending = parsePendingReturn(raw);
  removePendingReturnIfCurrent(raw);
  if (!pending) return undefined;
  if (pending.expiresAt < Date.now()) {
    return { callback: { status: 'failed' }, binding: pending.binding };
  }

  return { callback: pending.callback, binding: pending.binding };
}

export function readCloudLogsFinishKeyBinding():
  | CloudLogsFinishKeyBinding
  | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(cloudLogsFinishKeyStorageKey);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<CloudLogsFinishKeyBinding>;
    return typeof value.uid === 'string' &&
      !!value.uid &&
      typeof value.finishKey === 'string' &&
      !!value.finishKey
      ? { uid: value.uid, finishKey: value.finishKey }
      : undefined;
  } catch {
    return undefined;
  }
}

function parsePendingReturn(raw: string): PendingCloudLogsOAuthReturn | undefined {
  try {
    const value = JSON.parse(raw) as Partial<PendingCloudLogsOAuthReturn>;
    if (
      value.version !== 1 ||
      typeof value.expiresAt !== 'number' ||
      !value.binding ||
      typeof value.binding.uid !== 'string' ||
      !value.binding.uid ||
      typeof value.binding.finishKey !== 'string' ||
      !value.binding.finishKey ||
      !value.callback ||
      (value.callback.status !== 'failed' &&
        (value.callback.status !== 'complete' ||
          typeof value.callback.receipt !== 'string' ||
          !value.callback.receipt))
    ) {
      return undefined;
    }
    return value as PendingCloudLogsOAuthReturn;
  } catch {
    return undefined;
  }
}

function removePendingReturnIfCurrent(expected: string): void {
  try {
    if (
      window.sessionStorage.getItem(pendingCloudLogsReturnStorageKey) ===
      expected
    ) {
      window.sessionStorage.removeItem(pendingCloudLogsReturnStorageKey);
    }
  } catch {
    // Session storage may be blocked; no callback value is logged or exposed.
  }
}

function restoreCallback(callback: CloudLogsOAuthReturn): void {
  window.__datatugTakeGoogleLogsReturn = () => {
    delete window.__datatugTakeGoogleLogsReturn;
    return callback;
  };
}
