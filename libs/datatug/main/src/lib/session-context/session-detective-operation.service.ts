import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { openDB } from 'idb';
import {
  IProjectRef,
  equalProjectRef,
  projectRefToString,
} from '../core/project-context';
import {
  ContextCapabilities,
  contextOpaqueId,
} from './session-context-contract';
import { SessionContextApiService } from './session-context-api.service';
import {
  DetectiveOperationScope,
  SessionDetectiveRequest,
  SessionDetectiveResponse,
  detectiveOperationScopeKey,
  validDetectiveOperationScope,
} from './session-detective-contract';

export interface NativeOperationDraft {
  readonly recoveryId: string;
  readonly actor: string;
  readonly project: IProjectRef;
  readonly locator: DetectiveOperationScope;
  readonly operationId: string;
  readonly sessionId: string;
  readonly checkId: string;
  readonly caseId?: string;
  readonly request?: SessionDetectiveRequest;
  readonly response?: SessionDetectiveResponse;
}
export interface NativeOperationRecovery extends Omit<
  NativeOperationDraft,
  'request'
> {
  readonly draftKey: string;
}
export interface NativeOperationStore {
  read(key: string): Promise<NativeOperationDraft | undefined>;
  write(key: string, value: NativeOperationDraft): Promise<void>;
  remove(key: string): Promise<void>;
  readRecovery(id: string): Promise<NativeOperationRecovery | undefined>;
  writeRecovery(value: NativeOperationRecovery): Promise<void>;
}
export const NATIVE_OPERATION_STORE = new InjectionToken<NativeOperationStore>(
  'Native operation device recovery',
  {
    providedIn: 'root',
    factory: () => {
      const db = openDB('datatug-native-operation-drafts', 1, {
        upgrade(database) {
          database.createObjectStore('operations');
        },
      });
      return {
        read: async (key) => (await db).get('operations', key),
        write: async (key, value) => {
          await (await db).put('operations', value, key);
        },
        remove: async (key) => {
          await (await db).delete('operations', key);
        },
        readRecovery: async (id) =>
          (await db).get('operations', 'recovery:' + id),
        writeRecovery: async (value) => {
          await (
            await db
          ).put('operations', value, 'recovery:' + value.recoveryId);
        },
      };
    },
  },
);

export function nativeOperationDraftKey(
  project: IProjectRef,
  actor: string,
  locator: DetectiveOperationScope,
  sessionId: string,
  checkId: string,
  caseId = '',
): string {
  return JSON.stringify([
    'native-detective/1',
    actor,
    projectRefToString(project),
    project.branch || '',
    detectiveOperationScopeKey(locator),
    sessionId,
    checkId,
    caseId,
  ]);
}

/** Device persistence is a retry draft, never a native acceptance receipt.
 * Loading or reconciling an operation never invokes its dispatch endpoint. */
@Injectable()
export class SessionDetectiveOperationService {
  private readonly api = inject(SessionContextApiService);
  private readonly store = inject(NATIVE_OPERATION_STORE);
  readonly draft = signal<NativeOperationDraft | undefined>(undefined);
  readonly busy = signal(false);
  readonly error = signal('');
  private key = '';
  private generation = 0;

  async open(
    project: IProjectRef,
    caps: ContextCapabilities,
    sessionId: string,
    checkId: string,
    caseId = '',
  ): Promise<void> {
    const generation = ++this.generation;
    this.draft.set(undefined);
    this.error.set('');
    this.busy.set(false);
    this.key = validDetectiveOperationScope(caps.operationScope)
      ? nativeOperationDraftKey(
          project,
          caps.actorId,
          caps.operationScope,
          sessionId,
          checkId,
          caseId,
        )
      : '';
    if (!this.key) return;
    const key = this.key;
    try {
      const draft = await this.store.read(key);
      if (generation !== this.generation || !draft) return;
      if (
        draft.actor !== caps.actorId ||
        !equalProjectRef(draft.project, project) ||
        draft.sessionId !== sessionId ||
        draft.checkId !== checkId ||
        (draft.caseId || '') !== caseId ||
        !contextOpaqueId(draft.operationId) ||
        !validDetectiveOperationScope(draft.locator) ||
        draft.locator.databaseId !== caps.databaseId ||
        draft.locator.projectId !== caps.projectId ||
        (caps.operationScope &&
          detectiveOperationScopeKey(draft.locator) !==
            detectiveOperationScopeKey(caps.operationScope))
      )
        throw new Error('Invalid recovery draft.');
      this.draft.set(draft);
      await this.observe(false);
    } catch {
      if (generation === this.generation)
        this.error.set(
          'Saved native status is unavailable. Reconnect to the original project; no execution was replayed.',
        );
    }
  }

