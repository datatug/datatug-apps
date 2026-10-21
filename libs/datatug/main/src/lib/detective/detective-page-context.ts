import { computed, inject } from '@angular/core';
import { distinctUntilChanged, map, merge } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { AgentContextService } from '@sneat/datatug-semantic';
import { SneatAuthStateService } from '@sneat/auth-core';
import { IProjectRef } from '../core/project-context';
import { isSharedProjectRef } from '../core/project-context';
import { IProjectContext } from '../nav/nav-models';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { agentBaseUrl } from '../services/repo/agent-url';
import { DetectiveRequestContext } from './detective-client.service';

/** Project identity is derived from the project route, including cold deep links. */
export function useDetectivePageContext() {
  const navigation = inject(DatatugNavContextService);
  const agent = inject(AgentContextService);
  const auth = inject(SneatAuthStateService);
  const authState = toSignal(auth.authState, { initialValue: undefined });
  const project = toSignal(navigation.currentProject, {
    initialValue: undefined,
  });
  const currentEnvironment = toSignal(navigation.currentEnv, {
    initialValue: undefined,
  });
  const ref = computed<IProjectRef | undefined>(() => project()?.ref);
  const unsupported = computed(() => {
    const projectRef = ref();
    const storeId = projectRef?.storeId;
    return (
      projectRef?.projectApi === 'cloud' ||
      (storeId === 'firestore' && !projectRef?.spaceID) ||
      storeId === 'github' ||
      storeId === 'github.com' ||
      (!!projectRef?.spaceID && !isSharedProjectRef(projectRef))
    );
  });
  const context = computed<DetectiveRequestContext | undefined>(() => {
    const projectRef = ref();
    if (!projectRef || unsupported()) return undefined;
    if (isSharedProjectRef(projectRef))
      return {
        kind: 'cloud',
        storage: 'firestore',
        spaceID: projectRef.spaceID,
        project: projectRef.projectId,
        branch: projectRef.branch,
        principal: authState()?.user?.uid,
      };
    const agentStoreId = projectRef.storeId;
    const securityContextId = agent
      .contextFor(agentBaseUrl(agentStoreId))
      .securityContextId();
    return securityContextId
      ? {
          kind: 'agent',
          agentStoreId,
          project: projectRef.projectId,
          securityContextId,
          branch: projectRef.branch,
          principal: authState()?.user?.uid,
        }
      : undefined;
  });
  /** Client-side fence only; the server remains the authority for access. */
  const identity = computed(() => {
    const request = context();
    const projectRef = ref();
    if (!request || !projectRef) return undefined;
    return JSON.stringify([
      projectRef.storeId,
      projectRef.spaceID || '',
      projectRef.projectId,
      projectRef.branch || '',
      authState()?.user?.uid || '',
      request.kind === 'agent' ? request.securityContextId : '',
    ]);
  });
  // Original native streams notify synchronously. Mutation cancellation must not
  // wait for an Angular effect before a replacement credential can resolve.
  const scopeChanges$ = merge(auth.authState, navigation.currentProject).pipe(
    map(() => identity()),
    distinctUntilChanged(),
  );
  return {
    scopeChanges$,
    project: project as () => IProjectContext | undefined,
    ref,
    currentEnvironment,
    unsupported,
    context,
    identity,
  };
}
