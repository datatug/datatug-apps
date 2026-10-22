import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { IProjectRef } from '../core/project-context';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import {
  BUSINESS_CLOCK_PAGE,
  BusinessClockService,
  businessClockText,
  readBusinessClock,
  type BusinessClockPage,
} from './business-clock';
import { BusinessClockChipComponent } from './business-clock-chip.component';
import {
  SOURCE_ADAPTER_REGISTRATIONS,
  type SourceAdapterRegistration,
  type SourceBusinessClock,
  type SourceUiScope,
} from './source-workspace-contract';

describe('businessClockText', () => {
  it('writes D Mon YYYY HH:MM UTC, seconds only when non-zero, fractions never', () => {
    expect(businessClockText('2018-05-20T10:00:00Z')).toBe(
      '20 May 2018 10:00 UTC',
    );
    expect(businessClockText('2018-05-20T10:05:00.000Z')).toBe(
      '20 May 2018 10:05 UTC',
    );
    expect(businessClockText('2018-12-01T23:59:07.5Z')).toBe(
      '1 Dec 2018 23:59:07 UTC',
    );
  });

  it.each([
    undefined,
    42,
    '',
    '2018-05-20T10:00:00',
    '2018-05-20T10:00:00+02:00',
    '2018-05-20 10:00:00Z',
    '2018-02-30T10:00:00Z',
    '2018-13-01T10:00:00Z',
    '2018-05-20T25:00:00Z',
    '2018-05-20T10:00:00.' + '1'.repeat(30) + 'Z',
  ])('shows no clock for %j', (value) => {
    expect(businessClockText(value)).toBeUndefined();
  });

  it('keeps only a trimmed label and the instant', () => {
    expect(
      readBusinessClock('s', {
        label: ' Demo clock ',
        at: '2018-05-20T10:00:00Z',
        actorId: 'u1',
      } as SourceBusinessClock),
    ).toEqual({
      sourceId: 's',
      label: 'Demo clock',
      text: '20 May 2018 10:00 UTC',
      at: '2018-05-20T10:00:00Z',
    });
    expect(readBusinessClock('s', undefined)).toBeUndefined();
    expect(
      readBusinessClock('s', 'x' as unknown as SourceBusinessClock),
    ).toBeUndefined();
    for (const label of ['', '  ', 'x'.repeat(41), 7])
      expect(
        readBusinessClock('s', {
          label,
          at: '2018-05-20T10:00:00Z',
        } as SourceBusinessClock),
      ).toBeUndefined();
  });
});

