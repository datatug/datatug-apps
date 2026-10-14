/** Minimal, actor-bound context needed to resume Business creation after OAuth. */
export interface BusinessGithubContinuation {
  readonly billingIntent: 'space_business';
  readonly spaceID: string;
}

interface StoredBusinessGithubContinuation extends BusinessGithubContinuation {
  readonly actorID: string;
  readonly savedAt: number;
}

const STORAGE_KEY = 'datatug:new-project:github-business-continuation';
const MAX_AGE_MS = 30 * 60 * 1000;
const SPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function saveBusinessGithubContinuation(
  actorID: string,
  spaceID: string,
  savedAt = Date.now(),
): boolean {
  if (
    !actorID ||
    actorID.length > 128 ||
    !SPACE_ID_PATTERN.test(spaceID) ||
    !Number.isFinite(savedAt)
  )
    return false;

  const value: StoredBusinessGithubContinuation = {
    actorID,
    billingIntent: 'space_business',
    spaceID,
    savedAt,
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** One-shot restore: mismatched, malformed, and expired context is discarded. */
export function takeBusinessGithubContinuation(
  actorID: string,
  now = Date.now(),
): BusinessGithubContinuation | undefined {
  let value: unknown;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    value = raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }

  if (!value || typeof value !== 'object') return undefined;
  const stored = value as Partial<StoredBusinessGithubContinuation>;
  if (
    !actorID ||
    stored.actorID !== actorID ||
    stored.billingIntent !== 'space_business' ||
    typeof stored.spaceID !== 'string' ||
    !SPACE_ID_PATTERN.test(stored.spaceID) ||
    typeof stored.savedAt !== 'number' ||
    !Number.isFinite(stored.savedAt) ||
    now < stored.savedAt ||
    now - stored.savedAt > MAX_AGE_MS
  )
    return undefined;

  return { billingIntent: 'space_business', spaceID: stored.spaceID };
}

export function clearBusinessGithubContinuation(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Session storage is optional outside the guarded OAuth continuation.
  }
}
