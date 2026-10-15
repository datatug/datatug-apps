import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { SneatApiService } from '@sneat/api';
import { formatGithubProjectApiKey, isValidGithubRef, readGithubProjectId } from '@datatug/project-address';
import { firstValueFrom } from 'rxjs';
import { IProjectRef, isSharedProjectRef, isValidProjectRef } from '../core/project-context';
import { buildAgentUrl } from '../services/repo/agent-url';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { projectApiQuery } from '../nav/project-api-routing';
import {
  ContextCapabilities, ContextCommand, ContextReceipt, ContextSessionPage, SessionScope,
  ContextSnapshot, contextOpaqueId, readContextSnapshot,
  ContextInputSnapshot, ContextEntryRevision, ContextRun, ContextMessage,
} from './session-context-contract';

import { DetectiveOperationScope, SessionDetectiveRequest, SessionDetectiveResponse, readSessionDetectiveResponse, validDetectiveOperationScope } from './session-detective-contract';

/** All authority lives at the admitted server's transaction owner, never in this client. */
@Injectable({ providedIn: 'root' })
export class SessionContextApiService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(SneatApiService);

  private readonly projectQueries = inject(ProjectQueryApiService);
  // A workspace keeps its project reference for reads and commands. Resolve a
  // default once for that reference, so a repository default change cannot
  // redirect an already open session's source admission.
  private readonly branches = new WeakMap<IProjectRef, Promise<string>>();

  private reference(ref: IProjectRef): Record<string, string> | Promise<Record<string, string>> {
    if (!isValidProjectRef(ref)) throw new Error('Open a valid project before using sessions.');
    if (ref.projectApi) projectApiQuery(ref);
    if (ref.spaceID !== undefined) {
      if (!isSharedProjectRef(ref)) throw new Error('Invalid shared project scope.');
      return { storage: 'firestore', spaceID: ref.spaceID, project: ref.projectId };
    }
    if (['github', 'github.com'].includes(ref.storeId)) {
      const address = readGithubProjectId(ref.projectId);
      if (!address.ok) throw new Error('Invalid GitHub project scope.');
      const embedded = address.id.ref;
      if (ref.branch && embedded && ref.branch !== embedded)
        throw new Error('The project address and selected branch disagree. Open the project with one explicit branch.');
      const selected = ref.branch || embedded;
      const reference = { storage: 'github.com', project: formatGithubProjectApiKey(address.id) };
      if (selected && selected !== 'HEAD') return { ...reference, branch: this.validBranch(selected) };
      let branch = this.branches.get(ref);
      if (!branch) {
        branch = firstValueFrom(this.projectQueries.branches(ref)).then((result) => {
          if (!result.defaultBranch || result.defaultBranch === 'HEAD') throw new Error();
          return this.validBranch(result.defaultBranch);
        }).catch((error: unknown) => {
          this.branches.delete(ref);
          if (error instanceof HttpErrorResponse && [401, 403, 503].includes(error.status)) throw error;
          throw new Error('The repository default branch could not be resolved. Open this project with an explicit branch.');
        });
        this.branches.set(ref, branch);
      }
      return branch.then((resolved) => ({ ...reference, branch: resolved }));
    }
    return { storage: ref.storeId === 'firestore' ? 'firestore' : 'local', project: ref.projectId };
  }

  private validBranch(branch: string): string {
    if (!isValidGithubRef(branch))
      throw new Error('Open the project with a valid explicit branch.');
    return branch;
  }

  private get<T>(ref: IProjectRef, path: string, extra: Record<string, string> = {}): Promise<T> {
    const get = (reference: Record<string, string>): Promise<T> => {
      const params = new HttpParams({ fromObject: { ...reference, ...extra } });
      return firstValueFrom(['github', 'github.com', 'firestore'].includes(ref.storeId)
        ? this.api.get<T>(`datatug/session-context/${path}`, params)
        : this.http.get<T>(buildAgentUrl(ref.storeId, `/session-context/${path}`), { params }));
    };
    const reference = this.reference(ref);
    return reference instanceof Promise ? reference.then(get) : get(reference);
  }

  async capabilities(ref: IProjectRef): Promise<ContextCapabilities> {
    const value = await this.get<ContextCapabilities>(ref, 'capabilities');
    if (value?.schemaVersion !== 1 || !value.actorId || !value.databaseId || !value.projectId ||
      !Array.isArray(value.environments) || !Array.isArray(value.actions) ||
      value.environments.some((scope) => !scope.environmentId || !scope.identityDomain) ||
      (value.nativeDetective === true && (!validDetectiveOperationScope(value.operationScope) || value.operationScope.databaseId !== value.databaseId || value.operationScope.projectId !== value.projectId)))
      throw new Error('This server does not support session Context Bags.');
    return value;
  }

  list(ref: IProjectRef, capabilities: ContextCapabilities, cursor?: string): Promise<ContextSessionPage> {
    return this.get(ref, 'sessions', { databaseId: capabilities.databaseId, projectId: capabilities.projectId, limit: '50', ...(cursor ? { cursor } : {}) });
  }

  async read(ref: IProjectRef, capabilities: ContextCapabilities, sessionId: string): Promise<ContextSnapshot> {
    if (!contextOpaqueId(sessionId)) throw new Error('Invalid session ID.');
    const snapshot = readContextSnapshot(await this.get<ContextSnapshot>(ref, `sessions/${sessionId}`, {
      databaseId: capabilities.databaseId, projectId: capabilities.projectId,
    }));
    if (snapshot.session.id !== sessionId || snapshot.session.databaseId !== capabilities.databaseId || snapshot.session.projectId !== capabilities.projectId)
      throw new Error('The session does not belong to this operational database and project.');
    return snapshot;
  }

  async command(ref: IProjectRef, capabilities: ContextCapabilities, command: ContextCommand): Promise<ContextReceipt> {
    const reference = this.reference(ref);
    const params = new HttpParams({ fromObject: {
      ...(reference instanceof Promise ? await reference : reference), databaseId: capabilities.databaseId, projectId: capabilities.projectId,
    } });
    // Capabilities enrich scopes with presentation/source metadata. Core's strict
    // mutation schema accepts only the two authoritative identity fields.
    const wireScope = (scope: SessionScope): SessionScope => ({ environmentId: scope.environmentId, identityDomain: scope.identityDomain });
    const commandBody = command.action === 'importLegacy'
      ? { opId: command.opId, action: command.action, legacyImport: command.legacyImport ? { ...command.legacyImport, scope: wireScope(command.legacyImport.scope) } : undefined }
      : { ...command, ...(command.scope ? { scope: wireScope(command.scope) } : {}) };
    const body = { ...commandBody, databaseId: capabilities.databaseId, projectId: capabilities.projectId };
    const result = ['github', 'github.com', 'firestore'].includes(ref.storeId)
      ? await firstValueFrom(this.api.post<{ receipt: ContextReceipt }>(
          'datatug/session-context/commands', body, { params }))
      : await firstValueFrom(this.http.post<{ receipt: ContextReceipt }>(
          buildAgentUrl(ref.storeId, '/session-context/commands'), body, { params }));
    if (result?.receipt?.opId !== command.opId ||
      (command.action === 'importLegacy'
        ? !contextOpaqueId(result.receipt.sessionId)
        : result.receipt.sessionId !== command.sessionId))
      throw new Error('The server did not confirm this operation. Retry with the same operation ID.');
    return result.receipt;
  }

  private async nativeRequest(ref: IProjectRef, scope: DetectiveOperationScope, operationId: string, body?: SessionDetectiveRequest | { operationId: string }, reconcile = false): Promise<SessionDetectiveResponse> {
    if (!validDetectiveOperationScope(scope) || !contextOpaqueId(operationId)) throw new Error('Native operation scope is unavailable.');
    if (!isValidProjectRef(ref)) throw new Error('Invalid original project authority.');
    let reference: Record<string, string>;
    if (ref.spaceID !== undefined) {
      if (!isSharedProjectRef(ref)) throw new Error('Invalid original shared project authority.');
      reference = { storage: 'firestore', project: ref.projectId, spaceID: ref.spaceID };
    } else if (['github', 'github.com'].includes(ref.storeId)) {
      const address = readGithubProjectId(ref.projectId);
      if (!address.ok) throw new Error('Invalid original GitHub authority.');
      reference = { storage: 'github.com', project: formatGithubProjectApiKey(address.id) };
    } else {
      reference = { storage: ref.storeId === 'firestore' ? 'firestore' : 'local', project: ref.projectId };
    }
    if (reference['storage'] !== scope.storage || reference['project'] !== scope.project || (reference['spaceID'] || '') !== (scope.spaceID || ''))
      throw new Error('This native operation belongs to a different project authority.');
    const params = new HttpParams({ fromObject: { ...scope } });
    const path = body ? (reconcile ? 'detective/reconcile' : 'detective') : `detective/operations/${operationId}`;
    const cloud = ['github', 'github.com', 'firestore'].includes(ref.storeId);
    const response = body
      ? await firstValueFrom(cloud ? this.api.post<SessionDetectiveResponse>(`datatug/session-context/${path}`, body, { params })
        : this.http.post<SessionDetectiveResponse>(buildAgentUrl(ref.storeId, `/session-context/${path}`), body, { params }))
      : await firstValueFrom(cloud ? this.api.get<SessionDetectiveResponse>(`datatug/session-context/${path}`, params)
        : this.http.get<SessionDetectiveResponse>(buildAgentUrl(ref.storeId, `/session-context/${path}`), { params }));
    return readSessionDetectiveResponse(response, operationId, scope);
  }
  nativeDetective(ref: IProjectRef, capabilities: ContextCapabilities, request: SessionDetectiveRequest): Promise<SessionDetectiveResponse> {
    if (capabilities.nativeDetective !== true || !validDetectiveOperationScope(capabilities.operationScope))
      throw new Error('This server has not enabled native session Checks.');
    return this.nativeRequest(ref, capabilities.operationScope, request.operationId, request);
  }
  nativeDetectiveOperation(ref: IProjectRef, scope: DetectiveOperationScope, operationId: string): Promise<SessionDetectiveResponse> {
    return this.nativeRequest(ref, scope, operationId);
  }
  reconcileNativeDetective(ref: IProjectRef, scope: DetectiveOperationScope, operationId: string): Promise<SessionDetectiveResponse> {
    return this.nativeRequest(ref, scope, operationId, { operationId }, true);
  }

  async operation(ref: IProjectRef, capabilities: ContextCapabilities, opId: string): Promise<ContextReceipt> {
    if (!contextOpaqueId(opId)) throw new Error('Invalid operation ID.');
    const receipt = await this.get<ContextReceipt>(ref, `operations/${opId}`, { databaseId: capabilities.databaseId, projectId: capabilities.projectId });
    if (receipt?.opId !== opId || !contextOpaqueId(receipt.sessionId)) throw new Error('The server returned an invalid operation receipt.');
    return receipt;
  }
  input(ref: IProjectRef, capabilities: ContextCapabilities, id: string): Promise<{ input: ContextInputSnapshot; revisions: readonly ContextEntryRevision[] }> {
    if (!contextOpaqueId(id)) throw new Error('Invalid input snapshot ID.');
    return this.get(ref, `inputs/${id}`, { databaseId: capabilities.databaseId, projectId: capabilities.projectId });
  }
  async run(ref: IProjectRef, capabilities: ContextCapabilities, id: string): Promise<ContextRun> {
    if (!contextOpaqueId(id)) throw new Error('Invalid run ID.');
    const run = await this.get<ContextRun>(ref, `runs/${id}`, { databaseId: capabilities.databaseId, projectId: capabilities.projectId });
    if (run.id !== id || !contextOpaqueId(run.sessionId) || !contextOpaqueId(run.inputSnapshotId) ||
      !['client', 'server'].includes(run.executionAuthority) || !Number.isSafeInteger(run.version) || run.version < 1)
      throw new Error('The server returned an invalid accepted run.');
    return run;
  }
  runs(ref: IProjectRef, capabilities: ContextCapabilities, sessionId: string, cursor?: string): Promise<{ items: readonly ContextRun[]; hasMore: boolean; nextCursor?: string }> {
    if (!contextOpaqueId(sessionId)) throw new Error('Invalid session ID.');
    return this.get(ref, `sessions/${sessionId}/runs`, { databaseId: capabilities.databaseId, projectId: capabilities.projectId, limit: '50', ...(cursor ? { cursor } : {}) });
  }
  messages(ref: IProjectRef, capabilities: ContextCapabilities, sessionId: string, cursor?: string): Promise<{ items: readonly ContextMessage[]; hasMore: boolean; nextCursor?: string }> {
    if (!contextOpaqueId(sessionId)) throw new Error('Invalid session ID.');
    return this.get(ref, `sessions/${sessionId}/messages`, { databaseId: capabilities.databaseId, projectId: capabilities.projectId, limit: '50', ...(cursor ? { cursor } : {}) });
  }
}
