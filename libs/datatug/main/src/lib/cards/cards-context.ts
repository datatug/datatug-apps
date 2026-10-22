import { computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, UrlTree } from '@angular/router';
import { IProjectRef, isSharedProjectRef } from '../core/project-context';
import { IProjectContext } from '../nav/nav-models';
import { projectPageHref } from '../nav/project-page-href';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { AgentContextService } from '@sneat/datatug-semantic';
import type { IBoardContext } from '../models/definition/board/board';
import { agentBaseUrl } from '../services/repo/agent-url';
import { ProjectCardsService } from './project-cards.service';

/** Where and as whom a card's saved queries run, the way a board page decides it. */
export function cardRunContext(
  ref: IProjectRef | undefined,
  environment: string | undefined,
  agent: Pick<AgentContextService, 'contextFor'> | null,
): IBoardContext {
  const local =
    ref?.projectApi === 'local' &&
    !['github', 'github.com', 'firestore'].includes(ref.storeId);
  const hosted = ref?.storeId === 'firestore' && !!ref.spaceID;
  return {
    mode: 'view',
    parameters: {},
    ...(environment ? { environment } : {}),
    ...(local && ref && agent
      ? {
          securityContextId: agent
            .contextFor(agentBaseUrl(ref.storeId))
            .securityContextId(),
          executionTarget: {
            kind: 'local-agent' as const,
            agentStoreId: ref.storeId,
          },
        }
      : hosted
        ? { executionTarget: { kind: 'hosted-cloud' as const } }
        : {}),
  };
}

export interface CardsContext {
  readonly project: Signal<IProjectContext | undefined>;
  readonly ref: Signal<IProjectRef | undefined>;
  /** The environment cards are read and written in; required for shared (hosted) projects. */
  readonly environment: Signal<string | undefined>;
  readonly hosted: Signal<boolean>;
  readonly needsEnvironment: Signal<boolean>;
  readonly canWrite: Signal<boolean>;
  readonly canDelete: Signal<boolean>;
  /** Execution context for running a card's queries in this project and environment. */
  readonly runContext: Signal<IBoardContext>;
  /** Address of a cards page of this project (`['cards']`, `['cards','new']`, `['card', id]`). */
  url(page: string[]): UrlTree | undefined;
  /** Same address as plain text, for `href`/back buttons. */
  href(page: string): string;
}

/**
 * The project, environment and permissions the cards pages share. Call in an
 * injection context (a component field initialiser).
 */
export function injectCardsContext(): CardsContext {
  const nav = inject(DatatugNavContextService);
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const cards = inject(ProjectCardsService);
  const agent = inject(AgentContextService, { optional: true });
  const project = toSignal(nav.currentProject, { initialValue: undefined });
  const currentEnv = toSignal(nav.currentEnv, { initialValue: undefined });
  const query = toSignal(route.queryParamMap, {
    initialValue: route.snapshot.queryParamMap,
  });
  const ref = computed(() => project()?.ref);
  const hosted = computed(() => {
    const r = ref();
    return !!r && isSharedProjectRef(r);
  });
  const environment = computed(
    () => query().get('environment') || currentEnv()?.id || undefined,
  );
  return {
    project,
    ref,
    environment,
    hosted,
    runContext: computed(() => cardRunContext(ref(), environment(), agent)),
    needsEnvironment: computed(() => hosted() && !environment()),
    canWrite: computed(() => {
      const r = ref();
      return !!r && cards.canWrite(r);
    }),
    canDelete: computed(() => {
      const r = ref();
      return !!r && cards.canDelete(r);
    }),
    url(page: string[]): UrlTree | undefined {
      const r = ref();
      if (!r) return undefined;
      const href = projectPageHref(r, page);
      if (href === '/') return undefined;
      const tree = router.parseUrl(href);
      if (hosted() && environment())
        tree.queryParams = { ...tree.queryParams, environment: environment() };
      return tree;
    },
    href(page: string): string {
      const r = ref();
      return r ? projectPageHref(r, page) : '/';
    },
  };
}
