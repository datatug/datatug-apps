import { DestroyRef, Injector, inject } from '@angular/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { IProjectRef, equalProjectRef } from '../core/project-context';
import { Subject, Subscription } from 'rxjs';
/** Synchronous cancellation only. Current server checks remain authoritative.
 * Attach only for a native hosted run: public/GitHub renderers do not acquire
 * private project/auth services just because they share a canonical component. */
export function useNativeRunLifetime() {
  const injector = inject(Injector),
    destroy = inject(DestroyRef);
  let actor = '',
    project: IProjectRef | undefined,
    controller = new AbortController(),
    attached = false,
    initializing = false;
  const changes = new Subject<void>(),
    subscriptions = new Subscription();
  const invalidate = () => {
    controller.abort();
    controller = new AbortController();
    if (!initializing) changes.next();
  };
  const attach = () => {
    if (attached) return;
    if (destroy.destroyed) throw new Error('The run owner was destroyed.');
    const auth = injector.get(SneatAuthStateService),
      navigation = injector.get(DatatugNavContextService);
    attached = true;
    initializing = true;
    try {
      subscriptions.add(
        auth.authState.subscribe((state) => {
          const next =
            state.status === 'authenticated' ? state.user?.uid || '' : '';
          if (actor !== next) {
            actor = next;
            invalidate();
          }
        }),
      );
      subscriptions.add(
        navigation.currentProject.subscribe((value) => {
          if (!equalProjectRef(project, value?.ref)) {
            project = value?.ref;
            invalidate();
          }
        }),
      );
    } finally {
      initializing = false;
    }
  };
  destroy.onDestroy(() => {
    controller.abort();
    subscriptions.unsubscribe();
    changes.next();
    changes.complete();
  });
  return {
    changes$: changes.asObservable(),
    invalidate,
    actor: () => {
      attach();
      return actor;
    },
    capture: (ref: IProjectRef, expectedActor?: string) => {
      attach();
      if (
        destroy.destroyed ||
        !actor ||
        !equalProjectRef(ref, project) ||
        (expectedActor !== undefined && actor !== expectedActor)
      )
        throw new Error(
          'The current signed-in project scope changed. Review the run before dispatch.',
        );
      return { actor, signal: controller.signal };
    },
  };
}
