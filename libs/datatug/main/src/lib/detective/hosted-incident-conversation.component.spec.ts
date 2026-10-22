import { SOURCE_EVIDENCE_PRESENTERS } from '../evidence/source-evidence-presentation';
import { shippingEvidencePresenter } from '../shipping/shipping-evidence-presenter';
import { AgentContextService } from '@sneat/datatug-semantic';
import criterionFixture from './testdata/backend-criterion-v069.json';
import type {
  AppliedEvidenceChoice,
  AppliedEvidenceRequest,
} from '../evidence/applied-evidence';
import { SneatAuthStateService } from '@sneat/auth-core';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { DetectiveClientService } from './detective-client.service';
import { HostedIncidentConversationComponent } from './hosted-incident-conversation.component';
import { IncidentEvent } from '../incidents/models';
import { HostedIncidentEvents } from './hosted-linkage.models';

import sourceOperationFixture from '../evidence/testdata/source-operation.facade.go.json';
const context = {
  kind: 'cloud' as const,
  storage: 'firestore' as const,
  spaceID: 'space',
  project: 'training',
  principal: 'sarah',
};
const incidentRef = { storeId: 'incidents-scope', incidentId: 'INC-1' };
const message = (seq = 2): IncidentEvent => ({
  id: `event-${seq}`,
  seq,
  at: '2026-10-21T12:00:00Z',
  visibleAt: '2026-10-21T12:00:00Z',
  incident: incidentRef,
  actor: { kind: 'human', id: 'sarah', via: 'web' },
  type: 'note.added',
  assertion: { kind: 'claim' },
  payload: { body: 'Received, but no assignment.' },
});
type Page = {
  criterionChoice: { set(v: AppliedEvidenceChoice): void };
  criterionCheckID: { set(v: string): void };
  criterionOpen: { set(v: boolean): void };
  finalizeReview: { set(v: boolean): void };
  saveCriterion(): Promise<void>;
  finalizeCriterion(): Promise<void>;
  retryCriterion(): Promise<void>;
  body: { set(v: string): void };
  send(): Promise<void>;
  refresh(): void;
  loadMore(): void;
  reviewConflict(): Promise<void>;
  reviewPending(): Promise<void>;
  keepPendingRetry(): void;
  abandonPending(): void;
  checkID: { set(v: string): void };
};

