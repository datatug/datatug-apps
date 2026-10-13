import { TestBed } from '@angular/core/testing';
import { ChatSessionService } from '../chat/chat-session.service';
import { InvestigationStorage } from '../chat/investigation/investigation-storage';
import { agentBaseUrl } from '../services/repo/agent-url';
import { IProjectRef } from '../core/project-context';
import { ContextCapabilities, SessionScope } from './session-context-contract';
import { LegacyContextImportService } from './legacy-context-import.service';

const project: IProjectRef = { storeId: 'http-localhost:8989', projectId: 'chinook' };
const scope: SessionScope = { environmentId: 'local', identityDomain: 'local-principal' };
const capabilities: ContextCapabilities = {
  schemaVersion: 1, actorId: 'local-principal', databaseId: 'ops', projectId: 'chinook', environments: [scope], actions: ['importLegacy'],
  subjects: [{ id: 'invoice-id', label: 'Invoice ID', subject: { conceptId: 'Invoice', fieldId: 'InvoiceId', fieldMappingRef: 'invoice-key' }, scope, type: 'integer', shape: 'scalar' }],
};
const admittedSubject = capabilities.subjects?.[0]?.subject;
const legacyKey = `${'datatug.investigationContext.v2.'}${[agentBaseUrl(project.storeId), project.projectId, scope.environmentId, scope.identityDomain].join('\u0000')}`;

describe('LegacyContextImportService', () => {
  let service: LegacyContextImportService;
  let chatSessions: { list: ReturnType<typeof vi.fn>; importTranscript: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    sessionStorage.clear();
    chatSessions = { list: vi.fn(async () => []), importTranscript: vi.fn() };
    TestBed.configureTestingModule({ providers: [LegacyContextImportService,
      { provide: ChatSessionService, useValue: chatSessions },
      { provide: InvestigationStorage, useValue: { sessions: async () => undefined } },
    ] });
    service = TestBed.inject(LegacyContextImportService);
  });

  it('previews typed legacy context without exposing values and blocks unsupported operators', async () => {
    if (!admittedSubject) throw new Error('The test subject fixture is missing.');
    const original = JSON.stringify([
      { id: 'invoice-1', entity: 'Invoice', field: 'InvoiceId', value: { type: 'integer', value: '1' }, origin: 'selection', enabled: true, label: 'Invoice 1' },
      { id: 'invoice-2', entity: 'Invoice', field: 'InvoiceId', value: { type: 'string', value: 'inv%' }, condition: 'like', origin: 'manual', enabled: true, label: 'Invoice pattern' },
    ]);
    sessionStorage.setItem(legacyKey, original);
    const preview = await service.preview(project, capabilities, scope);
    expect(preview.entries[0]).toMatchObject({ label: 'Invoice 1', valueLabel: 'integer value', subject: admittedSubject });
    expect(preview.entries[0].valueLabel).toBe('integer value');
    expect(preview.entries[1].blockedReason).toContain('like condition');
    expect(sessionStorage.getItem(legacyKey)).toBe(original);
    const payload = await service.createPayload(project, capabilities, scope, preview, [], true);
    expect(payload.entries).toEqual([{ id: 'legacy-fact-0', alias: 'Invoice 1', subject: admittedSubject, value: { schemaVersion: 1, kind: 'scalar', scalar: { type: 'integer', value: '1' } } }]);
    expect(payload.sourceId).not.toContain('Invoice 1');
  });

  it('imports only bounded user-question text from selected browser conversations', async () => {
    chatSessions.list.mockResolvedValue([{ id: 'chat1', title: 'Invoice chat', createdAt: '2026-10-12T10:00:00.000Z' }]);
    chatSessions.importTranscript.mockResolvedValue({
      session: { id: 'chat1', title: 'Invoice chat', createdAt: '2026-10-12T10:00:00.000Z' },
      messages: [{ id: 'turn1', text: 'Find invoice 1', createdAt: '2026-10-12T10:01:00.000Z' }], omittedCount: 1,
    });
    const preview = await service.preview(project, capabilities, scope);
    expect(chatSessions.importTranscript).toHaveBeenCalledWith(JSON.stringify([project.storeId, project.projectId]), 'chat1', 1000, 100_000);
    expect(preview.conversations[0]).toMatchObject({ messages: [{ id: 'legacy-chat-chat1-turn1', role: 'user', text: 'Find invoice 1' }], omittedCount: 1 });
    const payload = await service.createPayload(project, capabilities, scope, preview, ['chat-chat1'], false);
    expect(payload.entries).toEqual([]);
    expect(payload.messages).toEqual([{ id: 'legacy-chat-chat1-turn1', role: 'user', text: 'Find invoice 1', createdAt: '2026-10-12T10:01:00.000Z' }]);
    expect(payload.sourceId).not.toContain('Find invoice 1');
  });
});
