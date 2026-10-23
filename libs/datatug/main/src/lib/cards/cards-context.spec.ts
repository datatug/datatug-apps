import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AgentContextService } from '@sneat/datatug-semantic';
import { BehaviorSubject, of } from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { cardRunContext, injectCardsContext } from './cards-context';
import { ProjectCardsService } from './project-cards.service';

describe('cardRunContext', () => {
  const agent = {
    contextFor: vi.fn(() => ({ securityContextId: () => 'sec-1' })),
  } as never;

  it('runs against the local agent with its security context', () => {
    expect(
      cardRunContext({ storeId: 'localhost:8989', projectId: 'demo', projectApi: 'local' }, 'LOCAL', agent),
    ).toEqual({
      mode: 'view',
      parameters: {},
      environment: 'LOCAL',
      securityContextId: 'sec-1',
      executionTarget: { kind: 'local-agent', agentStoreId: 'localhost:8989' },
    });
  });
  it('runs in the cloud for a hosted project and plainly otherwise', () => {
    expect(
      cardRunContext({ storeId: 'firestore', spaceID: 's', projectId: 'p' }, 'demo', agent)
        .executionTarget,
    ).toEqual({ kind: 'hosted-cloud' });
    const github = cardRunContext({ storeId: 'github.com', projectId: 'x@y@', projectApi: 'local' }, undefined, agent);
    expect(github).toEqual({ mode: 'view', parameters: {} });
    expect(cardRunContext(undefined, undefined, null)).toEqual({ mode: 'view', parameters: {} });
  });
});

describe('injectCardsContext', () => {
  function setup(query: Record<string, string>, ref: object | undefined, env?: string) {
    const params = convertToParamMap(query);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: new BehaviorSubject(ref ? { ref } : undefined),
            currentEnv: of(env ? { id: env } : undefined),
          },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params }, queryParamMap: of(params) } },
        { provide: Router, useValue: { parseUrl: (u: string) => ({ url: u, queryParams: {} }) } },
        { provide: AgentContextService, useValue: { contextFor: vi.fn() } },
        {
          provide: ProjectCardsService,
          useValue: { canWrite: vi.fn(() => true), canDelete: vi.fn(() => false) },
        },
      ],
    });
    return TestBed.runInInjectionContext(() => injectCardsContext());
  }

  it('reads permissions from the card service and builds project page addresses', () => {
    const ctx = setup({}, { storeId: 'localhost:8989', projectId: 'demo' }, 'LOCAL');
    expect(ctx.canWrite()).toBe(true);
    expect(ctx.canDelete()).toBe(false);
    expect(ctx.environment()).toBe('LOCAL');
    expect(ctx.hosted()).toBe(false);
    expect(ctx.needsEnvironment()).toBe(false);
    expect((ctx.url(['card', 'customer']) as never as { url: string }).url).toContain('/card/customer');
    expect(ctx.href('cards')).toContain('/cards');
  });

  it('needs an environment for a shared project, from the address or the current environment', () => {
    const shared = { storeId: 'firestore', spaceID: 's', projectId: 'p' };
    const none = setup({}, shared);
    expect(none.hosted()).toBe(true);
    expect(none.needsEnvironment()).toBe(true);
    TestBed.resetTestingModule();
    const query = setup({ environment: 'demo' }, shared);
    expect(query.environment()).toBe('demo');
    expect(query.needsEnvironment()).toBe(false);
    expect((query.url(['cards']) as never as { queryParams: object }).queryParams).toEqual({ environment: 'demo' });
  });

  it('has nothing to link to without a project', () => {
    const ctx = setup({}, undefined);
    expect(ctx.ref()).toBeUndefined();
    expect(ctx.canWrite()).toBe(false);
    expect(ctx.url(['cards'])).toBeUndefined();
    expect(ctx.href('cards')).toBe('/');
  });
});
