import {
  decodeEvidenceArtifactRef,
  resolveRowEvidence,
  type ArtifactRef,
  type Result,
  type RowEvidenceSelector,
} from '@sneat/datatug-semantic';
import { RetainedEvidenceScope } from './retained-evidence-contract';
import {
  readRetainedCheck,
  readRetainedExecution,
  type RetainedCheckView,
  type RetainedExecutionView,
  type RetainedOpenScope,
} from './retained-open-contract';
import { HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, firstValueFrom, fromEvent, map, takeUntil } from 'rxjs';
import { IProjectRef, isSharedProjectRef } from '../core/project-context';
import {
  ContextSubject,
  SessionScope,
} from '../session-context/session-context-contract';
import { DatatugApiService } from '../services/base/datatug-api.service';
import { SessionContextApiService } from '../session-context/session-context-api.service';
export interface NativeEvidenceMapping {
  readonly scope: SessionScope;
  readonly subject: ContextSubject;
}
export function evidenceScopeParams(
  ref: IProjectRef,
  environment: string,
): HttpParams {
  if (
    !isSharedProjectRef(ref) ||
    ref.branch !== undefined ||
    ref.projectApi !== undefined ||
    !environment ||
    environment.trim() !== environment
  )
    throw new Error('Choose a native hosted project and explicit environment.');
  return new HttpParams({
    fromObject: {
      storage: 'firestore',
      spaceID: ref.spaceID,
      project: ref.projectId,
      environment,
    },
  });
}
@Injectable({ providedIn: 'root' })
export class RetainedEvidenceApiService {
  private readonly api = inject(DatatugApiService);
  private readonly context = inject(SessionContextApiService);
  private async admittedScope(
    scope: RetainedEvidenceScope,
    signal: AbortSignal,
  ): Promise<RetainedOpenScope> {
    const capabilities = await this.context.capabilities(
      scope.projectRef,
      signal,
    );
    signal.throwIfAborted();
    if (
      capabilities.actorId !== scope.actor ||
      capabilities.projectId !== scope.projectRef.projectId
    )
      throw new Error('Current retained namespace does not match the project.');
    return {
      ...scope,
      nativeDatabaseId: capabilities.databaseId,
      nativeProjectId: capabilities.projectId,
    };
  }
  async read(
    scope: RetainedEvidenceScope,
    target: ArtifactRef,
    signal: AbortSignal,
  ): Promise<RetainedExecutionView | RetainedCheckView> {
    const ref = decodeEvidenceArtifactRef(target);
    let params = evidenceScopeParams(scope.projectRef, scope.environment),
      path: string;
    if (ref.kind === 'execution') {
      if (
        ref.execution.storeId !== scope.projectRef.storeId ||
        ref.execution.projectId !== scope.projectRef.projectId
      )
        throw new Error('Execution belongs to a different project.');
      params = params.set('executionId', ref.execution.executionId);
      path = 'execution';
    } else if (ref.kind === 'check-run') {
      if (
        ref.checkRun.storeId !== scope.projectRef.storeId ||
        ref.checkRun.projectId !== scope.projectRef.projectId ||
        ref.checkRun.environment !== scope.environment
      )
        throw new Error(
          'Check run belongs to a different project or environment.',
        );
      params = params
        .set('checkId', ref.checkRun.checkId)
        .set('checkVersion', String(ref.checkRun.checkVersion))
        .set('runId', ref.checkRun.runId);
      path = 'check-run';
    } else
      throw new Error(
        'This reference is a definition, not a supported retained run.',
      );
    const admittedScope = await this.admittedScope(scope, signal);
    const request = defer(() => {
      signal.throwIfAborted();
      return this.api.get<unknown>(`datatug/shipping/${path}`, params);
    });
    const wire = await firstValueFrom(
      request.pipe(takeUntil(fromEvent(signal, 'abort'))),
    );
    signal.throwIfAborted();
    const result =
      ref.kind === 'check-run'
        ? await readRetainedCheck(wire, admittedScope, ref.checkRun)
        : await readRetainedExecution(wire, admittedScope, ref.execution);
    signal.throwIfAborted();
    return result;
  }
  async openRow(
    scope: RetainedEvidenceScope,
    held: Result,
    selector: RowEvidenceSelector,
    signal: AbortSignal,
  ): Promise<RetainedExecutionView> {
    evidenceScopeParams(scope.projectRef, scope.environment);
    const captured = structuredClone(selector),
      slot = await resolveRowEvidence(held, captured);
    signal.throwIfAborted();
    if (
      !slot ||
      captured.scope.storeId !== scope.projectRef.storeId ||
      captured.scope.spaceID !== scope.projectRef.spaceID ||
      captured.scope.projectId !== scope.projectRef.projectId ||
      captured.scope.environment !== scope.environment
    )
      throw new Error('This exact held row evidence is unavailable.');
    const admittedScope = await this.admittedScope(scope, signal);
    const request = defer(() => {
      signal.throwIfAborted();
      return this.api.post<unknown>(
        'datatug/shipping/evidence/open',
        {
          spaceID: scope.projectRef.spaceID,
          projectId: scope.projectRef.projectId,
          environment: scope.environment,
          selector: captured,
        },
        { retryUnauthorizedOnce: false },
      );
    });
    const wire = await firstValueFrom(
      request.pipe(takeUntil(fromEvent(signal, 'abort'))),
    );
    signal.throwIfAborted();
    const result = await readRetainedExecution(
        wire,
        admittedScope,
        captured.execution,
        captured,
      ),
      current = await resolveRowEvidence(result.result, captured);
    const response = wire as Record<string, unknown>;
    if (
      !current ||
      JSON.stringify(response['evidence']) !== JSON.stringify(current)
    )
      throw new Error(
        'Current retained row evidence no longer matches the held selection.',
      );
    signal.throwIfAborted();
    return result;
  }

  contextScope(
    ref: IProjectRef,
    environment: string,
    signal: AbortSignal,
  ): Promise<NativeEvidenceMapping> {
    const params = evidenceScopeParams(ref, environment);
    const request = defer(() => {
      signal.throwIfAborted();
      return this.api.get<unknown>('datatug/shipping/context-scope', params);
    }).pipe(
      map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Current evidence context is unavailable.');
        const wire = value as Record<string, unknown>;
        if (
          Object.keys(wire).some((key) => !['scope', 'subject'].includes(key))
        )
          throw new Error('Unsupported context mapping.');
        const scope = wire['scope'] as SessionScope | undefined,
          subject = wire['subject'] as ContextSubject | undefined;
        if (
          !scope ||
          scope.environmentId !== environment ||
          typeof scope.identityDomain !== 'string' ||
          !scope.identityDomain ||
          Object.keys(scope).some(
            (key) => !['environmentId', 'identityDomain'].includes(key),
          ) ||
          !subject ||
          [subject.conceptId, subject.fieldId, subject.fieldMappingRef].some(
            (field) => typeof field !== 'string' || !field,
          )
        )
          throw new Error('Current evidence context mapping is unavailable.');
        return structuredClone({ scope, subject });
      }),
    );
    return firstValueFrom(request.pipe(takeUntil(fromEvent(signal, 'abort'))));
  }
}
