import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { readProjectApiQuery } from '../nav/project-api-routing';
import { projectPageHref } from '../nav/project-page-href';
import { IProjectRef } from '../core/project-context';
import { SessionWorkspaceService } from './session-workspace.service';
import { contextOpaqueId } from './session-context-contract';

/** Child source views are never instantiated until the session itself is admitted. */
export const admitSessionWorkspace: CanActivateChildFn = async (route) => {
  const workspace = inject(SessionWorkspaceService), router = inject(Router);
  const parameters = Object.assign({}, ...route.pathFromRoot.map((parent) => parent.params));
  const project: IProjectRef = {
    storeId: parameters['storeId'] ?? '', projectId: parameters['projectId'] ?? '',
    ...(parameters['spaceId'] ? { spaceID: parameters['spaceId'] } : {}),
    ...readProjectApiQuery(route.queryParamMap),
  };
  const chooser = () => {
    const tree = router.parseUrl(projectPageHref(project, 'sessions'));
    tree.queryParams = { ...route.queryParams };
    return tree;
  };
  const sessionId: unknown = parameters['sessionId'];
  if (!contextOpaqueId(sessionId)) return chooser();
  await workspace.openProject(project);
  await workspace.focus(sessionId);
  return workspace.snapshot()?.session.id === sessionId || chooser();
};
