import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { equalProjectRef, type IProjectRef } from '../core/project-context';
export interface NativeSourceInvalidation {
  readonly projectRef: IProjectRef;
  readonly actor: string;
  readonly sourceId: string;
  /** Source lifecycle actions affect every publication environment; publication actions name one. */
  readonly environment?: string;
  readonly action:
    | 'initialize'
    | 'correct'
    | 'replay'
    | 'reset'
    | 'publication';
}
export interface NativeSourceInterest {
  readonly environment: string;
  /** Omit when no admitted source binding is available: conservatively watch
   * every source in this actor/project/environment. This grants no access. */
  readonly sourceId?: string;
}
export function matchesNativeSourceInvalidation(
  event: NativeSourceInvalidation,
  ref: IProjectRef | undefined,
  actor: string,
  interest: NativeSourceInterest | undefined,
): boolean {
  return (
    !!interest &&
    event.actor === actor &&
    equalProjectRef(event.projectRef, ref) &&
    (interest.sourceId === undefined || event.sourceId === interest.sourceId) &&
    (event.environment === undefined ||
      event.environment === interest.environment)
  );
}
/** Transient invalidation only: no source state, results, grants or replay cache.
 * Verified existing source receipts publish; current GET remains authoritative. */
@Injectable({ providedIn: 'root' })
export class NativeSourceInvalidationService {
  private readonly notifications = new Subject<NativeSourceInvalidation>();
  readonly changes$ = this.notifications.asObservable();
  invalidate(event: NativeSourceInvalidation): void {
    this.notifications.next(structuredClone(event));
  }
}
