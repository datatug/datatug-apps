import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { ChatInterpretService } from '../../../chat/chat-interpret.service';
import { ChatJoinService } from '../../../chat/chat-join.service';
import { ChatProviderService } from '../../../chat/chat-provider.service';
import { ChatSessionService } from '../../../chat/chat-session.service';
import { ChatTurn } from '../../../chat/chat.types';
import { emptyChatWorkspace } from '../../../chat/chat-workspace';
import { ChinookChatDataService } from '../../../chat/chinook-chat-data.service';
import { ChatPageComponent } from './chat-page.component';

const engineError = 'join_aggregate at orderBy[0]: c.Country is neither aggregated nor present in GROUP BY';
const session = { id: 's1', title: 'Chat', updatedAt: '2026-10-02T00:00:00Z', workspace: emptyChatWorkspace() };
const failedTurn: ChatTurn = { id: 'old', question: 'Sales by country?', state: 'error', error: engineError };

describe('ChatPageComponent failed turns', () => {
  let fixture: ComponentFixture<ChatPageComponent>;
  let restored: ChatTurn[];
  const store = {
    list: vi.fn(async () => [session]),
    create: vi.fn(async () => session),
    load: vi.fn(async () => ({ session, turns: restored })),
    listBookmarks: vi.fn(async () => []),
    context: vi.fn(() => ''),
    appendQuestion: vi.fn(async (_scope: string, _session: string, question: string): Promise<ChatTurn> => ({ id: 'new', question, state: 'loading' })),
    bindRecordSet: vi.fn(async (_scope: string, _session: string, dtql: string) => ({ dtql, parentRecordSetId: undefined })),
    failQuestion: vi.fn(async (_scope: string, _session: string, id: string, message: string): Promise<ChatTurn> =>
      ({ id, question: 'Sales by country?', state: 'error', error: message })),
  };
  const data = { ensureSeed: vi.fn(async () => undefined), query: vi.fn() };
  const joiner = { candidates: vi.fn((): unknown[] => []) };
  const interpreter = { interpret: vi.fn(async () => ({ dtql: '{}', metrics: { requestBytes: 0, responseBytes: 0, interpretMs: 0 } })) };

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const details = (): HTMLDetailsElement | null => (fixture.nativeElement as HTMLElement).querySelector('details.error-detail');

  async function render(turns: ChatTurn[]): Promise<void> {
    restored = turns;
    const paramMap = convertToParamMap({ storeId: 'store', projectId: 'datatug-demo-project' });
    TestBed.configureTestingModule({
      imports: [ChatPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap }, paramMap: { subscribe: () => undefined } } },
        { provide: ChatSessionService, useValue: store },
        { provide: ChinookChatDataService, useValue: data },
        { provide: ChatInterpretService, useValue: interpreter },
        { provide: ChatJoinService, useValue: joiner },
        {
          provide: ChatProviderService,
          useValue: { providers: signal([{ id: 'p1', name: 'Test', protocol: 'openai-chat', baseUrl: 'https://ai.example.test', model: 'm', apiKey: 'k' }]), selectedId: signal('p1') },
        },
      ],
    }).overrideComponent(ChatPageComponent, {
      set: { imports: [DecimalPipe, NgTemplateOutlet], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    fixture = TestBed.createComponent(ChatPageComponent);
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    joiner.candidates.mockImplementation(() => []);
  });

  it('shows a saved engine failure in plain language, with the engine text behind an expandable detail', async () => {
    await render([failedTurn]);
    expect(text()).toMatch(/needs totals or counts/);
    expect(details()).not.toBeNull();
    expect(details()?.open).toBe(false);
    expect(details()?.querySelector('summary')?.textContent).toContain('Technical details');
    expect(details()?.querySelector('pre')?.textContent).toBe(engineError);
    // The raw text is only inside the collapsed detail, never the headline.
    const headline = (fixture.nativeElement as HTMLElement).querySelector('.turn-error ion-text')?.textContent ?? '';
    expect(headline).not.toContain('join_aggregate');
  });

  it('shows an already plain message as it is, with no technical detail', async () => {
    await render([{ ...failedTurn, error: 'The AI provider rejected the request (HTTP 401).' }]);
    expect(text()).toContain('The AI provider rejected the request (HTTP 401).');
    expect(details()).toBeNull();
  });

  it('keeps the engine message on the stored turn and shows the friendly text when a question fails', async () => {
    data.query.mockRejectedValue(new TypeError(engineError));
    await render([]);
    const component = fixture.componentInstance;
    component.question.set('Sales by country?');
    await component.submit();
    await fixture.whenStable();
    expect(store.failQuestion).toHaveBeenCalledWith(expect.any(String), 's1', 'new', engineError, undefined);
    expect(text()).toMatch(/needs totals or counts/);
    expect(details()?.querySelector('pre')?.textContent).toBe(engineError);
  });

  describe('when the related tables cannot be built for a saved result', () => {
    const result: ChatTurn = { id: 'r1', question: 'Customers?', state: 'result', recordSetId: 'rs1', dtql: '{}', rows: [{ CustomerId: 1 }] };
    const relatedError = (): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector('.join-candidates .turn-error');

    it('explains an engine error in plain language, with the engine text behind an expandable detail', async () => {
      const raw = 'join_scope at from.joins[0].on[0].left: forward alias c';
      joiner.candidates.mockImplementation(() => { throw new Error(raw); });
      await render([result]);
      expect(relatedError()?.querySelector('ion-text')?.textContent).toMatch(/table or column that is not available/);
      expect(relatedError()?.querySelector('ion-text')?.textContent).not.toContain('join_scope');
      expect(relatedError()?.querySelector('details.error-detail summary')?.textContent).toContain('Technical details');
      expect(relatedError()?.querySelector('details.error-detail pre')?.textContent).toBe(raw);
      expect(text()).not.toContain('No further foreign-key relationships');
    });

    it('shows an already plain failure as it is, with no technical detail', async () => {
      joiner.candidates.mockImplementation(() => { throw 'not an Error'; });
      await render([result]);
      expect(relatedError()?.querySelector('ion-text')?.textContent).toContain('The saved query cannot be read with the current schema.');
      expect(relatedError()?.querySelector('details')).toBeNull();
    });
  });
});
