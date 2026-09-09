import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Firestore } from 'firebase/firestore';
import { of } from 'rxjs';

import { buildAgentUrl } from './agent-url';
import { DatatugStoreServiceFactory } from './datatug-store-service-factory.service';
import { DatatugStoreAgentService } from './datatug-store.service.agent';
import { DatatugStoreFirestoreService } from './datatug-store.service.firestore';
import { DatatugStoreGithubService } from './datatug-store.service.github';

describe('DatatugStoreServiceFactory', () => {
  let factory: DatatugStoreServiceFactory;
  let http: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { get: vi.fn(() => of({})) };
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: http },
        { provide: Firestore, useValue: {} },
      ],
    });
    factory = TestBed.inject(DatatugStoreServiceFactory);
  });

  it('returns the Firestore store service for "firestore"', () => {
    expect(factory.getDatatugStoreService('firestore')).toBe(
      TestBed.inject(DatatugStoreFirestoreService),
    );
  });

  it('returns the GitHub store service for "github.com" and "github"', () => {
    const github = TestBed.inject(DatatugStoreGithubService);
    expect(factory.getDatatugStoreService('github.com')).toBe(github);
    expect(factory.getDatatugStoreService('github')).toBe(github);
  });

  describe('local agent store ids', () => {
    // Every id form this app uses for a `datatug serve` agent: the bare
    // `host:port` the "connect" flow stores, the `http-`/`https-` form the
    // CLI prints as its web link (datatug-cli PR #198), and a configured
    // non-localhost host. Before this branch existed every one of them hit
    // `default: throw new Error('unknown store: ...')`, which blanked the
    // project page (see the ProjectPageComponent regression test).
    const agentStoreIds = [
      'localhost:8989',
      '127.0.0.1:8989',
      '192.168.1.10:8989',
      'http-localhost:8989',
      'https-agent.example.com:8443',
    ];

    it.each(agentStoreIds)(
      'returns an agent store service for %s instead of throwing',
      (storeId) => {
        expect(() => factory.getDatatugStoreService(storeId)).not.toThrow();
        expect(factory.getDatatugStoreService(storeId)).toBeInstanceOf(
          DatatugStoreAgentService,
        );
      },
    );

    it('reuses one service instance per agent store id', () => {
      const a = factory.getDatatugStoreService('localhost:8989');
      expect(factory.getDatatugStoreService('localhost:8989')).toBe(a);
      expect(factory.getDatatugStoreService('localhost:8990')).not.toBe(a);
    });

    it('watchProjectItem reports the item as absent (null) — the CLI agent has no folder/item read route yet', () => {
      const service = factory.getDatatugStoreService('localhost:8989');
      const next = vi.fn();
      const complete = vi.fn();
      service
        .watchProjectItem('datatug-demo-project', '/folders/~')
        .subscribe({ next, complete });
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(null);
      expect(complete).toHaveBeenCalled();
      expect(http.get).not.toHaveBeenCalled();
    });

    it('getProjectSummary GETs /datatug/projects/project_summary on that agent with the project id as the `id` query param', () => {
      const summary = { id: 'datatug-demo-project', title: 'Demo' };
      http.get.mockReturnValue(of(summary));
      const service = factory.getDatatugStoreService('http-localhost:8989');
      const next = vi.fn();
      service.getProjectSummary('datatug-demo-project').subscribe({ next });
      expect(http.get).toHaveBeenCalledWith(
        buildAgentUrl('http-localhost:8989', '/projects/project_summary'),
        { params: { id: 'datatug-demo-project' } },
      );
      expect(next).toHaveBeenCalledWith(summary);
    });
  });

  it('still throws for a store id that is neither a known store nor an agent', () => {
    expect(() => factory.getDatatugStoreService('gitlab.example.com')).toThrow(
      'unknown store: gitlab.example.com',
    );
  });
});
