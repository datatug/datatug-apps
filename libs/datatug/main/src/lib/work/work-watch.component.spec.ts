import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { WorkApiService } from './work-api.service';
import { WorkWatchComponent } from './work-watch.component';
import type { WorkWatchPage } from './work-watch.models';
import { workPageFixture } from './work.spec-helper';

describe('WorkWatchComponent authority boundaries', () => {
  const event = {
    id: 'event1',
    namespace: 'team',
    project: 'project',
    environment: 'demo',
    watchId: 'watch1',
    runId: 'run1',
    title: 'Check failure',
    kind: 'trigger' as const,
    outcome: 'fail',
    previous: 'true',
    occurredAt: '2026-10-24T08:00:00Z',
    checkId: 'check1',
  };
  const page = (): WorkWatchPage => ({
    ...workPageFixture(),
    watches: [
      {
        id: 'watch1',
        title: 'Watch',
        version: 1,
        owner: 'lead',
        visibility: 'shared',
        namespace: 'team',
        project: 'project',
        environment: 'demo',
        checkId: 'check1',
        mode: 'continuous',
        lifecycle: 'enabled',
        enabled: true,
      },
    ],
    events: [event],
    linkedItems: [],
    contexts: [],
  });
  function setup() {
    const auth = new BehaviorSubject({
      status: 'authenticated',
      user: { uid: 'lead' },
    });
    const api = { watchEvents: vi.fn(), watchAction: vi.fn(), list: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        { provide: WorkApiService, useValue: api },
      ],
    });
    const fixture = TestBed.createComponent(WorkWatchComponent);
    fixture.componentRef.setInput('project', {
      storeId: 'firestore',
      spaceID: 'space',
      projectId: 'project',
    });
    fixture.componentRef.setInput('watchId', 'watch1');
    return { fixture, api, auth };
  }
  it('renders deferred evidence without a second manual change detection', async () => {
    const { fixture, api } = setup();
    let resolve!: (value: WorkWatchPage) => void;
    api.watchEvents.mockReturnValue(
      new Promise<WorkWatchPage>((done) => (resolve = done)),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Loading authorised');
    resolve(page());
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).toContain('Watch triggered'),
    );
    expect(fixture.nativeElement.textContent).toContain('Create Incident');
  });
  it('clears private preview synchronously on principal change and discards old response', async () => {
    const { fixture, api, auth } = setup();
    let resolve!: (value: WorkWatchPage) => void;
    api.watchEvents.mockReturnValueOnce(
      new Promise<WorkWatchPage>((done) => (resolve = done)),
    );
    api.watchEvents.mockReturnValue(
      new Promise<WorkWatchPage>(() => undefined),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.data.set(page());
    component.choose(event, 'incident');
    auth.next({ status: 'authenticated', user: { uid: 'other' } });
    expect(component.data()).toBeUndefined();
    expect(component.selected()).toBeUndefined();
    resolve(page());
    await fixture.whenStable();
    expect(component.data()).toBeUndefined();
  });
  it('requires explicit personal sharing before a handoff command', async () => {
    const { fixture, api } = setup();
    const personal = page();
    personal.watches[0].visibility = 'personal';
    api.watchEvents.mockResolvedValue(personal);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.choose(event, 'incident');
    await component.create({
      draft: {
        type: 'incident',
        title: 'Check failure',
        priority: 'high',
        severity: 'major',
        environment: 'demo',
      },
      contextScope: { environmentId: 'demo', identityDomain: 'northwind' },
    });
    expect(api.watchAction).not.toHaveBeenCalled();
  });
  it('does not call hosted Work for local projects', async () => {
    const { fixture, api } = setup();
    fixture.componentRef.setInput('project', {
      storeId: 'local',
      projectId: 'project',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.watchEvents).not.toHaveBeenCalled();
  });
  it('retains stale evidence while offline and clears it when access is revoked', async () => {
    const { fixture, api } = setup();
    api.watchEvents.mockResolvedValue(page());
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    api.watchEvents.mockRejectedValue({ status: 503 });
    await component.refresh();
    expect(component.data()).toBeDefined();
    expect(component.stale()).toBe(true);
    api.watchEvents.mockRejectedValue({ status: 403 });
    await component.refresh();
    expect(component.data()).toBeUndefined();
  });
  it('rejects a substituted identity domain before dispatching context creation', async () => {
    const { fixture, api } = setup();
    const data = page();
    data.contexts = [
      {
        eventId: event.id,
        scope: { environmentId: 'demo', identityDomain: 'northwind' },
        entries: [],
        omitted: [],
      },
    ];
    api.watchEvents.mockResolvedValue(data);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.choose(event, 'task');
    await component.create({
      draft: { type: 'task', title: 'Task', priority: 'normal' },
      contextScope: { environmentId: 'demo', identityDomain: 'other' },
    });
    expect(api.watchAction).not.toHaveBeenCalled();
    expect(component.error()).toContain('Watch event environment');
  });
});