describe('BusinessClockService and chip', () => {
  const projectRef: IProjectRef = {
    storeId: 'firestore',
    spaceID: 'S1',
    projectId: 'p1',
  };
  let page: {
    ref: ReturnType<typeof signal<IProjectRef | undefined>>;
    actor: ReturnType<typeof signal<string>>;
    environment: ReturnType<typeof signal<string | undefined>>;
  };
  let reads: { scope: SourceUiScope; signal: AbortSignal }[];
  let answer: (
    scope: SourceUiScope,
  ) => Promise<SourceBusinessClock | undefined>;

  function setup(registrations: SourceAdapterRegistration[]) {
    page = {
      ref: signal<IProjectRef | undefined>(projectRef),
      actor: signal('u1'),
      environment: signal<string | undefined>('demo'),
    };
    const pageScope: BusinessClockPage = {
      ref: () => page.ref(),
      identity: () => (page.actor() ? 'identity-' + page.actor() : undefined),
      context: () => ({ principal: page.actor() || undefined }),
      currentEnvironment: () => {
        const id = page.environment();
        return id ? { id } : undefined;
      },
    };
    TestBed.configureTestingModule({
      imports: [BusinessClockChipComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: BUSINESS_CLOCK_PAGE, useValue: pageScope },
        { provide: SOURCE_ADAPTER_REGISTRATIONS, useValue: registrations },
        BusinessClockService,
      ],
    });
  }

  const clockSource = (sourceId = 'copy'): SourceAdapterRegistration => ({
    sourceId,
    create: () => {
      throw new Error('not used');
    },
    businessClock: (scope, signal) => {
      reads.push({ scope, signal });
      return answer(scope);
    },
  });

  beforeEach(() => {
    reads = [];
    answer = async () => ({ label: 'Demo clock', at: '2018-05-20T10:00:00Z' });
  });
  afterEach(() => TestBed.resetTestingModule());

  async function render() {
    const fixture = TestBed.createComponent(BusinessClockChipComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('shows the declared clock with its accessible explanation, read under the current scope', async () => {
    setup([clockSource()]);
    const fixture = await render();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).toContain(
        'Demo clock: 20 May 2018 10:00 UTC',
      ),
    );
    const region = fixture.nativeElement.querySelector('[role="status"]');
    expect(region.textContent).toContain(
      'Business time of this data source, not your local time.',
    );
    expect(reads[0].scope).toEqual({
      projectRef,
      actor: 'u1',
      identity: 'identity-u1',
      sourceId: 'copy',
      environment: 'demo',
    });
  });

  it('follows a verified receipt of the same source, project and actor without a reload', async () => {
    setup([clockSource()]);
    const fixture = await render();
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    const invalidation = TestBed.inject(NativeSourceInvalidationService);
    // Another actor, another project and another source change nothing.
    invalidation.invalidate({
      projectRef,
      actor: 'u2',
      sourceId: 'copy',
      action: 'correct',
    });
    invalidation.invalidate({
      projectRef: { ...projectRef, projectId: 'p2' },
      actor: 'u1',
      sourceId: 'copy',
      action: 'correct',
    });
    invalidation.invalidate({
      projectRef,
      actor: 'u1',
      sourceId: 'other',
      action: 'correct',
    });
    await fixture.whenStable();
    expect(reads).toHaveLength(1);
    let release!: () => void;
    answer = () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ label: 'Demo clock', at: '2018-05-20T10:05:00Z' });
      });
    invalidation.invalidate({
      projectRef,
      actor: 'u1',
      sourceId: 'copy',
      action: 'correct',
    });
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    // The old time stays until the new read lands: no flicker.
    expect(fixture.nativeElement.textContent).toContain('10:00 UTC');
    release();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).toContain(
        'Demo clock: 20 May 2018 10:05 UTC',
      ),
    );
  });

  it('hides the clock when a re-read fails or returns nothing usable', async () => {
    setup([clockSource()]);
    const fixture = await render();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).toContain('10:00 UTC'),
    );
    answer = () => Promise.reject(new Error('denied'));
    TestBed.inject(NativeSourceInvalidationService).invalidate({
      projectRef,
      actor: 'u1',
      sourceId: 'copy',
      action: 'replay',
    });
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).not.toContain('UTC'),
    );
    answer = async () => ({ label: 'Demo clock', at: 'yesterday' });
    TestBed.inject(NativeSourceInvalidationService).invalidate({
      projectRef,
      actor: 'u1',
      sourceId: 'copy',
      action: 'reset',
    });
    await vi.waitFor(() => expect(reads).toHaveLength(3));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('UTC');
  });

  it('clears at once on a scope change and drops the late answer of the old scope', async () => {
    setup([clockSource()]);
    let release!: () => void;
    answer = () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ label: 'Demo clock', at: '2018-05-20T10:00:00Z' });
      });
    const fixture = await render();
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    const service = TestBed.inject(BusinessClockService);
    page.actor.set('u2');
    await vi.waitFor(() => expect(reads[0].signal.aborted).toBe(true));
    release();
    await fixture.whenStable();
    expect(service.clocks()).toEqual([]);
    page.ref.set(undefined);
    await fixture.whenStable();
    expect(service.clocks()).toEqual([]);
  });

  it('shows no clock without a signed-in actor, and reads nothing when no source declares one', async () => {
    setup([clockSource()]);
    page.actor.set('');
    page.environment.set(undefined);
    const fixture = await render();
    expect(reads).toHaveLength(0);
    expect(fixture.nativeElement.textContent.trim()).toBe('');
    TestBed.resetTestingModule();
    setup([
      {
        sourceId: 'plain',
        create: () => {
          throw new Error('not used');
        },
      },
    ]);
    await render();
    TestBed.inject(NativeSourceInvalidationService).invalidate({
      projectRef,
      actor: 'u1',
      sourceId: 'plain',
      action: 'reset',
    });
    expect(TestBed.inject(BusinessClockService).clocks()).toEqual([]);
  });

  it('lists several clocks in registration order', async () => {
    setup([clockSource('a'), clockSource('b')]);
    answer = async (scope) => ({
      label: scope.sourceId === 'a' ? 'Demo clock' : 'Business clock',
      at: '2018-05-20T10:00:00Z',
    });
    const fixture = await render();
    await vi.waitFor(() =>
      expect(
        [...fixture.nativeElement.querySelectorAll('.clock')].map(
          (node: HTMLElement) => node.textContent?.split(':')[0].trim(),
        ),
      ).toEqual(['Demo clock', 'Business clock']),
    );
    expect(reads.map((read) => read.scope.environment)).toEqual([
      'demo',
      'demo',
    ]);
  });
});

describe('chip outside the project routes', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('renders an empty live region when no clock service is provided', async () => {
    TestBed.configureTestingModule({
      imports: [BusinessClockChipComponent],
      providers: [provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(BusinessClockChipComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[role="status"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.clock')).toBeNull();
  });
});
