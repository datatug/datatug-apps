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
// Firebase UIDs are limited to 128 characters. The hosted backend generates
// finish keys and receipts as 32-byte base64url values (43 characters).
const maxUidLength = 128;
const maxBindingStorageLength = 1024;
const maxPendingReturnStorageLength = 2048;
const opaqueIdPattern = /^[A-Za-z0-9_-]{43}$/;

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

  if (!discardPendingReturn()) {
    restoreCallback(callback);
    return 'unavailable';
  }

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
    if (!discardPendingReturn()) {
      restoreCallback(callback);
      return undefined;
    }
    return { callback, binding: readCloudLogsFinishKeyBinding() };
  }

  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(pendingCloudLogsReturnStorageKey);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;

  if (raw.length > maxPendingReturnStorageLength) {
    removePendingReturnIfCurrent(raw);
    return undefined;
  }
  const pending = parsePendingReturn(raw);
  if (!removePendingReturnIfCurrent(raw)) return undefined;
  if (!pending) return undefined;
  const currentBinding = readCloudLogsFinishKeyBinding();
  if (!sameBinding(pending.binding, currentBinding)) {
    return { callback: { status: 'failed' } };
  }
  if (pending.expiresAt < Date.now()) {
    return { callback: { status: 'failed' }, binding: pending.binding };
  }

  return { callback: pending.callback, binding: pending.binding };
}

/** Clear a preserved callback when a newer authorization attempt starts. */
export function discardPendingCloudLogsOAuthReturn(): boolean {
  return typeof window === 'undefined' || discardPendingReturn();
}

export function readCloudLogsFinishKeyBinding():
  | CloudLogsFinishKeyBinding
  | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(cloudLogsFinishKeyStorageKey);
    if (!raw || raw.length > maxBindingStorageLength) return undefined;
    const value = JSON.parse(raw) as Partial<CloudLogsFinishKeyBinding>;
    return isValidBinding(value)
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
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt > Date.now() + pendingReturnTtlMs ||
      !value.binding ||
      !isValidBinding(value.binding) ||
      !value.callback ||
      (value.callback.status !== 'failed' &&
        (value.callback.status !== 'complete' ||
          typeof value.callback.receipt !== 'string' ||
          !opaqueIdPattern.test(value.callback.receipt)))
    ) {
      return undefined;
    }
    return value as PendingCloudLogsOAuthReturn;
  } catch {
    return undefined;
  }
}

function removePendingReturnIfCurrent(expected: string): boolean {
  try {
    if (window.sessionStorage.getItem(pendingCloudLogsReturnStorageKey) !== expected)
      return false;
    window.sessionStorage.removeItem(pendingCloudLogsReturnStorageKey);
    return window.sessionStorage.getItem(pendingCloudLogsReturnStorageKey) === null;
  } catch {
    // Session storage may be blocked; no callback value is logged or exposed.
    return false;
  }
}

function discardPendingReturn(): boolean {
  try {
    const raw = window.sessionStorage.getItem(pendingCloudLogsReturnStorageKey);
    return raw === null || removePendingReturnIfCurrent(raw);
  } catch {
    return false;
  }
}

function isValidBinding(
  value: Partial<CloudLogsFinishKeyBinding>,
): value is CloudLogsFinishKeyBinding {
  if (
    typeof value.uid !== 'string' ||
    typeof value.finishKey !== 'string' ||
    !opaqueIdPattern.test(value.finishKey)
  )
    return false;
  const uidLength = Array.from(value.uid).length;
  return uidLength > 0 && uidLength <= maxUidLength;
}

function sameBinding(
  left: CloudLogsFinishKeyBinding | undefined,
  right: CloudLogsFinishKeyBinding | undefined,
): boolean {
  return !!left && !!right && left.uid === right.uid && left.finishKey === right.finishKey;
}

function restoreCallback(callback: CloudLogsOAuthReturn): void {
  window.__datatugTakeGoogleLogsReturn = () => {
    delete window.__datatugTakeGoogleLogsReturn;
    return callback;
  };
}
