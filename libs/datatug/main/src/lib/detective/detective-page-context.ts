import { computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AgentContextService } from '@sneat/datatug-semantic';
import { IProjectRef } from '../core/project-context';
import { IProjectContext } from '../nav/nav-models';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { agentBaseUrl } from '../services/repo/agent-url';
import { DetectiveRequestContext } from './detective-client.service';

/** Project identity is derived from the project route, including cold deep links. */
export function useDetectivePageContext() {
  const navigation = inject(DatatugNavContextService);
  const agent = inject(AgentContextService);
  const project = toSignal(navigation.currentProject, {
    initialValue: undefined,
  });
  const currentEnvironment = toSignal(navigation.currentEnv, {
    initialValue: undefined,
  });
  const ref = computed<IProjectRef | undefined>(() => project()?.ref);
  const unsupported = computed(() => {
    const storeId = ref()?.storeId;
    return (
      ref()?.projectApi === 'cloud' ||
      storeId === 'firestore' ||
      storeId === 'github' ||
      storeId === 'github.com' ||
      !!ref()?.spaceID
    );
  });
  const context = computed<DetectiveRequestContext | undefined>(() => {
    const projectRef = ref();
    if (!projectRef || unsupported()) return undefined;
    const agentStoreId = projectRef.storeId;
    const securityContextId = agent
      .contextFor(agentBaseUrl(agentStoreId))
      .securityContextId();
    return securityContextId
      ? { agentStoreId, project: projectRef.projectId, securityContextId }
      : undefined;
  });
  return {
    project: project as () => IProjectContext | undefined,
    ref,
    currentEnvironment,
    unsupported,
    context,
  };
}
