import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { IProjectRef } from '../../core/project-context';

export class ProjectItemsByAgent<T> {
  // private readonly byAgent: {[store: string]: {[id: string]: T[]}} = {};
  public readonly byRepo$: Record<
    string,
    Record<string, BehaviorSubject<T[]>>
  > = {};

  /**
   * `undefined` (not `EMPTY`) when nothing is cached yet for this
   * `storeId`/`projectId` — `EntityService.getAllEntities()`'s own `if (!o
   * || forceReload)` guard relies on that falsiness to trigger the actual
   * fetch. `EMPTY` (rxjs' shared completed-Observable singleton) is a real
   * object — always truthy — so returning it here made that guard's `!o`
   * check false on every FIRST call for any given project (cache miss or
   * hit alike), skipping the fetch entirely and leaving the caller
   * subscribed to an Observable that completes with no items, ever
   * (confirmed live, S136: `EntitiesPageComponent` stuck on "Loading..."
   * forever — `entityService.getAllEntities()` never actually called
   * through to `agentProvider.get()`/`githubReader.listEntityIds()`).
   * Also fixes a related latent crash this method had: the old `a ? … :
   * EMPTY` check only tested whether `storeId` had EVER cached anything,
   * not whether THIS `projectId` had — a second project under an already-seen
   * store would have hit `this.asObservable(a[projectId])` with
   * `a[projectId] === undefined`, throwing (`undefined.asObservable is not
   * a function`) the instant this method's own `.pipe()` call ran.
   */
  public getItems$(from: IProjectRef): Observable<T[]> | undefined {
    const { storeId, projectId } = from;
    const subject = this.byRepo$[storeId]?.[projectId];
    return subject ? this.asObservable(subject) : undefined;
  }

  public setItems$(to: IProjectRef, items: Observable<T[]>): Observable<T[]> {
    const { storeId, projectId } = to;
    let a = this.byRepo$[storeId];
    if (!a) {
      this.byRepo$[storeId] = a = {};
    }
    const subject = new BehaviorSubject<T[]>(undefined as unknown as T[]);
    a[projectId] = subject;
    items.subscribe({
      next: (v) => subject.next(v),
      error: (err) => subject.error(err),
    });
    return this.asObservable(subject) as Observable<T[]>;
  }

  private asObservable(o: Subject<T[]>) {
    return o.asObservable().pipe(filter((v) => v !== undefined));
  }
}
