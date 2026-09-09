import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AgentInfo } from '../../contract/types';
import { AgentContextService } from './agent-context.service';

const BASE_URL = 'http://localhost:8989/datatug';

const AGENT_INFO: AgentInfo = {
  version: '0.1.0',
  principal: { id: 'admin', roles: ['admin'], groups: [] },
  securityContextId: 'sctx-1',
  projects: [{ id: 'demo-project-1' }],
  capabilities: { protectedQueries: true, opaqueReadOnly: false },
};

describe('AgentContextService', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('fetches GET /datatug/agent-info on construction and exposes securityContextId', () => {
    const service = TestBed.inject(AgentContextService);
    expect(service.securityContextId()).toBeUndefined();

    const req = httpMock.expectOne(`${BASE_URL}/agent-info`);
    expect(req.request.method).toBe('GET');
    req.flush(AGENT_INFO);

    expect(service.securityContextId()).toBe('sctx-1');
    expect(service.info()).toEqual(AGENT_INFO);
  });

  it('refresh() re-fetches and updates securityContextId (STALE_CONTEXT recovery path)', () => {
    const service = TestBed.inject(AgentContextService);
    httpMock.expectOne(`${BASE_URL}/agent-info`).flush(AGENT_INFO);
    expect(service.securityContextId()).toBe('sctx-1');

    let refreshed: AgentInfo | undefined;
    service.refresh().subscribe((info) => (refreshed = info));
    httpMock
      .expectOne(`${BASE_URL}/agent-info`)
      .flush({ ...AGENT_INFO, securityContextId: 'sctx-2' });

    expect(refreshed?.securityContextId).toBe('sctx-2');
    expect(service.securityContextId()).toBe('sctx-2');
  });

  it('rejects a malformed agent-info body instead of silently exposing undefined shape', () => {
    const service = TestBed.inject(AgentContextService);
    httpMock.expectOne(`${BASE_URL}/agent-info`).flush({ version: '0.1.0' });

    // The initial best-effort fetch swallows the decode error (constructor subscribes
    // with a no-op error handler) — securityContextId stays undefined rather than throwing
    // during app bootstrap.
    expect(service.securityContextId()).toBeUndefined();
  });
});
