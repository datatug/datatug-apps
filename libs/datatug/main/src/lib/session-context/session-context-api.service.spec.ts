import { HttpParams, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SneatApiService } from '@sneat/api';
import { of } from 'rxjs';
import { SessionContextApiService } from './session-context-api.service';
import { ContextCapabilities, ContextCommand, ContextReceipt } from './session-context-contract';

const localProject = { storeId: 'http-localhost:8989', projectId: 'chinook' };
const capabilities: ContextCapabilities = {
  schemaVersion: 1, actorId: 'local-principal', databaseId: 'ops-db', projectId: 'chinook', environments: [], actions: ['createSession'],
};
const command: ContextCommand = {
  opId: 'op_123', action: 'createSession', sessionId: 'session_123', bagId: 'bag_123',
  title: 'Imported context', scope: { environmentId: 'local', identityDomain: 'chinook-local' },
};
const receipt: ContextReceipt = {
  opId: command.opId, actor: 'actor', action: command.action, payloadDigest: 'digest',
  sessionId: command.sessionId, sessionVersion: 1, at: '2026-10-13T00:00:00.000Z',
};

describe('SessionContextApiService command wire boundary', () => {
  it('sends local selector and database identity only as query parameters', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), SessionContextApiService] });
    const service = TestBed.inject(SessionContextApiService);
    const http = TestBed.inject(HttpTestingController);
    const pending = service.command(localProject, capabilities, command);
    const request = http.expectOne((candidate) => candidate.url.endsWith('/session-context/commands'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ ...command, databaseId: 'ops-db', projectId: 'chinook' });
    expect(request.request.body).not.toHaveProperty('storage');
    expect(request.request.params.get('storage')).toBe('local');
    expect(request.request.params.get('project')).toBe('chinook');
    expect(request.request.params.get('databaseId')).toBe('ops-db');
    expect(request.request.params.get('projectId')).toBe('chinook');
    request.flush({ receipt });
    await expect(pending).resolves.toEqual(receipt);
    http.verify();
  });

  it('uses hosted API query options and keeps the strict command body selector-free', async () => {
    const post = vi.fn(() => of({ receipt }));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SessionContextApiService,
        { provide: SneatApiService, useValue: { post } }],
    });
    const service = TestBed.inject(SessionContextApiService);
    await expect(service.command({ storeId: 'firestore', projectId: 'chinook', spaceID: 'space_1' }, capabilities, command))
      .resolves.toEqual(receipt);
    expect(post).toHaveBeenCalledOnce();
    const [endpoint, body, options] = post.mock.calls[0] as unknown as [string, ContextCommand, { params: HttpParams }];
    expect(endpoint).toBe('datatug/session-context/commands');
    expect(body).toEqual({ ...command, databaseId: 'ops-db', projectId: 'chinook' });
    expect(body).not.toHaveProperty('storage');
    expect(body).not.toHaveProperty('spaceID');
    expect(options.params.get('storage')).toBe('firestore');
    expect(options.params.get('spaceID')).toBe('space_1');
    expect(options.params.get('project')).toBe('chinook');
    expect(options.params.get('databaseId')).toBe('ops-db');
    expect(options.params.get('projectId')).toBe('chinook');
  });

  it('imports legacy records with selectors in query and only the command binding in the body', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), SessionContextApiService] });
    const service = TestBed.inject(SessionContextApiService);
    const http = TestBed.inject(HttpTestingController);
    const importCommand: ContextCommand = {
      opId: 'op_import', action: 'importLegacy', sessionId: '', scope: { environmentId: 'local', identityDomain: 'local-actor' },
      legacyImport: { sourceId: 'legacy_0123456789abcdef', scope: { environmentId: 'local', identityDomain: 'local-actor' }, entries: [], messages: [{ id: 'legacy-chat-1', role: 'user', text: 'Find invoice 1' }] },
    };
    const expected: ContextReceipt = { ...receipt, opId: importCommand.opId, action: 'importLegacy', sessionId: 'session_imported' };
    const pending = service.command(localProject, capabilities, importCommand);
    const request = http.expectOne((candidate) => candidate.url.endsWith('/session-context/commands'));
    expect(request.request.body).toEqual({ opId: 'op_import', action: 'importLegacy', legacyImport: importCommand.legacyImport, databaseId: 'ops-db', projectId: 'chinook' });
    expect(request.request.body).not.toHaveProperty('sessionId');
    expect(request.request.body).not.toHaveProperty('scope');
    expect(request.request.params.get('storage')).toBe('local');
    expect(request.request.params.get('databaseId')).toBe('ops-db');
    expect(request.request.params.get('projectId')).toBe('chinook');
    request.flush({ receipt: expected });
    await expect(pending).resolves.toEqual(expected);
    http.verify();
  });

  it('reads the operation endpoint bare receipt before recovering an uncertain command', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), SessionContextApiService] });
    const service = TestBed.inject(SessionContextApiService);
    const http = TestBed.inject(HttpTestingController);
    const pending = service.operation(localProject, capabilities, command.opId);
    const request = http.expectOne((candidate) => candidate.url.endsWith(`/session-context/operations/${command.opId}`));
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('databaseId')).toBe('ops-db');
    request.flush(receipt);
    await expect(pending).resolves.toEqual(receipt);
    http.verify();
  });
});