describe('HostedIncidentConversationComponent', () => {
  const client = {
    projectIncident: vi.fn(),
    incidentEvents: vi.fn(),
    incidentAction: vi.fn(),
  };
  let history: HostedIncidentEvents;
  let sequence: number;
  async function mount() {
    await TestBed.configureTestingModule({
      imports: [HostedIncidentConversationComponent],
      providers: [
        {
          provide: SOURCE_EVIDENCE_PRESENTERS,
          useValue: [shippingEvidencePresenter],
        },
        provideRouter([]),
        { provide: AgentContextService, useValue: {} },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: new BehaviorSubject({
              status: 'authenticated',
              user: { uid: 'sarah' },
            }),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentEnv: of(undefined),
            currentProject: new BehaviorSubject({
              ref: {
                storeId: 'firestore',
                spaceID: 'space',
                projectId: 'training',
              },
            }),
          },
        },
        { provide: DetectiveClientService, useValue: client },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(
      HostedIncidentConversationComponent,
    );
    fixture.componentRef.setInput('context', context);
    fixture.componentRef.setInput('environment', 'demo');
    fixture.componentRef.setInput('incidentRef', incidentRef);
    fixture.componentRef.setInput('canWrite', true);
    fixture.componentRef.setInput('checks', [
      { id: 'assignment', title: 'Carrier assignment', version: 1 },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    sequence = 1;
    history = { events: [], nextAfterSeq: 1, hasMore: false };
    client.projectIncident.mockImplementation(() =>
      of({ incident: { ref: incidentRef, lastSeq: sequence } }),
    );
    client.incidentEvents.mockImplementation(() => of(history));
    client.incidentAction.mockImplementation(() => {
      sequence = 2;
      history = { events: [message()], nextAfterSeq: 2, hasMore: false };
      return of({
        event: message(),
        incident: { ref: incidentRef, lastSeq: sequence },
        receipt: 'saved',
      });
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });
  const page = (f: ComponentFixture<HostedIncidentConversationComponent>) =>
    f.componentInstance as unknown as Page;
  it('offers typed current-account source receipt opening from cold Incident history without a fabricated URL or cross-account opener', async () => {
    const reference = {
      ...sourceOperationFixture.request.reference,
      spaceID: context.spaceID,
      projectId: context.project,
      receiptActorId: context.principal,
    };
    history = {
      events: [
        {
          ...message(2),
          refs: [{ kind: 'source-operation', sourceOperation: reference }],
        },
        {
          ...message(3),
          refs: [
            {
              kind: 'source-operation',
              sourceOperation: {
                ...reference,
                operationId: 'other-operation',
                receiptActorId: 'other-account',
              },
            },
          ],
        },
        {
          ...message(4),
          refs: [
            {
              kind: 'source-operation',
              sourceOperation: {
                ...reference,
                operationId: 'unsupported-operation',
                sourceId: 'unregistered-source',
              },
            },
          ],
        },
      ],
      nextAfterSeq: 4,
      hasMore: false,
    };
    const f = await mount();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).toContain(
        'Source operation: source-op-replay · Open actual retained receipt',
      ),
    );
    expect(f.nativeElement.textContent).toContain(
      'Source operation: other-operation · No supported evidence view',
    );
    expect(f.nativeElement.textContent).toContain(
      'Source operation: unsupported-operation · No supported evidence view',
    );
    expect(f.nativeElement.querySelectorAll('a')).toHaveLength(0);
    expect(client.incidentAction).not.toHaveBeenCalled();
  });
  it('renders asynchronously returned messages with server attribution without another change detection call', async () => {
    const pending = new Subject<HostedIncidentEvents>();
    client.incidentEvents.mockReturnValue(pending.asObservable());
    const f = await mount();
    expect(f.nativeElement.textContent).toContain('Loading conversation');
    await vi.waitFor(() => expect(client.incidentEvents).toHaveBeenCalled());
    pending.next({ events: [message()], nextAfterSeq: 2, hasMore: false });
    pending.complete();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).toContain(
        'Received, but no assignment.',
      ),
    );
    expect(f.nativeElement.textContent).toContain('sarah · web');
    expect(f.nativeElement.textContent).toContain('claim');
  });
  it('preserves DOM-entered text and readiness when a parent returns an equivalent Incident reference', async () => {
    const f = await mount();
    const textarea = f.nativeElement.querySelector(
      'ion-textarea',
    ) as HTMLElement;
    const post = () =>
      Array.from(f.nativeElement.querySelectorAll('ion-button')).find(
        (button) =>
          (button as HTMLElement).textContent?.trim() === 'Post message',
      ) as HTMLElement & { disabled: boolean };
    textarea.dispatchEvent(
      new CustomEvent('ionInput', {
        detail: { value: 'Request received; carrier assignment is missing.' },
        bubbles: true,
      }),
    );
    await f.whenStable();
    expect(post().disabled).toBe(false);
    const reads = client.projectIncident.mock.calls.length;
    f.componentRef.setInput('incidentRef', { ...incidentRef });
    await f.whenStable();
    expect(client.projectIncident).toHaveBeenCalledTimes(reads);
    expect((textarea as HTMLElement & { value: string }).value).toBe(
      'Request received; carrier assignment is missing.',
    );
    expect(post().disabled).toBe(false);
    post().click();
    await f.whenStable();
    expect(client.incidentAction.mock.calls[0][1].message.body).toBe(
      'Request received; carrier assignment is missing.',
    );
  });
  it('posts a real note with optimistic sequence and server-owned attribution, then permits the same text as a new message', async () => {
    const f = await mount();
    page(f).body.set('Received, but no assignment.');
    await page(f).send();
    expect(client.incidentAction).toHaveBeenCalledWith(
      context,
      {
        type: 'append-message',
        incidentRef: 'incidents-scope/INC-1',
        environment: 'demo',
        expectedSeq: 1,
        message: { body: 'Received, but no assignment.', assertion: 'claim' },
      },
      expect.stringMatching(/^operation-/),
      expect.any(AbortSignal),
    );
    const first = client.incidentAction.mock.calls[0][2];
    expect(client.incidentAction.mock.calls[0][1]).not.toHaveProperty('actor');
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('Message saved.');
    expect(f.nativeElement.textContent).toContain('sarah');
    page(f).body.set('Received, but no assignment.');
    await page(f).send();
    expect(client.incidentAction.mock.calls[1][2]).not.toBe(first);
    expect(client.incidentAction.mock.calls[1][1].expectedSeq).toBe(2);
  });
  it('retries a lost success after remount using the identical operation, body and original sequence', async () => {
    client.incidentAction.mockImplementationOnce(() => {
      sequence = 2;
      return throwError(() => new Error('lost reply'));
    });
    const first = await mount();
    page(first).body.set('Received, but no assignment.');
    await page(first).send();
    const original = client.incidentAction.mock.calls[0];
    first.destroy();
    TestBed.resetTestingModule();
    const second = await mount();
    await page(second).send();
    expect(client.incidentAction.mock.calls[1].slice(0, 3)).toEqual(
      original.slice(0, 3),
    );
    await second.whenStable();
    expect(second.nativeElement.textContent).toContain('Message saved.');
  });
  it('recovers a denied attachment through reviewed abandonment without clearing browser storage externally', async () => {
    const f = await mount();
    page(f).body.set('Received, but no assignment.');
    page(f).checkID.set('assignment');
    client.incidentAction.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    await page(f).send();
    const original = client.incidentAction.mock.calls[0];
    f.componentRef.setInput('checks', []);
    await page(f).reviewPending();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain(
      'This attempt may already have been saved',
    );
    expect(f.nativeElement.textContent).toContain('may create a duplicate');
    page(f).abandonPending();
    f.destroy();
    TestBed.resetTestingModule();
    const edited = await mount();
    edited.componentRef.setInput('checks', []);
    page(edited).body.set('Question without the deleted reference');
    await page(edited).send();
    expect(client.incidentAction.mock.calls[1][2]).not.toBe(original[2]);
    expect(client.incidentAction.mock.calls[1][1].message).not.toHaveProperty(
      'refs',
    );
    edited.destroy();
    TestBed.resetTestingModule();
    const reopened = await mount();
    await reopened.whenStable();
    expect(reopened.nativeElement.textContent).not.toContain('Retry message');
  });

  it('preserves uncertain delivery and its exact retry until the user explicitly abandons after review', async () => {
    const first = await mount();
    page(first).body.set('Received, but no assignment.');
    page(first).checkID.set('assignment');
    client.incidentAction.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );
    await page(first).send();
    const original = client.incidentAction.mock.calls[0];
    first.destroy();
    TestBed.resetTestingModule();
    // The first attempt may have committed; later rights hide its reference.
    sequence = 2;
    history = { events: [], nextAfterSeq: 2, hasMore: false };
    const next = await mount();
    client.incidentAction.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    await page(next).send();
    expect(client.incidentAction.mock.calls[1].slice(0, 3)).toEqual(
      original.slice(0, 3),
    );
    await page(next).reviewPending();
    await next.whenStable();
    expect(next.nativeElement.textContent).toContain(
      'changed access cannot prove whether it was delivered',
    );
    expect(next.nativeElement.textContent).not.toContain('never sent');
    page(next).keepPendingRetry();
    client.incidentAction.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    await page(next).send();
    expect(client.incidentAction.mock.calls[2].slice(0, 3)).toEqual(
      original.slice(0, 3),
    );
    await page(next).reviewPending();
    page(next).abandonPending();
    page(next).body.set('A consciously new follow-up');
    await page(next).send();
    expect(client.incidentAction.mock.calls[3][2]).not.toBe(original[2]);
    expect(client.incidentAction.mock.calls[3][1].expectedSeq).toBe(2);
  });

  it('does not regress a newer held projection when an older successful message receipt is replayed', async () => {
    client.incidentAction.mockReturnValueOnce(
      throwError(() => new Error('lost success')),
    );
    const first = await mount();
    page(first).body.set('Received, but no assignment.');
    await page(first).send();
    const original = client.incidentAction.mock.calls[0];
    first.destroy();
    TestBed.resetTestingModule();
    sequence = 4;
    history = {
      events: [message(2), message(4)],
      nextAfterSeq: 4,
      hasMore: false,
    };
    client.projectIncident.mockImplementation(() =>
      of({
        incident: {
          ref: incidentRef,
          title: 'Updated title',
          status: 'investigating',
          canonicalContext: { facts: ['current'] },
          lastSeq: 4,
        },
      }),
    );
    const second = await mount();
    const updates: Array<{ lastSeq: number; status: string }> = [];
    second.componentInstance.incidentUpdated.subscribe((value) =>
      updates.push(value),
    );
    page(second).refresh();
    await second.whenStable();
    client.incidentAction.mockReturnValueOnce(
      of({
        incident: {
          ref: incidentRef,
          title: 'Old title',
          status: 'open',
          canonicalContext: {},
          lastSeq: 2,
        },
        event: message(2),
        replayed: true,
        receipt: original[2],
      }),
    );
    await page(second).send();
    expect(client.incidentAction.mock.calls[1].slice(0, 3)).toEqual(
      original.slice(0, 3),
    );
    expect(
      updates.some((value) => value.lastSeq === 2 || value.status === 'open'),
    ).toBe(false);
    page(second).body.set('New follow-up');
    await page(second).send();
    expect(client.incidentAction.mock.calls[2][1].expectedSeq).toBe(4);
  });

  it('requires review after a sequence conflict and only then creates a new operation with current sequence', async () => {
    const f = await mount();
    client.incidentAction.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({ status: 409, error: { code: 'conflict' } }),
      ),
    );
    page(f).body.set('Draft');
    await page(f).send();
    const original = client.incidentAction.mock.calls[0][2];
    await page(f).send();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('Review latest conversation');
    sequence = 4;
    history = { events: [], nextAfterSeq: 4, hasMore: false };
    await page(f).reviewConflict();
    await page(f).send();
    expect(client.incidentAction.mock.calls[1][1].expectedSeq).toBe(4);
    expect(client.incidentAction.mock.calls[1][2]).not.toBe(original);
  });
  it('keeps a conflicted draft blocked until all paginated current history has been reviewed', async () => {
    const f = await mount();
    client.incidentAction.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );
    page(f).body.set('Draft');
    await page(f).send();
    sequence = 80;
    history = { events: [], nextAfterSeq: 50, hasMore: true };
    await page(f).reviewConflict();
    await page(f).send();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    history = { events: [], nextAfterSeq: 80, hasMore: false };
    page(f).loadMore();
    await f.whenStable();
    await page(f).reviewConflict();
    await page(f).send();
    expect(client.incidentAction.mock.calls[1][1].expectedSeq).toBe(80);
  });

  it('shows the confirmed message immediately while older history still has more pages', async () => {
    history = { events: [], nextAfterSeq: 50, hasMore: true };
    sequence = 120;
    const f = await mount();
    const confirmed = message(121);
    client.incidentAction.mockReturnValueOnce(
      of({
        event: confirmed,
        incident: { ref: incidentRef, lastSeq: 121 },
        receipt: 'saved',
      }),
    );
    page(f).body.set('Received, but no assignment.');
    await page(f).send();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain(
      'Received, but no assignment.',
    );
    expect(f.nativeElement.textContent).toContain('Load more history');
    expect(client.incidentEvents).toHaveBeenCalledTimes(1);
  });

  it('uses scanned cursors across withheld pages and refresh replaces previously admitted content', async () => {
    history = { events: [], nextAfterSeq: 50, hasMore: true };
    const f = await mount();
    history = { events: [message(52)], nextAfterSeq: 52, hasMore: false };
    page(f).loadMore();
    await f.whenStable();
    expect(client.incidentEvents).toHaveBeenLastCalledWith(
      context,
      'demo',
      'incidents-scope/INC-1',
      50,
    );
    expect(f.nativeElement.textContent).toContain(
      'Received, but no assignment.',
    );
    history = { events: [], nextAfterSeq: 52, hasMore: false };
    page(f).refresh();
    await f.whenStable();
    expect(f.nativeElement.textContent).not.toContain(
      'Received, but no assignment.',
    );
  });
  it('ignores late data after scope changes and clears the previous draft and history', async () => {
    const pending = new Subject<HostedIncidentEvents>();
    client.incidentEvents.mockReturnValueOnce(pending.asObservable());
    const f = await mount();
    page(f).body.set('Private draft');
    f.componentRef.setInput('context', {
      ...context,
      project: 'other',
      principal: 'maya',
    });
    await f.whenStable();
    pending.next({ events: [message()], nextAfterSeq: 2, hasMore: false });
    pending.complete();
    await f.whenStable();
    expect(f.nativeElement.textContent).not.toContain(
      'Received, but no assignment.',
    );
    await page(f).send();
    expect(client.incidentAction).not.toHaveBeenCalled();
  });
  it('offers definition references using saved choices and keeps run evidence distinct', async () => {
    const f = await mount();
    page(f).body.set('Check definition for this issue');
    page(f).checkID.set('assignment');
    await page(f).send();
    expect(client.incidentAction.mock.calls[0][1].message.refs).toEqual([
      {
        kind: 'check',
        artifact: {
          storeId: 'firestore',
          projectId: 'training',
          environment: 'demo',
          id: 'assignment',
        },
      },
    ]);
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain(
      'Run attachments are not available',
    );
    expect(f.nativeElement.textContent).not.toContain('deterministic-result');
  });
  it('links admitted query and Check definitions in the same project while refusing foreign or unsupported evidence views', async () => {
    const event = message();
    history = {
      events: [
        {
          ...event,
          refs: [
            {
              kind: 'query',
              artifact: {
                storeId: 'firestore',
                projectId: 'training',
                environment: 'demo',
                id: 'receipt',
              },
            },
            {
              kind: 'check',
              artifact: {
                storeId: 'firestore',
                projectId: 'training',
                environment: 'demo',
                id: 'assignment',
              },
            },
            {
              kind: 'execution',
              execution: {
                storeId: 'firestore',
                projectId: 'training',
                executionId: 'execution-1',
              },
            },
            {
              kind: 'query',
              artifact: {
                storeId: 'firestore',
                projectId: 'foreign',
                environment: 'demo',
                id: 'other',
              },
            },
          ],
        },
      ],
      nextAfterSeq: 2,
      hasMore: false,
    };
    const f = await mount();
    await vi.waitFor(() =>
      expect(f.nativeElement.querySelectorAll('a')).toHaveLength(2),
    );
    const links = [
      ...f.nativeElement.querySelectorAll('a'),
    ] as HTMLAnchorElement[];
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toContain(
      '/space/space/store/firestore/project/training/query',
    );
    expect(links[0].getAttribute('href')).toContain('env=demo');
    expect(links[1].getAttribute('href')).toContain('/checks/assignment');
    expect(f.nativeElement.textContent).toContain(
      'Query execution: execution-1 · Open actual retained run',
    );
  });

  it('fails closed on revoked access and on invalid history cursor, and enforces viewer rights and byte limit', async () => {
    history = { events: [message()], nextAfterSeq: 2, hasMore: false };
    const f = await mount();
    client.projectIncident.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    page(f).refresh();
    await f.whenStable();
    expect(f.nativeElement.textContent).not.toContain(
      'Received, but no assignment.',
    );
    client.incidentEvents.mockReturnValueOnce(
      of({ events: [], nextAfterSeq: 0, hasMore: true }),
    );
    page(f).refresh();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('invalid cursor');
    page(f).refresh();
    await f.whenStable();
    page(f).body.set('🙂'.repeat(1001));
    await page(f).send();
    expect(client.incidentAction).not.toHaveBeenCalled();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('4,000 bytes');
    f.componentRef.setInput('canWrite', false);
    page(f).body.set('No rights');
    await page(f).send();
    expect(client.incidentAction).not.toHaveBeenCalled();
  });
  const availablePresentation = {
    status: 'available' as const,
    kind: 'demo-character' as const,
    characterIds: ['sarah', 'maya', 'daniel'] as ['sarah', 'maya', 'daniel'],
  };
  async function chooseSpeaker(
    f: ComponentFixture<HostedIncidentConversationComponent>,
    value: string,
  ) {
    await vi.waitFor(() =>
      expect(
        f.nativeElement.querySelector('.character-choice ion-select'),
      ).not.toBeNull(),
    );
    const select = f.nativeElement.querySelector(
      '.character-choice ion-select',
    );
    expect(select).not.toBeNull();
    select.dispatchEvent(
      new CustomEvent('ionChange', { detail: { value }, bubbles: true }),
    );
  }
  it('offers only server-admitted fictional speakers, defaults to Me, and retains the real server actor with persisted labels', async () => {
    history.messagePresentation = availablePresentation;
    const f = await mount();
    await vi.waitFor(() =>
      expect(
        f.nativeElement.querySelector('.character-choice ion-select'),
      ).not.toBeNull(),
    );
    const select = f.nativeElement.querySelector(
      '.character-choice ion-select',
    );
    expect(select).not.toBeNull();
    expect(select.value).toBe('');
    page(f).body.set('Ordinary account message');
    await page(f).send();
    expect(client.incidentAction.mock.calls[0][1].message).not.toHaveProperty(
      'presentation',
    );
    page(f).refresh();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).not.toContain('Loading conversation'),
    );
    // The mock history changed on the confirmed ordinary note; explicitly admit the next current read.
    history.messagePresentation = availablePresentation;
    page(f).refresh();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).not.toContain('Loading conversation'),
    );
    await chooseSpeaker(f, 'maya');
    client.incidentAction.mockImplementationOnce((_context, action) => {
      const event = { ...message(3), payload: structuredClone(action.message) };
      history = {
        events: [message(), event],
        nextAfterSeq: 3,
        hasMore: false,
        messagePresentation: { status: 'not-eligible' },
      };
      sequence = 3;
      return of({
        event,
        incident: { ref: incidentRef, lastSeq: 3 },
        receipt: 'persona-saved',
      });
    });
    page(f).body.set('I will inspect the assignment.');
    await page(f).send();
    await f.whenStable();
    expect(client.incidentAction.mock.calls[1][1].message.presentation).toEqual(
      { kind: 'demo-character', characterId: 'maya' },
    );
    expect(f.nativeElement.textContent).toContain('Maya · fictional character');
    expect(f.nativeElement.textContent).toContain('sarah · web');
    expect(
      f.nativeElement.querySelector('.character-choice ion-select').value,
    ).toBe('');
    page(f).refresh();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).not.toContain('Loading conversation'),
    );
    await vi.waitFor(() =>
      expect(
        f.nativeElement.querySelector('.character-choice ion-select'),
      ).toBeNull(),
    );
    expect(f.nativeElement.textContent).toContain('Maya · fictional character');
  });
  it('freezes character and absent refs across lost reply, remount and unavailable advertisement', async () => {
    history.messagePresentation = availablePresentation;
    client.incidentAction.mockReturnValueOnce(
      throwError(() => new Error('lost reply')),
    );
    const first = await mount();
    await chooseSpeaker(first, 'daniel');
    page(first).body.set(
      'The configuration is corrected; replay is still required.',
    );
    await page(first).send();
    const original = structuredClone(
      client.incidentAction.mock.calls[0].slice(0, 3),
    );
    expect(original[1].message).not.toHaveProperty('refs');
    first.destroy();
    TestBed.resetTestingModule();
    history.messagePresentation = { status: 'not-eligible' };
    const second = await mount();
    await vi.waitFor(() =>
      expect(
        second.nativeElement.querySelector('.character-choice ion-select'),
      ).not.toBeNull(),
    );
    const selector = second.nativeElement.querySelector(
      '.character-choice ion-select',
    );
    expect(selector.value).toBe('daniel');
    expect(selector.disabled).toBe(true);
    await chooseSpeaker(second, 'sarah');
    client.incidentAction.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    await page(second).send();
    expect(client.incidentAction.mock.calls[1].slice(0, 3)).toEqual(original);
    expect(
      client.incidentAction.mock.calls.every(
        (call) => call[1].type === 'append-message',
      ),
    ).toBe(true);
  });
  it('blocks corrupted saved presentation without changing storage until explicit reviewed abandonment', async () => {
    client.incidentAction.mockReturnValueOnce(
      throwError(() => new Error('lost reply')),
    );
    const first = await mount();
    page(first).body.set('Uncertain message');
    await page(first).send();
    const key = Array.from({ length: sessionStorage.length }, (_, i) =>
      sessionStorage.key(i),
    ).find((key) => key?.startsWith('datatug:incident-message:'));
    if (!key) throw new Error('Expected persisted pending attempt');
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    saved.message.presentation = {
      kind: 'demo-character',
      characterId: 'maya',
      actorId: 'forged',
    };
    const corrupt = JSON.stringify(saved);
    sessionStorage.setItem(key, corrupt);
    first.destroy();
    TestBed.resetTestingModule();
    const second = await mount();
    page(second).body.set('A fresh draft');
    await page(second).send();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(key)).toBe(corrupt);
    expect(second.nativeElement.textContent).toContain(
      'cannot be safely retried',
    );
    await page(second).reviewPending();
    page(second).abandonPending();
    expect(sessionStorage.getItem(key)).toBeNull();
    await page(second).send();
    expect(client.incidentAction).toHaveBeenCalledTimes(2);
    expect(client.incidentAction.mock.calls[1][2]).not.toBe(saved.operationId);
  });
  it('does not admit late old-scope presentation and keeps ordinary posting when capability is missing', async () => {
    const delayed = new Subject<HostedIncidentEvents>();
    client.incidentEvents.mockReturnValueOnce(delayed.asObservable());
    const f = await mount();
    f.componentRef.setInput('context', {
      ...context,
      project: 'other',
      principal: 'maya',
    });
    await f.whenStable();
    delayed.next({
      events: [],
      nextAfterSeq: 1,
      hasMore: false,
      messagePresentation: availablePresentation,
    });
    delayed.complete();
    await f.whenStable();
    expect(
      f.nativeElement.querySelector('.character-choice ion-select'),
    ).toBeNull();
    await page(f).send();
    expect(client.incidentAction).not.toHaveBeenCalled();
  });

  it('starts a reviewed conflicting persona draft as Me when current eligibility has gone away', async () => {
    history.messagePresentation = availablePresentation;
    const f = await mount();
    await chooseSpeaker(f, 'sarah');
    page(f).body.set('Review this conflicting draft');
    client.incidentAction.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );
    await page(f).send();
    history.messagePresentation = { status: 'not-eligible' };
    await page(f).reviewConflict();
    await page(f).send();
    expect(client.incidentAction).toHaveBeenCalledTimes(2);
    expect(client.incidentAction.mock.calls[1][1].message).not.toHaveProperty(
      'presentation',
    );
    expect(client.incidentAction.mock.calls[1][2]).not.toBe(
      client.incidentAction.mock.calls[0][2],
    );
  });

  function criterionResult(finalized = false) {
    const result = structuredClone(
      finalized
        ? criterionFixture.finalizeSuccess
        : criterionFixture.draftSuccess,
    );
    result.incident.ref = incidentRef;
    result.event.incident = incidentRef;
    result.event.actor.id = 'sarah';
    result.incident.resolutionCriterion.scope.project.projectId = 'training';
    result.event.payload.scope.project.projectId = 'training';
    return result;
  }
  function selectCriterion(
    f: ComponentFixture<HostedIncidentConversationComponent>,
    session = 'shipping-session',
  ) {
    const evidence: AppliedEvidenceRequest = {
      ...structuredClone(criterionFixture.draftRequest.evidence),
      retention: 'project-pinned',
    };
    const selected = {
      ...evidence,
      incidentRef: `${incidentRef.storeId}/${incidentRef.incidentId}`,
      context: { ...evidence.context, sessionId: session },
    };
    page(f).criterionChoice.set({
      evidence: selected,
      value: { type: 'integer', value: '11045' },
      bagId: 'shipping-bag',
      label: session,
    });
    page(f).criterionCheckID.set('assignment');
  }
  it('cold-opens the actual finalized projection alongside chronological criterion and message history', async () => {
    const draft = criterionResult(),
      final = criterionResult(true),
      note = message(4);
    client.projectIncident.mockReturnValue(
      of({ incident: { ...final.incident, lastSeq: 4 } }),
    );
    history = {
      events: [draft.event, final.event, note] as IncidentEvent[],
      nextAfterSeq: 4,
      hasMore: false,
    };
    const f = await mount();
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).toContain('Finalized · criterion 2'),
    );
    expect(f.nativeElement.textContent).toContain('Criterion draft saved');
    expect(f.nativeElement.textContent).toContain('Criterion finalized');
    expect(f.nativeElement.textContent).toContain(
      'Received, but no assignment.',
    );
    expect(f.nativeElement.textContent).toContain(
      final.incident.resolutionCriterion.definitionDigest,
    );
    expect(client.incidentAction).not.toHaveBeenCalled();
    const link = f.debugElement
      .queryAll(By.directive(RouterLink))
      .find((el) => el.nativeElement.textContent.includes('Open saved Check'));
    if (!link) throw new Error('Saved Check navigation is missing.');
    expect(link.nativeElement.closest('header')).not.toBeNull();
    expect(link.nativeElement.getAttribute('title')).toBe('Open saved Check');
    const tree = link.injector.get(RouterLink).urlTree;
    if (!tree) throw new Error('Saved Check route is unavailable.');
    expect(TestBed.inject(Router).serializeUrl(tree)).toContain(
      '/checks/fault-check?environment=demo',
    );
  });
  it('requires durable readback before criterion dispatch and retains a failed storage attempt', async () => {
    const f = await mount();
    selectCriterion(f);
    const spy = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    await page(f).saveCriterion();
    expect(client.incidentAction).not.toHaveBeenCalled();
    spy.mockRestore();
    page(f).body.set('Do not compete');
    await page(f).send();
    expect(client.incidentAction).not.toHaveBeenCalled();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('storage denied');
  });
  it('retains exact selected Session intent through lost reply and remount without creating a competing chat', async () => {
    let f = await mount();
    selectCriterion(f, 'session-second-same-order');
    client.incidentAction.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );
    await page(f).saveCriterion();
    const original = structuredClone(
      client.incidentAction.mock.calls[0].slice(0, 3),
    );
    expect(original[1].evidence.context.sessionId).toBe(
      'session-second-same-order',
    );
    page(f).body.set('unrelated message');
    await page(f).send();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    f.destroy();
    TestBed.resetTestingModule();
    f = await mount();
    await page(f).retryCriterion();
    expect(client.incidentAction.mock.calls[1].slice(0, 3)).toEqual(original);
    expect(sessionStorage.length).toBe(1);
  });
  it('requires explicit reviewed abandonment after409 and uses a new operation for a changed draft', async () => {
    const f = await mount();
    selectCriterion(f);
    client.incidentAction.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );
    await page(f).saveCriterion();
    const original = client.incidentAction.mock.calls[0][2];
    sequence = 7;
    history = { events: [], nextAfterSeq: 7, hasMore: false };
    await page(f).reviewConflict();
    await page(f).saveCriterion();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    page(f).abandonPending();
    selectCriterion(f);
    await page(f).saveCriterion();
    expect(client.incidentAction.mock.calls[1][1].expectedSeq).toBe(7);
    expect(client.incidentAction.mock.calls[1][2]).not.toBe(original);
  });
  it('finalizes only after explicit review and renders actual next server version while preserving unsent chat', async () => {
    const draft = criterionResult();
    client.projectIncident.mockReturnValue(of({ incident: draft.incident }));
    history = {
      events: [draft.event as IncidentEvent],
      nextAfterSeq: 2,
      hasMore: false,
    };
    const f = await mount();
    page(f).body.set('Keep my text');
    page(f).checkID.set('assignment');
    await page(f).finalizeCriterion();
    expect(client.incidentAction).not.toHaveBeenCalled();
    page(f).finalizeReview.set(true);
    client.incidentAction.mockImplementation((_context, _action, id) =>
      of({ ...criterionResult(true), receipt: id }),
    );
    await page(f).finalizeCriterion();
    await f.whenStable();
    expect(client.incidentAction.mock.calls[0][1]).toEqual({
      type: 'criterion-finalize',
      incidentRef: `${incidentRef.storeId}/${incidentRef.incidentId}`,
      environment: 'demo',
      expectedSeq: 2,
      criterionVersion: 1,
    });
    await vi.waitFor(() =>
      expect(f.nativeElement.textContent).toContain('Finalized · criterion 2'),
    );
    expect(f.nativeElement.querySelector('ion-textarea').value).toBe(
      'Keep my text',
    );
    expect((page(f).checkID as unknown as () => string)()).toBe('assignment');
  });
  it('blocks chat and criterion dispatch while the parent owns an Incident mutation', async () => {
    const f = await mount();
    selectCriterion(f);
    page(f).body.set('Wait');
    f.componentRef.setInput('parentBusy', true);
    await page(f).send();
    await page(f).saveCriterion();
    expect(client.incidentAction).not.toHaveBeenCalled();
  });
  it('retains unsupported stored variants and overlong intent until explicit reviewed abandonment', async () => {
    const identity = JSON.stringify([context, 'demo', incidentRef]),
      key = `datatug:incident-message:${identity}`;
    const raw = JSON.stringify({
      operationId: 'operation-unknown',
      expectedSeq: 1,
      action: { type: 'future-write' },
      padding: 'x'.repeat(33000),
    });
    sessionStorage.setItem(key, raw);
    const f = await mount();
    selectCriterion(f);
    await page(f).saveCriterion();
    expect(client.incidentAction).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBe(raw);
    await page(f).reviewPending();
    page(f).abandonPending();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('discards a late criterion result after account invalidation and retains the old scoped journal', async () => {
    const f = await mount();
    selectCriterion(f);
    const reply = new Subject<unknown>();
    client.incidentAction.mockReturnValue(reply.asObservable());
    const sending = page(f).saveCriterion();
    const original = client.incidentAction.mock.calls[0],
      stored = sessionStorage.key(0);
    if (!stored) throw new Error('Criterion retry was not durably saved.');
    const updates: unknown[] = [];
    f.componentInstance.incidentUpdated.subscribe((value) =>
      updates.push(value),
    );
    const auth = TestBed.inject(SneatAuthStateService)
      .authState as unknown as BehaviorSubject<unknown>;
    auth.next({ status: 'authenticated', user: { uid: 'another-account' } });
    reply.next({ ...criterionResult(), receipt: original[2] });
    reply.complete();
    await sending;
    await f.whenStable();
    expect(updates).toEqual([]);
    expect(sessionStorage.getItem(stored)).toContain(original[2]);
    await page(f).retryCriterion();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    expect(f.nativeElement.textContent).not.toContain(
      'Draft saved · criterion',
    );
  });
  it('retains an unknown criterion success with an incorrect receipt instead of retiring its intent', async () => {
    const f = await mount();
    selectCriterion(f);
    client.incidentAction.mockReturnValue(
      of({ ...criterionResult(), receipt: 'wrong-operation' }),
    );
    await page(f).saveCriterion();
    expect(sessionStorage.length).toBe(1);
    page(f).body.set('blocked');
    await page(f).send();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
  });

  it('keeps competing writes locked when a confirmed criterion cannot retire its durable retry', async () => {
    const draft = criterionResult();
    client.projectIncident.mockReturnValue(of({ incident: draft.incident }));
    history = {
      events: [draft.event as IncidentEvent],
      nextAfterSeq: 2,
      hasMore: false,
    };
    const f = await mount();
    page(f).finalizeReview.set(true);
    client.incidentAction.mockImplementation((_context, _action, id) =>
      of({ ...criterionResult(true), receipt: id }),
    );
    const remove = vi
      .spyOn(sessionStorage, 'removeItem')
      .mockImplementation(() => {
        throw new Error('retirement denied');
      });
    await page(f).finalizeCriterion();
    expect(sessionStorage.length).toBe(1);
    page(f).body.set('competing');
    await page(f).send();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    remove.mockRestore();
    await page(f).retryCriterion();
    expect(client.incidentAction).toHaveBeenCalledTimes(2);
    expect(sessionStorage.length).toBe(0);
  });

  it('F1 blocks a remount with unreadable retained criterion storage and recovers only the exact reread intent', async () => {
    let f = await mount();
    selectCriterion(f);
    client.incidentAction.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );
    await page(f).saveCriterion();
    const original = structuredClone(
      client.incidentAction.mock.calls[0].slice(0, 3),
    );
    const key = sessionStorage.key(0);
    if (!key) throw new Error('Missing original criterion journal');
    const read = sessionStorage.getItem.bind(sessionStorage),
      bytes = read(key);
    f.destroy();
    TestBed.resetTestingModule();
    const get = vi
      .spyOn(sessionStorage, 'getItem')
      .mockImplementation((name) => {
        if (name === key) throw new Error('read denied');
        return read(name);
      });
    const write = vi.spyOn(sessionStorage, 'setItem'),
      remove = vi.spyOn(sessionStorage, 'removeItem');
    f = await mount();
    page(f).body.set('Do not replace unknown criterion');
    selectCriterion(f);
    await page(f).send();
    await page(f).saveCriterion();
    await page(f).reviewPending();
    page(f).abandonPending();
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(read(key)).toBe(bytes);
    expect(
      (
        f.componentInstance as unknown as { invalidPending(): boolean }
      ).invalidPending(),
    ).toBe(true);
    get.mockRestore();
    await page(f).reviewPending();
    expect(read(key)).toBe(bytes);
    expect(client.incidentAction).toHaveBeenCalledTimes(1);
    page(f).keepPendingRetry();
    await page(f).retryCriterion();
    expect(client.incidentAction.mock.calls[1].slice(0, 3)).toEqual(original);
    expect(read(key)).toBe(bytes);
  });
  it('F1 preserves an already-known ordinary message retry when writes and later reads fail', async () => {
    const f = await mount();
    page(f).body.set('Known ordinary message');
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('write denied');
    });
    client.incidentAction.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );
    await page(f).send();
    const original = structuredClone(
      client.incidentAction.mock.calls[0].slice(0, 3),
    );
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('read denied');
    });
    await page(f).send();
    expect(client.incidentAction.mock.calls[1].slice(0, 3)).toEqual(original);
  });
  it('F1 rechecks a fresh shared slot before creating any replacement message operation', async () => {
    const f = await mount();
    page(f).body.set('Fresh draft');
    const write = vi.spyOn(sessionStorage, 'setItem');
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('fresh read denied');
    });
    await page(f).send();
    expect(write).not.toHaveBeenCalled();
    expect(client.incidentAction).not.toHaveBeenCalled();
  });
  it('F2 places the accessible draft action in one flat criterion section header', async () => {
    const f = await mount();
    page(f).criterionOpen.set(true);
    await f.whenStable();
    const section = f.nativeElement.querySelector(
      'section[aria-label="Resolution criterion"]',
    );
    const action = section.querySelector(
      'header ion-button[title="Save draft"]',
    );
    expect(action).not.toBeNull();
    expect(action.getAttribute('title')).toBe('Save draft');
    expect(action.querySelector('ion-icon').getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(action.querySelector('.header-action-label').textContent).toContain(
      'Save draft',
    );
    expect(section.querySelectorAll('h3')).toHaveLength(1);
    expect(
      section.querySelectorAll('ion-button[title="Save draft"]'),
    ).toHaveLength(1);
    expect(section.querySelector('ion-card')).toBeNull();
    expect(client.incidentAction).not.toHaveBeenCalled();
  });
});

// vi.restoreAllMocks() does not undo a spy on a happy-dom Storage, and this suite shares one environment across spec
// files: restore each spied Storage method explicitly, so that a mock never leaks into the next file.
afterEach(() => {
  for (const storage of [sessionStorage, localStorage])
    for (const method of [
      'getItem',
      'setItem',
      'removeItem',
      'clear',
      'key',
    ] as const) {
      const fn: unknown = storage[method];
      if (vi.isMockFunction(fn)) fn.mockRestore();
    }
});
