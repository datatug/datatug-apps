import { detectiveOperationId } from '../detective/detective-client.service';
/** Journal carries only a digest and opaque operation identity, never inputs,
 * definitions, selected private context records, rows or source permissions. */
export class RetainedRunIntent {
  private generation = 0;
  private conflict = false;
  private held?: { key: string; operationId: string; payload: unknown };
  get hasPending(): boolean {
    return !!this.held;
  }
  async prepare(
    identity: string,
    payload: unknown,
  ): Promise<{ operationId: string; payload: unknown }> {
    if (this.conflict)
      throw new Error(
        'The server reported a conflict. Review current state and explicitly abandon this original retry before starting a new run.',
      );
    const generation = this.generation;
    const frozen = structuredClone(payload);
    const bytes = new TextEncoder().encode(JSON.stringify([identity, frozen]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    if (generation !== this.generation)
      throw new Error('The run scope changed before its intent was prepared.');
    const key =
      'datatug-retained-run/1/' +
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
    if (this.held && this.held.key !== key)
      throw new Error(
        'A previous run has no confirmed outcome. Retry its exact original selection, or review possible prior delivery before abandoning it.',
      );
    if (!this.held) {
      let operationId = detectiveOperationId();
      try {
        const stored = sessionStorage.getItem(key);
        const previous = stored?.startsWith('conflict:')
          ? stored.slice(9)
          : stored;
        this.conflict = stored?.startsWith('conflict:') === true;
        if (
          typeof previous === 'string' &&
          /^operation-[a-f0-9-]{36}$/.test(previous)
        )
          operationId = previous;
        else sessionStorage.setItem(key, operationId);
      } catch {
        /* The same mounted intent remains retryable without device storage. */
      }
      this.held = { key, operationId, payload: frozen };
    }
    if (this.conflict)
      throw new Error(
        'The server reported a conflict. Review current state and explicitly abandon this original retry before starting a new run.',
      );
    return {
      operationId: this.held.operationId,
      payload: structuredClone(this.held.payload),
    };
  }
  rejectConflict(error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      error.status === 409
    ) {
      this.conflict = true;
      if (this.held) {
        try {
          sessionStorage.setItem(
            this.held.key,
            'conflict:' + this.held.operationId,
          );
        } catch {
          /* Mounted conflict review remains required. */
        }
      }
    }
  }
  confirm() {
    this.conflict = false;
    if (this.held) {
      try {
        sessionStorage.removeItem(this.held.key);
      } catch {
        /* A receipt is authoritative even when storage is unavailable. */
      }
      this.held = undefined;
    }
  }
  clearHeld() {
    this.conflict = false;
    this.generation++;
    this.held = undefined;
  }
  abandonReviewed() {
    this.confirm();
  }
}
