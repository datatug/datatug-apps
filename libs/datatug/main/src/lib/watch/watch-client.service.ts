import {
  HttpClient,
  HttpHeaders,
  HttpParams,
  HttpErrorResponse,
} from '@angular/common/http';
import { Injectable, Injector, inject, signal } from '@angular/core';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import type { ProjectCoordination } from '../models/definition/project';
import type { CheckDefinition, DetectiveInputValue } from '../detective/models';
import {
  type IProjectRef,
  isSharedProjectRef,
  projectRefToString,
} from '../core/project-context';
import { DatatugApiService } from '../services/base/datatug-api.service';
import type {
  WatchDefinition,
  WatchDelivery,
  WatchIdentity,
  WatchNotification,
  WatchRun,
  WatchStatus,
  WatchSubscription,
  WatchHostedScope,
  WatchRunnerEnrollment,
  WatchRunnerSource,
} from './watch.models';

export function coordinatorEndpoint(value: string): string {
  if (!/^https?:\/\//.test(value))
    throw new Error('The project coordinator endpoint is invalid.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The project coordinator endpoint is invalid.');
  }
  const local =
    ['localhost', '[::1]'].includes(url.hostname.toLowerCase()) ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.includes('?') ||
    value.includes('#') ||
    value.trim() !== value
  )
    throw new Error(
      'The project coordinator requires HTTPS, or HTTP on loopback, without credentials.',
    );
  return url.href.replace(/\/$/, '');
}

export function watchError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return 'The coordinator is unavailable. Check the connection and retry.';
    if (error.status === 401)
      return 'The coordinator credential expired or was refused. Connect again.';
    return (
      error.error?.error?.message ||
      `The coordinator request failed (${error.status}).`
    );
  }
  return error instanceof Error ? error.message : 'The Watch request failed.';
}

/** One in-memory user session. No coordinator credential enters browser storage,
 * project files, router state, query strings, or the DataTug agent transport. */
@Injectable({ providedIn: 'root' })
export class WatchClientService {
  private readonly http = inject(HttpClient);
  private readonly injector = inject(Injector);
  private lifetime = new Subject<void>();
  readonly identity = signal<WatchIdentity | undefined>(undefined);
  private session?:
    | {
        kind: 'selfhost';
        endpoint: string;
        namespace: string;
        project: string;
        token: string;
      }
    | ({ kind: 'hosted' } & WatchHostedScope);
  readonly setupNotice = signal('');
  seed?: {
    project: string;
    projectRef: string;
    principal: string;
    check: CheckDefinition;
    environment: string;
    inputs: Record<string, DetectiveInputValue>;
  };

