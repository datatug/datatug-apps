import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SneatAuthStateService, type ISneatAuthState } from '@sneat/auth-core';
import { AnalyticsService } from '@sneat/core';
import { BehaviorSubject } from 'rxjs';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import {
  NOOP_USAGE_ANALYTICS_SINK,
  PENDING_SIGN_IN_KEY,
  USAGE_ANALYTICS_SINK,
  UsageAnalyticsService,
  declaredUsageValue,
  type UsageEventName,
  type UsageEventParams,
} from './usage-analytics';

const anonymous = {
  status: 'notAuthenticated',
} as unknown as ISneatAuthState;
const signedIn = {
  status: 'authenticated',
  user: { uid: 'u1', isAnonymous: false },
} as unknown as ISneatAuthState;
const demo = {
  project: 'github.com/datatug/datatug-demo-project',
  walkthroughId: 'order-11045',
};

function setup(initial: ISneatAuthState = anonymous) {
  const auth = new BehaviorSubject<ISneatAuthState>(initial);
  const sent: [UsageEventName, UsageEventParams][] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: SneatAuthStateService, useValue: { authState: auth } },
      {
        provide: USAGE_ANALYTICS_SINK,
        useValue: {
          send: (name: UsageEventName, params: UsageEventParams) =>
            sent.push([name, params]),
        },
      },
    ],
  });
  return { service: TestBed.inject(UsageAnalyticsService), auth, sent };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('UsageAnalyticsService', () => {
  it('records chapter and step events with declared identifiers only', () => {
    const { service, sent } = setup();
    const context = { ...demo, walkthroughVersion: 'a1b2', mode: 'guided' };
    service.chapterEntered(context, 'find');
    service.stepEntered(context, 'find', 'lookup', 'none');
    service.stepEntered(demo, 'find', 'card');
    service.stepCompleted(demo, 'find', 'lookup', 'completed');
    service.stepCompleted(demo, 'find', 'card', 'skipped');
    service.chapterCompleted(demo, 'find');
    service.walkthroughReset(demo);
    const base = {
      project: 'github.com/datatug/datatug-demo-project',
      walkthrough_id: 'order-11045',
    };
    expect(sent).toEqual([
      [
        'walkthrough_chapter_entered',
        {
          ...base,
          walkthrough_version: 'a1b2',
          mode: 'guided',
          chapter_id: 'find',
        },
      ],
      [
        'walkthrough_step_entered',
        {
          ...base,
          walkthrough_version: 'a1b2',
          mode: 'guided',
          chapter_id: 'find',
          step_id: 'lookup',
          requirement: 'none',
        },
      ],
      [
        'walkthrough_step_entered',
        { ...base, chapter_id: 'find', step_id: 'card' },
      ],
      [
        'walkthrough_step_completed',
        {
          ...base,
          chapter_id: 'find',
          step_id: 'lookup',
          outcome: 'completed',
        },
      ],
      [
        'walkthrough_step_completed',
        { ...base, chapter_id: 'find', step_id: 'card', outcome: 'skipped' },
      ],
      ['walkthrough_chapter_completed', { ...base, chapter_id: 'find' }],
      ['walkthrough_reset', base],
    ]);
  });

  it('drops an event whose identifier is free text or whose outcome is unknown', () => {
    const { service, sent } = setup();
    service.chapterEntered(demo, 'SELECT * FROM Customers');
    service.stepEntered({ ...demo, project: '' }, 'find', 'lookup');
    service.stepCompleted(demo, 'find', 'lookup', 'maybe' as never);
    service.signInPrompted('nonsense' as never);
    service.signInPrompted('walkthrough', demo, 'bad id');
    expect(sent).toEqual([]);
    expect(sessionStorage.getItem(PENDING_SIGN_IN_KEY)).toBeNull();
    expect(() => declaredUsageValue(42 as never)).toThrow();
    expect(() => declaredUsageValue('x'.repeat(129))).toThrow();
  });

  it('never lets a sink failure reach the product', () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: SneatAuthStateService,
          useValue: { authState: new BehaviorSubject(anonymous) },
        },
        {
          provide: USAGE_ANALYTICS_SINK,
          useValue: {
            send: () => {
              throw new Error('sink down');
            },
          },
        },
      ],
    });
    expect(() =>
      TestBed.inject(UsageAnalyticsService).chapterEntered(demo, 'find'),
    ).not.toThrow();
  });

  it('pairs a walkthrough sign-in prompt with one completed event after sign-in', () => {
    const { service, auth, sent } = setup();
    service.signInPrompted('walkthrough', demo, 'incident');
    auth.next(signedIn);
    auth.next(signedIn);
    const params = {
      project: 'github.com/datatug/datatug-demo-project',
      walkthrough_id: 'order-11045',
      chapter_id: 'incident',
    };
    expect(sent).toEqual([
      ['walkthrough_signin_prompted', params],
      ['walkthrough_signin_completed', params],
    ]);
    expect(sessionStorage.getItem(PENDING_SIGN_IN_KEY)).toBeNull();
  });

  it('records a generic prompt by reason and completes it after a redirect sign-in', () => {
    const first = setup();
    first.service.signInPrompted('evidence-link');
    expect(first.sent).toEqual([
      ['signin_prompted', { reason: 'evidence-link' }],
    ]);
    TestBed.resetTestingModule();
    // The sign-in redirect reloads the app: a new service finds the pending prompt.
    const second = setup(signedIn);
    expect(second.sent).toEqual([
      ['signin_completed', { reason: 'evidence-link' }],
    ]);
  });

  it('records nothing for a visitor who is already signed in, or a pending entry that is not ours', () => {
    sessionStorage.setItem(
      PENDING_SIGN_IN_KEY,
      JSON.stringify({ reason: 'evidence-link', params: { q: 'free text' } }),
    );
    const { service, sent } = setup(signedIn);
    service.signInPrompted('evidence-link');
    expect(sent).toEqual([]);
    sessionStorage.setItem(PENDING_SIGN_IN_KEY, '{not json');
    TestBed.resetTestingModule();
    expect(setup(signedIn).sent).toEqual([]);
    sessionStorage.setItem(
      PENDING_SIGN_IN_KEY,
      JSON.stringify({ reason: 'other', params: {} }),
    );
    TestBed.resetTestingModule();
    expect(setup(signedIn).sent).toEqual([]);
    sessionStorage.setItem(
      PENDING_SIGN_IN_KEY,
      JSON.stringify({ reason: 'walkthrough' }),
    );
    TestBed.resetTestingModule();
    expect(setup(signedIn).sent).toEqual([]);
  });

  it('keeps the pending prompt in memory when session storage is refused', () => {
    const refuse = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('sessionStorage', {
      getItem: refuse,
      setItem: refuse,
      removeItem: refuse,
    });
    const { service, auth, sent } = setup();
    service.signInPrompted('evidence-link');
    auth.next(signedIn);
    expect(sent.map(([name]) => name)).toEqual([
      'signin_prompted',
      'signin_completed',
    ]);
  });

  it('records a verified source reset with no identifiers, and no other source action', () => {
    const { sent } = setup();
    const invalidation = TestBed.inject(NativeSourceInvalidationService);
    const event = {
      projectRef: { storeId: 'firestore', projectId: 'p1', spaceID: 's1' },
      actor: 'u1',
      sourceId: 'source-a',
    };
    invalidation.invalidate({ ...event, action: 'correct' });
    invalidation.invalidate({ ...event, action: 'reset' });
    expect(sent).toEqual([['source_reset', {}]]);
  });

  it('sends through the shared AnalyticsService when the app provides one', () => {
    const logEvent = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: SneatAuthStateService,
          useValue: { authState: new BehaviorSubject(anonymous) },
        },
        { provide: AnalyticsService, useValue: { logEvent } },
      ],
    });
    TestBed.inject(UsageAnalyticsService).chapterEntered(demo, 'find');
    expect(logEvent).toHaveBeenCalledWith('walkthrough_chapter_entered', {
      project: 'github.com/datatug/datatug-demo-project',
      walkthrough_id: 'order-11045',
      chapter_id: 'find',
    });
  });

  it('defaults to a sink that sends nothing', () => {
    expect(NOOP_USAGE_ANALYTICS_SINK.send('source_reset', {})).toBeUndefined();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: SneatAuthStateService,
          useValue: { authState: new BehaviorSubject(anonymous) },
        },
      ],
    });
    expect(TestBed.inject(USAGE_ANALYTICS_SINK)).toBe(
      NOOP_USAGE_ANALYTICS_SINK,
    );
  });
});
