import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearAgentSessionTokenForTest,
  consumeAgentSessionFragment,
} from './agent-session';
import {
  loopbackAgentOrigin,
  OpenVaultDBAgentService,
} from './openvaultdb-agent.service';

describe('OpenVaultDBAgentService', () => {
  let service: OpenVaultDBAgentService;
  let http: HttpTestingController;

  beforeEach(() => {
    clearAgentSessionTokenForTest();
    consumeAgentSessionFragment(
      {
        hash: '#agentToken=abcdefghijklmnopqrstuvwxyzABCDEFG_123456',
        pathname: '/',
        search: '',
      } as Location,
      { state: null, replaceState: () => undefined } as unknown as History,
    );
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OpenVaultDBAgentService);
    http = TestBed.inject(HttpTestingController);
  });

  it('sends the capability only to a validated loopback daemon', () => {
    service
      .query('localhost:8989', 'crm', 'from: {name: customers}')
      .subscribe();
    const request = http.expectOne('http://localhost:8989/datatug/ovdb/query');
    expect(request.request.headers.get('X-Datatug-Agent-Token')).toBe(
      'abcdefghijklmnopqrstuvwxyzABCDEFG_123456',
    );
    expect(request.request.body).toEqual({
      target: 'crm',
      dtql: 'from: {name: customers}',
    });
    request.flush({ records: [] });
  });

  it('wraps a normalized update without exposing upstream configuration', () => {
    const operation = {
      id: 'u1',
      action: 'update',
      resource: { databaseId: 'crm', path: '/customers/1' },
    };
    service.update('localhost:8989', 'crm-target', operation).subscribe();
    const request = http.expectOne('http://localhost:8989/datatug/ovdb/update');
    expect(request.request.body).toEqual({
      target: 'crm-target',
      request: operation,
    });
    expect(JSON.stringify(request.request.body)).not.toContain('bearer');
    request.flush({ authorization: {}, dataRevision: 'r2' });
  });

  it('never sends the capability to a route-selected remote origin', () => {
    let message = '';
    service.targets('evil.example').subscribe({
      error: (error: Error) => (message = error.message),
    });
    http.expectNone(() => true);
    expect(message).toContain('unavailable');
  });

  it('accepts only loopback agent origins', () => {
    expect(loopbackAgentOrigin('127.0.0.1:8989')).toBe('http://127.0.0.1:8989');
    expect(loopbackAgentOrigin('[::1]:8989')).toBe('http://[::1]:8989');
    expect(loopbackAgentOrigin('localhost:8989@evil.example')).toBeUndefined();
    expect(loopbackAgentOrigin('localhost:8989/path')).toBeUndefined();
  });
});