  matches(config: ProjectCoordination, project: string): boolean {
    return (
      this.session?.kind === 'selfhost' &&
      this.session.endpoint === coordinatorEndpoint(config.endpoint) &&
      this.session.namespace === config.namespace &&
      this.session.project === project
    );
  }
  disconnect(): void {
    this.lifetime.next();
    this.lifetime.complete();
    this.lifetime = new Subject<void>();
    this.session = undefined;
    this.identity.set(undefined);
    this.setupNotice.set('');
  }
  matchesHosted(scope: WatchHostedScope): boolean {
    return (
      this.session?.kind === 'hosted' &&
      this.session.spaceID === scope.spaceID &&
      this.session.project === scope.project &&
      this.session.environment === scope.environment &&
      this.session.principal === scope.principal
    );
  }
  async connectHosted(
    ref: IProjectRef,
    environment: string,
    principal: string,
  ): Promise<void> {
    this.disconnect();
    if (
      !isSharedProjectRef(ref) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(environment) ||
      !principal
    )
      throw new Error(
        'Choose an accessible project and environment, and sign in.',
      );
    const session = {
      kind: 'hosted' as const,
      spaceID: ref.spaceID,
      project: ref.projectId,
      environment,
      principal,
    };
    this.session = session;
    try {
      const identity = await this.get<WatchIdentity>('identity');
      if (this.session !== session) return;
      if (
        identity.hosted !== true ||
        identity.id !== principal ||
        identity.spaceID !== session.spaceID ||
        identity.namespace !== session.spaceID ||
        identity.project !== session.project ||
        identity.environment !== environment ||
        !identity.channels ||
        !identity.limits
      )
        throw new Error(
          'The Watch response does not identify this account, Space, project and environment.',
        );
      this.identity.set(identity);
    } catch (error) {
      if (this.session !== session) return;
      if (this.session === session) this.disconnect();
      throw error;
    }
  }
  seedMatches(
    ref: IProjectRef,
    principal: string,
    environment: string,
  ): boolean {
    return (
      !!this.seed &&
      this.seed.projectRef === projectRefToString(ref) &&
      this.seed.principal === principal &&
      this.seed.environment === environment
    );
  }
  async connect(
    config: ProjectCoordination,
    project: string,
    token: string,
  ): Promise<void> {
    this.disconnect();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(config.namespace) ||
      !token.trim() ||
      /[\r\n]/.test(token)
    )
      throw new Error('Enter a valid coordinator user credential.');
    const session = {
      kind: 'selfhost' as const,
      endpoint: coordinatorEndpoint(config.endpoint),
      namespace: config.namespace,
      project,
      token: token.trim(),
    };
    this.session = session;
    try {
      const identity = await this.get<WatchIdentity>('identity');
      if (this.session !== session) return;
      if (
        !identity.id ||
        identity.project !== project ||
        identity.namespace !== config.namespace ||
        !identity.environment ||
        !identity.channels ||
        !identity.limits
      )
        throw new Error(
          'The credential does not identify this project and namespace.',
        );
      this.identity.set(identity);
    } catch (e) {
      if (this.session !== session) return;
      if (this.session === session) this.disconnect();
      throw e;
    }
  }
  private request() {
    const session = this.session;
    if (!session) throw new Error('Connect to this project coordinator first.');
    if (session.kind === 'hosted')
      return { session, headers: undefined, params: new HttpParams() };
    return {
      session,
      headers: new HttpHeaders({ Authorization: `Bearer ${session.token}` }),
      params: new HttpParams()
        .set('namespace', session.namespace)
        .set('project', session.project),
    };
  }
  private get<T>(path: string, extra?: Record<string, string>): Promise<T> {
    const { session, headers, params } = this.request();
    let scoped = params;
    for (const [key, value] of Object.entries(extra || {}))
      scoped = scoped.set(key, value);
    if (session.kind === 'hosted')
      return firstValueFrom(
        this.injector
          .get(DatatugApiService)
          .get<T>(this.hostedPath(session, path), scoped)
          .pipe(takeUntil(this.lifetime)),
      );
    return firstValueFrom(
      this.http
        .get<T>(`${session.endpoint}/v1/watch/${path}`, {
          headers,
          params: scoped,
        })
        .pipe(takeUntil(this.lifetime)),
    );
  }
  private post<T>(path: string, body: unknown): Promise<T> {
    const { session, headers, params } = this.request();
    if (session.kind === 'hosted')
      return firstValueFrom(
        this.injector
          .get(DatatugApiService)
          .post<T>(this.hostedPath(session, path), body)
          .pipe(takeUntil(this.lifetime)),
      );
    return firstValueFrom(
      this.http
        .post<T>(`${session.endpoint}/v1/watch/${path}`, body, {
          headers,
          params,
        })
        .pipe(takeUntil(this.lifetime)),
    );
  }
  private hostedPath(scope: WatchHostedScope, path: string): string {
    return `datatug/watch/${encodeURIComponent(scope.spaceID)}/${encodeURIComponent(scope.project)}/${encodeURIComponent(scope.environment)}/v1/watch/${path}`;
  }
  async refreshIdentity(): Promise<WatchIdentity | undefined> {
    const session = this.session,
      previous = this.identity();
    if (!session || !previous) return undefined;
    const identity = await this.get<WatchIdentity>('identity');
    if (this.session !== session) return undefined;
    if (
      identity.id !== previous.id ||
      identity.namespace !== previous.namespace ||
      identity.project !== previous.project ||
      identity.environment !== previous.environment ||
      !identity.channels ||
      !identity.limits ||
      (session.kind === 'hosted' &&
        (identity.hosted !== true || identity.spaceID !== session.spaceID))
    ) {
      this.disconnect();
      throw new Error(
        'The Watch identity changed. Reopen this project to continue.',
      );
    }
    this.identity.set(identity);
    return identity;
  }
  enrollments(after?: string) {
    return this.get<{ enrollments: WatchRunnerEnrollment[]; next?: string }>(
      'enrollments',
      after ? { after } : undefined,
    );
  }
  sources() {
    return this.get<{ sources: WatchRunnerSource[] }>('sources');
  }
  enroll(request: {
    operationId: string;
    capabilities: string[];
    sourceIDs: string[];
    telegramBotId?: string;
  }) {
    return this.post<{ enrollment: WatchRunnerEnrollment; token?: string }>(
      'enrollments',
      request,
    );
  }
  revoke(enrollment: WatchRunnerEnrollment) {
    return this.post<{ ok: boolean }>('enrollments/revoke', {
      id: enrollment.id,
      expectedRevision: enrollment.revision,
    });
  }
  rotate(enrollment: WatchRunnerEnrollment) {
    return this.post<{ enrollment: WatchRunnerEnrollment; token?: string }>(
      'enrollments/rotate',
      { id: enrollment.id, expectedRevision: enrollment.revision },
    );
  }
  definitions() {
    return this.get<{ definitions: WatchDefinition[] }>('definitions');
  }
  definition(id: string) {
    return this.get<{ definition: WatchDefinition }>('definition', { id });
  }
  save(definition: WatchDefinition, operationId: string) {
    return this.post<{ definition: WatchDefinition }>('definition', {
      definition,
      operationId,
      expectedVersion: definition.version,
    });
  }
  lifecycle(definition: WatchDefinition, lifecycle: 'enabled' | 'paused') {
    return this.post<{ definition: WatchDefinition }>('lifecycle', {
      id: definition.id,
      lifecycle,
      operationId: crypto.randomUUID(),
      expectedVersion: definition.version,
    });
  }
  delete(definition: WatchDefinition) {
    return this.post<{ ok: boolean }>('delete', {
      id: definition.id,
      operationId: crypto.randomUUID(),
      expectedVersion: definition.version,
    });
  }
  telegramStatus() {
    return this.get<{
      connected: boolean;
      botUsername: string;
      botId?: string;
      reconnectRequired?: boolean;
      connectionError?: string;
    }>('telegram/status');
  }
  telegramConnect() {
    return this.post<{ url: string; expiresAt: string }>(
      'telegram/connect',
      {},
    );
  }
  telegramDisconnect() {
    return this.post<{ ok: boolean }>('telegram/disconnect', {});
  }
  status() {
    return this.get<WatchStatus>('status');
  }
  reset(definition: WatchDefinition) {
    return this.post<{ definition: WatchDefinition }>('reset', {
      id: definition.id,
      expectedVersion: definition.version,
      operationId: crypto.randomUUID(),
    });
  }
  deliveries(watchId: string) {
    return this.get<{ deliveries: WatchDelivery[] }>('deliveries', { watchId });
  }
  runs(watchId: string) {
    return this.get<{ runs: WatchRun[] }>('runs', { watchId });
  }
  inbox() {
    return this.get<{ notifications: WatchNotification[] }>('inbox');
  }
  retry(id: string) {
    return this.post<{ ok: boolean }>('retry', { id });
  }
  read(id: string) {
    return this.post<{ ok: boolean }>('read', { id });
  }
  subscription(watchId: string) {
    return this.get<{ subscription: WatchSubscription }>('subscriptions', {
      watchId,
    });
  }
  subscribe(subscription: WatchSubscription) {
    return this.post<{ ok: boolean }>('subscription', subscription);
  }
}
