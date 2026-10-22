/** A board, query or other saved item that the project does not have. Shown as a not-found state, not as a failure. */
export class ProjectItemNotFoundError extends Error {
  constructor(
    readonly itemKind: 'board' | 'query',
    readonly itemId: string,
  ) {
    super(`The ${itemKind} was not found.`);
    this.name = 'ProjectItemNotFoundError';
  }
}

/** Whether `error` says the item is missing: the typed error above, or an agent/API answer of `404`. */
export function isProjectItemNotFound(error: unknown): boolean {
  return (
    error instanceof ProjectItemNotFoundError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { status?: unknown }).status === 404)
  );
}
