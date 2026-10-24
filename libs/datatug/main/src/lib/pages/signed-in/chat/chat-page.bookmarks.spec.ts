import { ProjectAIService } from '../../../chat/project-ai.service';
import { ManagedAIGatewayService } from '../../../chat/managed-ai-gateway.service';
import 'fake-indexeddb/auto';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { key } from '@dalgo/core';
import { IndexedDbDatabase } from '@dalgo/indexeddb';
import { SneatAuthStateService } from '@sneat/auth-core';
import { IDBFactory } from 'fake-indexeddb';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInterpretService } from '../../../chat/chat-interpret.service';
import { ChatJoinService } from '../../../chat/chat-join.service';
import { ChatProviderService, providerPresets } from '../../../chat/chat-provider.service';
import { CHAT_SESSION_DATABASE, ChatSessionService } from '../../../chat/chat-session.service';
import { ChatBookmark } from '../../../chat/chat-workspace';
import { ChinookChatDataService } from '../../../chat/chinook-chat-data.service';
import { ProjectAIEligibilityService } from '../../../services/project/project-ai-eligibility.service';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { ChatPageComponent } from './chat-page.component';

const scope = JSON.stringify(['store', 'datatug-demo-project']);
let fixture: ComponentFixture<ChatPageComponent>;

async function mount() {
  const database = new IndexedDbDatabase({
    name: 'bookmark-mutation-guard', version: 2, factory: new IDBFactory(),
    collections: ['ChatSessions', 'ChatTurns', 'ChatQueries', 'ChatRecordSets', 'ChatBookmarks'],
  });
  const params = convertToParamMap({ storeId: 'store', projectId: 'datatug-demo-project' });
  TestBed.configureTestingModule({
    imports: [ChatPageComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ProjectAIService, useValue: { workingCopies: () => [], context: vi.fn(async () => { throw new Error('No generic project context in legacy demo fixture'); }) } },
      { provide: ManagedAIGatewayService, useValue: { allowance: signal(undefined), usageState: signal('unavailable'), usageError: signal(undefined), reset: vi.fn() } },
      { provide: CHAT_SESSION_DATABASE, useValue: database },
      { provide: ActivatedRoute, useValue: {
        snapshot: { paramMap: params, queryParamMap: convertToParamMap({}) },
        paramMap: new BehaviorSubject(params), queryParamMap: of(convertToParamMap({})),
      } },
      { provide: SneatAuthStateService, useValue: { authState: of({ status: 'authenticated', user: { uid: 'actor' } }) } },
      { provide: ChinookChatDataService, useValue: { ensureSeed: vi.fn(async () => undefined) } },
      { provide: ChatInterpretService, useValue: {} },
      { provide: ChatJoinService, useValue: { candidates: () => [] } },
      { provide: ProjectAIEligibilityService, useValue: { read: () => of({ aiAllowed: true }) } },
      { provide: DatatugNavContextService, useValue: { currentProject: of(undefined) } },
      { provide: ChatProviderService, useValue: {
        providers: signal([]), selectedId: signal('legacy'), preset: (name: string) => providerPresets[name],
      } },
    ],
  }).overrideComponent(ChatPageComponent, {
    set: { imports: [DecimalPipe, NgTemplateOutlet], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  fixture = TestBed.createComponent(ChatPageComponent);
  const component = fixture.componentInstance;
  await vi.waitFor(() => expect(component.sessionState()).toBe('ready'));
  const bookmark: ChatBookmark = {
    id: 'bookmark', scope, projectId: 'datatug-demo-project', title: 'Show 10 customers', tags: ['seed'],
    target: 'recordset', recordSet: { id: 'result', source: `${scope}/chinook`, columns: [], rows: [] },
    createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
  };
  await database.runReadwriteTransaction((tx) => tx.insert(key('ChatBookmarks', bookmark.id), bookmark));
  await component.workspaceAction({ kind: 'setTab', tab: 'bookmarks' });
  await fixture.whenStable();
  const mutationButtons = () => Array.from((fixture.nativeElement as HTMLElement)
    .querySelectorAll<HTMLButtonElement>('.bookmark-item ion-button'))
    .filter((button) => button.textContent?.trim() !== 'Open');
  return { component, bookmark, database, service: TestBed.inject(ChatSessionService), mutationButtons };
}

beforeEach(() => {
  vi.stubGlobal('prompt', vi.fn());
  vi.stubGlobal('confirm', vi.fn());
});

afterEach(() => {
  fixture?.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
});

describe('bookmark mutation admission', () => {
  it('blocks Tag during a deferred save, then retains both normalized tags in storage and the rendered list', async () => {
    const { component, bookmark, database, service, mutationButtons } = await mount();
    let finish!: () => void;
    const saving = new Promise<void>((resolve) => { finish = resolve; });
    const persist = service.workspaceAction.bind(service);
    vi.spyOn(service, 'workspaceAction').mockImplementationOnce(async (...args) => {
      await saving;
      return persist(...args);
    });
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce(' ROCK ').mockReturnValueOnce(' LIVE ');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.addBookmarkTag(bookmark);
    await fixture.whenStable();
    try {
      expect(component.sessionBusy()).toBe(true);
      expect(mutationButtons()).toHaveLength(6);
      expect(mutationButtons().every((button) => button.disabled)).toBe(true);
      component.addBookmarkTag(bookmark);
      component.renameBookmark(bookmark);
      component.deleteBookmark(bookmark);
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      finish();
    }
    await vi.waitFor(() => expect(component.sessionBusy()).toBe(false));
    await fixture.whenStable();
    expect(mutationButtons().every((button) => !button.disabled)).toBe(true);
    expect(component.bookmarks()[0].tags).toEqual(['seed', 'rock']);
    component.addBookmarkTag(component.bookmarks()[0]);
    await vi.waitFor(() => expect(component.sessionBusy()).toBe(false));
    await fixture.whenStable();
    const stored = await database.get<ChatBookmark>(key('ChatBookmarks', bookmark.id));
    expect(stored.exists && stored.data.tags).toEqual(['seed', 'rock', 'live']);
    expect(component.bookmarks()[0].tags).toEqual(['seed', 'rock', 'live']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('live ×');
    component.bookmarkTags.set('ROCK,live');
    await component.refreshBookmarks();
    expect(component.bookmarks()).toHaveLength(1);
  });

  it.each(['submitting', 'loading', 'error'] as const)('blocks all six controls and prompts while %s', async (state) => {
    const { component, bookmark, mutationButtons } = await mount();
    const prompt = vi.spyOn(window, 'prompt');
    const confirm = vi.spyOn(window, 'confirm');
    if (state === 'submitting') component.submitting.set(true);
    else component.sessionState.set(state);
    await fixture.whenStable();
    expect(mutationButtons()).toHaveLength(6);
    expect(mutationButtons().every((button) => button.disabled)).toBe(true);
    component.addBookmarkTag(bookmark);
    component.renameBookmark(bookmark);
    component.deleteBookmark(bookmark);
    expect(prompt).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});
