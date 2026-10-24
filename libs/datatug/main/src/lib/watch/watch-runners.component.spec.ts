import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { WatchRunnersComponent } from './watch-runners.component';
import { WatchClientService } from './watch-client.service';
import type { WatchIdentity, WatchRunnerEnrollment } from './watch.models';

const user: WatchIdentity = {
  id: 'alice',
  hosted: true,
  spaceID: 's',
  namespace: 's',
  project: 'p',
  environment: 'dev',
  canManageRunners: true,
  sharedEditor: true,
  tier: 'free',
  channels: { in_app: true, email: true, sms: false, telegram: false },
  limits: { emailPerDay: 50, smsPerDay: 10 },
};
const enrollment: WatchRunnerEnrollment = {
  id: 'runner-one',
  scope: { namespace: 's', project: 'p', environment: 'dev' },
  ownerId: 'alice',
  sourceIDs: ['source-one'],
  capabilities: [],
  revision: 3,
  revoked: false,
  createdAt: '2026-10-24T00:00:00Z',
  updatedAt: '2026-10-24T00:00:00Z',
  expiresAt: '2026-11-23T00:00:00Z',
};
describe('Scoped runner enrollment consent and credentials', () => {
  const client = {
    identity: signal<WatchIdentity | undefined>(user),
    enrollments: vi.fn(),
    sources: vi.fn(),
    enroll: vi.fn(),
    rotate: vi.fn(),
    revoke: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    client.identity.set(user);
    client.enrollments.mockResolvedValue({ enrollments: [enrollment] });
    client.sources.mockResolvedValue({
      sources: [{ id: 'source-one', kind: 'native', database: 'demo' }],
    });
    client.enroll.mockResolvedValue({
      enrollment,
      token: 'one-time-test-token',
    });
    client.rotate.mockResolvedValue({
      enrollment: { ...enrollment, revision: 4 },
      token: 'rotated-test-token',
    });
    client.revoke.mockResolvedValue({ ok: true });
  });
  async function mount(identity = user) {
    TestBed.configureTestingModule({
      imports: [WatchRunnersComponent],
      providers: [{ provide: WatchClientService, useValue: client }],
    }).overrideComponent(WatchRunnersComponent, {
      set: { imports: [DatePipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(WatchRunnersComponent);
    fixture.componentRef.setInput('identity', identity);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  it('requires the explicit server management grant rather than shared-editor rights', async () => {
    const noGrant = { ...user, canManageRunners: false };
    client.identity.set(noGrant);
    await mount(noGrant);
    expect(client.enrollments).not.toHaveBeenCalled();
    expect(client.sources).not.toHaveBeenCalled();
  });
  it('creates only from selected admitted source IDs and clears the one-time credential on dismiss', async () => {
    const fixture = await mount();
    await vi.waitFor(() => expect(client.sources).toHaveBeenCalled());
    await fixture.whenStable();
    const component = fixture.componentInstance as unknown as {
      start: () => void;
      create: () => Promise<void>;
      sourceIDs: ReturnType<typeof signal<string[]>>;
      token: ReturnType<typeof signal<string>>;
    };
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    component.start();
    component.sourceIDs.set(['foreign']);
    await component.create();
    expect(client.enroll).not.toHaveBeenCalled();
    component.sourceIDs.set(['source-one']);
    await component.create();
    expect(client.enroll.mock.calls[0][0]).toEqual({
      operationId: expect.any(String),
      capabilities: [],
      sourceIDs: ['source-one'],
    });
    expect(component.token()).toBe('one-time-test-token');
    expect(storage).not.toHaveBeenCalled();
    component.token.set('');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain(
      'one-time-test-token',
    );
    storage.mockRestore();
  });
  it('discards a credential returned after switching accounts', async () => {
    const fixture = await mount();
    await vi.waitFor(() => expect(client.sources).toHaveBeenCalled());
    await fixture.whenStable();
    let finish!: (result: {
      enrollment: WatchRunnerEnrollment;
      token: string;
    }) => void;
    client.enroll.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const component = fixture.componentInstance as unknown as {
      start: () => void;
      create: () => Promise<void>;
      sourceIDs: ReturnType<typeof signal<string[]>>;
      token: () => string;
    };
    component.start();
    component.sourceIDs.set(['source-one']);
    const pending = component.create();
    const bob = { ...user, id: 'bob' };
    client.identity.set(bob);
    fixture.componentRef.setInput('identity', bob);
    await fixture.whenStable();
    finish({ enrollment, token: 'old-alice-credential' });
    await pending;
    expect(component.token()).toBe('');
  });
  it('requires review before revocation and sends the observed revision', async () => {
    const fixture = await mount();
    await fixture.whenStable();
    const component = fixture.componentInstance as unknown as {
      review: ReturnType<
        typeof signal<
          { item: WatchRunnerEnrollment; action: 'revoke' } | undefined
        >
      >;
      confirm: () => Promise<void>;
    };
    await component.confirm();
    expect(client.revoke).not.toHaveBeenCalled();
    component.review.set({ item: enrollment, action: 'revoke' });
    await component.confirm();
    expect(client.revoke).toHaveBeenCalledWith(enrollment);
  });
  it('loads later active enrollments after 20 expired history rows and fences a late next page', async () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      ...enrollment,
      id: `history-${index}`,
      expiresAt: '2000-01-01T00:00:00Z',
    }));
    client.enrollments.mockResolvedValueOnce({
      enrollments: history,
      next: 'history-19',
    });
    const fixture = await mount();
    await vi.waitFor(() => expect(client.enrollments).toHaveBeenCalled());
    await fixture.whenStable();
    const component = fixture.componentInstance as unknown as {
      loadMore: () => Promise<void>;
      items: () => WatchRunnerEnrollment[];
      next: () => string;
    };
    expect(fixture.nativeElement.textContent).toContain('Expired');
    expect(component.items()).toHaveLength(20);
    client.enrollments.mockResolvedValueOnce({ enrollments: [enrollment] });
    await component.loadMore();
    expect(client.enrollments).toHaveBeenLastCalledWith('history-19');
    expect(component.items()).toHaveLength(21);
    expect(component.next()).toBe('');
    client.enrollments.mockResolvedValueOnce({
      enrollments: history,
      next: 'history-19',
    });
    await (
      fixture.componentInstance as unknown as { refresh: () => Promise<void> }
    ).refresh();
    let finish!: (value: { enrollments: WatchRunnerEnrollment[] }) => void;
    client.enrollments.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const pending = component.loadMore();
    client.enrollments.mockResolvedValue({ enrollments: [] });
    const bob = { ...user, id: 'bob' };
    client.identity.set(bob);
    fixture.componentRef.setInput('identity', bob);
    await fixture.whenStable();
    finish({ enrollments: [enrollment] });
    await pending;
    expect(component.items().some((item) => item.id === enrollment.id)).toBe(
      false,
    );
  });
});
