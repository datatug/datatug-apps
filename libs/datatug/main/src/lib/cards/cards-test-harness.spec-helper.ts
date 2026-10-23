import { CUSTOM_ELEMENTS_SCHEMA, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AgentContextService } from '@sneat/datatug-semantic';
import { BehaviorSubject, of } from 'rxjs';
import type { IProjectRef } from '../core/project-context';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { ProjectCardsService } from './project-cards.service';

/**
 * Shared test wiring of the cards pages: the page's real template over
 * stubbed project context, router and card service. Child components are
 * replaced by the CUSTOM_ELEMENTS_SCHEMA, so assertions read the page's own DOM.
 */
export const demoRef: IProjectRef = {
  storeId: 'localhost:8989',
  projectId: 'demo',
};

export interface CardsHarness {
  project: BehaviorSubject<unknown>;
  service: Record<string, ReturnType<typeof vi.fn>>;
  router: { navigateByUrl: ReturnType<typeof vi.fn>; parseUrl: ReturnType<typeof vi.fn> };
  route: { snapshot: { data: Record<string, unknown>; paramMap: unknown; queryParamMap: unknown }; paramMap: BehaviorSubject<unknown>; queryParamMap: BehaviorSubject<unknown> };
}

export function configureCardsPage<T>(
  page: Type<T>,
  options: {
    ref?: IProjectRef | undefined;
    canWrite?: boolean;
    canDelete?: boolean;
    data?: Record<string, unknown>;
    params?: Record<string, string>;
    query?: Record<string, string>;
    service?: Record<string, unknown>;
    extraProviders?: unknown[];
    imports?: unknown[];
  } = {},
): CardsHarness {
  const params = convertToParamMap(options.params ?? {});
  const query = convertToParamMap(options.query ?? {});
  const route = {
    snapshot: { data: options.data ?? {}, paramMap: params, queryParamMap: query },
    paramMap: new BehaviorSubject(params),
    queryParamMap: new BehaviorSubject(query),
  };
  const project = new BehaviorSubject<unknown>(
    options.ref === undefined && 'ref' in options
      ? undefined
      : { ref: options.ref ?? demoRef },
  );
  const router = {
    navigateByUrl: vi.fn(() => Promise.resolve(true)),
    parseUrl: vi.fn((url: string) => ({ url, queryParams: {} as Record<string, string> })),
  };
  const service = {
    canWrite: vi.fn(() => options.canWrite ?? true),
    canDelete: vi.fn(() => options.canDelete ?? true),
    listCards: vi.fn(() => of([])),
    getCard: vi.fn(),
    createCard: vi.fn(),
    saveCard: vi.fn(),
    deleteCard: vi.fn(),
    invalidate: vi.fn(),
    ...(options.service as object),
  } as CardsHarness['service'];
  TestBed.configureTestingModule({
    providers: [
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: router },
      {
        provide: DatatugNavContextService,
        useValue: {
          currentProject: project,
          currentEnv: of(undefined),
        },
      },
      { provide: ProjectCardsService, useValue: service },
      { provide: AgentContextService, useValue: { contextFor: vi.fn() } },
      ...((options.extraProviders as never[]) ?? []),
    ],
  });
  TestBed.overrideComponent(page, {
    set: {
      imports: (options.imports as never[]) ?? [],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    },
  });
  return { project, service, router, route } as CardsHarness;
}

/**
 * The text of an element tree, read leaf element by leaf element:
 * `textContent` of a hydrated Ionic container can come back empty once Stencil
 * has relocated its slotted content.
 */
export function allText(node: Element): string {
  return [
    ...node.querySelectorAll(
      'h1,h2,h3,h4,p,span,strong,code,small,ion-chip,ion-note,ion-button,ion-label,ion-title,button,label,summary,li,legend,a',
    ),
  ]
    .map((e) => e.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ');
}