  async start(
    project: IProjectRef,
    caps: ContextCapabilities,
    request: SessionDetectiveRequest,
  ): Promise<void> {
    const expectedKey = validDetectiveOperationScope(caps.operationScope)
      ? nativeOperationDraftKey(
          project,
          caps.actorId,
          caps.operationScope,
          request.sessionId,
          request.checkId,
          request.caseId,
        )
      : '';
    if (this.busy() || this.draft() || !this.key || this.key !== expectedKey)
      return;
    if (
      caps.nativeDetective !== true ||
      !validDetectiveOperationScope(caps.operationScope)
    ) {
      this.error.set('Native session Checks are not enabled by this server.');
      return;
    }
    const draft: NativeOperationDraft = structuredClone({
      recoveryId: 'recovery_' + crypto.randomUUID().replaceAll('-', ''),
      actor: caps.actorId,
      project,
      locator: caps.operationScope,
      operationId: request.operationId,
      sessionId: request.sessionId,
      checkId: request.checkId,
      ...(request.caseId ? { caseId: request.caseId } : {}),
      request,
    });
    const generation = this.generation,
      key = this.key;
    this.error.set('');
    this.busy.set(true);
    try {
      // Persist the original body and full source locator BEFORE any request.
      await this.persist(key, draft);
      if (generation !== this.generation) return;
      this.draft.set(draft);
      await this.dispatch(draft, caps, generation, key);
    } catch {
      if (generation === this.generation)
        this.error.set(
          'The request could not be saved safely. No new run was started.',
        );
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }

  /** An explicit user retry repeats only the frozen request, never the current form. */
  async retry(caps: ContextCapabilities): Promise<void> {
    const draft = this.draft();
    if (
      !draft ||
      !draft.request ||
      this.busy() ||
      draft.response?.status.done ||
      draft.response?.status.fenceReason ||
      draft.actor !== caps.actorId ||
      !caps.operationScope ||
      detectiveOperationScopeKey(draft.locator) !==
        detectiveOperationScopeKey(caps.operationScope)
    )
      return;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.dispatch(draft, caps, generation, this.key);
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }

  async observe(reconcile = true): Promise<void> {
    const draft = this.draft();
    if (!draft || this.busy()) return;
    const generation = this.generation,
      key = this.key;
    this.busy.set(true);
    this.error.set('');
    try {
      const response = reconcile
        ? await this.api.reconcileNativeDetective(
            draft.project,
            draft.locator,
            draft.operationId,
          )
        : await this.api.nativeDetectiveOperation(
            draft.project,
            draft.locator,
            draft.operationId,
          );
      if (generation !== this.generation) return;
      const saved = this.withResponse(draft, response);
      this.draft.set(saved);
      await this.persist(key, saved);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 403)
        await this.deny(draft, generation, key);
      if (generation === this.generation)
        this.error.set(
          error instanceof HttpErrorResponse && error.status === 403
            ? 'Access denied. Private retry inputs were discarded. Reconnect and refresh saved status.'
            : 'Native outcome is unconfirmed. Reconnect and refresh saved status. No Check was dispatched by this lookup.',
        );
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }

  async newRun(): Promise<void> {
    if (!this.draft()?.response?.status.done || this.busy()) return;
    const generation = this.generation,
      key = this.key;
    await this.store.remove(key);
    if (generation === this.generation) {
      this.draft.set(undefined);
      this.error.set('');
    }
  }

  private async persist(
    key: string,
    draft: NativeOperationDraft,
  ): Promise<void> {
    await this.store.write(key, draft);
    const metadata = { ...draft };
    delete metadata.request;
    await this.store.writeRecovery({ ...metadata, draftKey: key });
  }

  private withResponse(
    draft: NativeOperationDraft,
    response: SessionDetectiveResponse,
  ): NativeOperationDraft {
    const { request, ...metadata } = draft;
    return response.status.done || response.status.fenceReason
      ? { ...metadata, response }
      : { ...metadata, request, response };
  }
  private async deny(
    draft: NativeOperationDraft,
    generation: number,
    key: string,
  ): Promise<void> {
    if (generation !== this.generation) return;
    const metadata = { ...draft };
    delete metadata.request;
    delete metadata.response;
    this.draft.set(metadata);
    await this.persist(key, metadata);
  }

  private async dispatch(
    draft: NativeOperationDraft,
    caps: ContextCapabilities,
    generation: number,
    key: string,
  ): Promise<void> {
    const request = draft.request;
    if (!request) return;
    try {
      const response = await this.api.nativeDetective(
        draft.project,
        { ...caps, operationScope: draft.locator },
        request,
      );
      if (generation !== this.generation) return;
      const saved = this.withResponse(draft, response);
      this.draft.set(saved);
      await this.persist(key, saved);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 403)
        await this.deny(draft, generation, key);
      if (generation === this.generation)
        this.error.set(
          error instanceof HttpErrorResponse && error.status === 403
            ? 'Access denied. Private retry inputs were discarded. Reconnect and refresh saved status.'
            : 'Native acceptance is unconfirmed. Refresh saved status before retrying the identical request. There is no legacy fallback.',
        );
    }
  }
}
