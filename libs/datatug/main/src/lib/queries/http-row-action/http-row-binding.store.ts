import { Injectable } from '@angular/core';
import type { HttpRowBinding } from '../http-parameter-binding';

/**
 * Hands the one selected result row to the HTTP query page it opens. Kept in
 * memory, never in the URL: row values may be personal data.
 */
@Injectable({ providedIn: 'root' })
export class HttpRowBindingStore {
  private pending?: { readonly queryId: string; readonly row: HttpRowBinding };

  offer(queryId: string, row: HttpRowBinding): void {
    this.pending = { queryId, row };
  }

  /** The row offered for this query, once. */
  take(queryId: string): HttpRowBinding | undefined {
    const pending = this.pending;
    if (!pending || pending.queryId !== queryId) return undefined;
    this.pending = undefined;
    return pending.row;
  }
}
