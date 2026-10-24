import { Injectable, inject } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import { defer, firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { DatatugApiService } from '../services/base/datatug-api.service';
import {
  ContextSnapshot,
  readContextSnapshot,
} from '../session-context/session-context-contract';
import {
  WorkAction,
  WorkActivity,
  WorkDetail,
  WorkFilters,
  WorkItem,
  WorkLink,
  WorkPage,
  WorkScope,
} from './work.models';

/** Reads and writes use the same authenticated project boundary; assignment grants no access. */
@Injectable({ providedIn: 'root' })
export class WorkApiService {
  private readonly api = inject(DatatugApiService);
  private params(
    scope: WorkScope,
    extra: Record<string, string> = {},
  ): HttpParams {
    if (
      ![scope.spaceID, scope.projectID].every((v) =>
        /^[A-Za-z0-9_-]{1,128}$/.test(v),
      )
    )
      throw new Error('Invalid Work project scope.');
    return new HttpParams({
      fromObject: {
        spaceID: scope.spaceID,
        projectID: scope.projectID,
        ...extra,
      },
    });
  }
  private async get<T>(
    path: string,
    scope: WorkScope,
    extra: Record<string, string>,
    signal: AbortSignal,
  ): Promise<T> {
    const params = this.params(scope, extra);
    return firstValueFrom(
      defer(() => {
        signal.throwIfAborted();
        return this.api.get<T>(`datatug/work/${path}`, params);
      }).pipe(takeUntil(fromEvent(signal, 'abort'))),
    );
  }
  async list(
    scope: WorkScope,
    filters: WorkFilters,
    signal: AbortSignal,
  ): Promise<WorkPage> {
    const page = await this.get<WorkPage>(
      'items',
      scope,
      Object.fromEntries(
        Object.entries(filters).filter(([, v]) => !!v),
      ) as Record<string, string>,
      signal,
    );
    if (
      !page ||
      !Array.isArray(page.items) ||
      !Array.isArray(page.members) ||
      !page.capabilities ||
      typeof page.hasMore !== 'boolean' ||
      (page.hasMore && !page.nextCursor)
    )
      throw new Error('Invalid Work list response.');
    page.items.forEach((item) => this.validate(item, scope));
    return page;
  }
  async artifactLinks(
    scope: WorkScope,
    kind: 'check' | 'query',
    id: string,
    folder: string,
    signal: AbortSignal,
  ): Promise<{ items: WorkItem[]; links: WorkLink[] }> {
    const result = await this.get<{ items: WorkItem[]; links: WorkLink[] }>(
      'artifact-links',
      scope,
      { kind, id, ...(folder ? { folder } : {}) },
      signal,
    );
    if (!Array.isArray(result.items) || !Array.isArray(result.links))
      throw new Error('Invalid Work references response.');
    result.items.forEach((item) => this.validate(item, scope));
    if (
      result.links.some(
        (link) =>
          link.target.kind !== kind ||
          link.target.id !== id ||
          (link.target.folder || '') !== folder ||
          !result.items.some((item) => item.id === link.sourceId),
      )
    )
      throw new Error('The Work references belong to another artefact.');
    return result;
  }
  async activity(
    scope: WorkScope,
    id: string,
    cursor: string,
    signal: AbortSignal,
  ): Promise<{ items: WorkActivity[]; nextCursor?: string }> {
    const page = await this.get<{ items: WorkActivity[]; nextCursor?: string }>(
      'activity',
      scope,
      { id, ...(cursor ? { cursor } : {}) },
      signal,
    );
    if (
      !Array.isArray(page.items) ||
      page.items.some((event) => event.itemId !== id)
    )
      throw new Error('Invalid Work activity response.');
    return page;
  }
  async read(
    scope: WorkScope,
    id: string,
    signal: AbortSignal,
  ): Promise<WorkDetail> {
    return this.detail(
      await this.get<WorkDetail>('item', scope, { id }, signal),
      scope,
      id,
    );
  }
  async context(
    scope: WorkScope,
    id: string,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<ContextSnapshot> {
    const snapshot = readContextSnapshot(
      await this.get<ContextSnapshot>('context', scope, { id }, signal),
    );
    if (
      snapshot.session.id !== sessionId ||
      snapshot.session.projectId !== scope.projectID
    )
      throw new Error('The Context Bag belongs to another work item.');
    return snapshot;
  }
  async action(action: WorkAction, signal: AbortSignal): Promise<WorkDetail> {
    this.params(action);
    const body = structuredClone(action);
    const result = await firstValueFrom(
      defer(() => {
        signal.throwIfAborted();
        return this.api.post<WorkDetail>('datatug/work/actions', body, {
          retryUnauthorizedOnce: false,
        });
      }).pipe(takeUntil(fromEvent(signal, 'abort'))),
    );
    return this.detail(result, action, action.itemId);
  }
  private validate(item: WorkItem, scope: WorkScope): void {
    if (
      !item ||
      item.spaceID !== scope.spaceID ||
      item.projectID !== scope.projectID ||
      !item.id ||
      !['incident', 'case', 'task'].includes(item.type) ||
      !Number.isSafeInteger(item.version) ||
      item.version < 1 ||
      !item.contextSessionId ||
      typeof item.title !== 'string'
    )
      throw new Error('The server returned invalid or out-of-scope work.');
  }
  private detail(
    detail: WorkDetail,
    scope: WorkScope,
    id?: string,
  ): WorkDetail {
    this.validate(detail?.item, scope);
    if (
      (id && detail.item.id !== id) ||
      !detail.capabilities ||
      !Array.isArray(detail.members) ||
      !Array.isArray(detail.links) ||
      !Array.isArray(detail.activity)
    )
      throw new Error('The server returned inconsistent work details.');
    if (detail.context) {
      const snapshot = readContextSnapshot(detail.context);
      if (
        snapshot.session.id !== detail.item.contextSessionId ||
        snapshot.session.projectId !== scope.projectID
      )
        throw new Error(
          'The context association does not match this work item.',
        );
    }
    if (
      detail.activity.some((event) => event.itemId !== detail.item.id) ||
      detail.links.some(
        (link) =>
          link.sourceId !== detail.item.id &&
          !(link.target.kind === 'work' && link.target.id === detail.item.id),
      )
    )
      throw new Error(
        'The activity or relationships belong to different work.',
      );
    return detail;
  }
}
