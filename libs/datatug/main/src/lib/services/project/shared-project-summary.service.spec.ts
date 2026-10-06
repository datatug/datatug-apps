import { TestBed } from '@angular/core/testing';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, Subject } from 'rxjs';
import { SharedProjectSummaryService } from './shared-project-summary.service';
import { DatatugStoreFirestoreService } from '../repo/datatug-store.service.firestore';
import { IProjectSummary } from '../../models/definition/project';

describe('shared metadata auth and scope isolation', () => {
  const a = { storeId: 'firestore', spaceID: 'S1', projectId: 'same' };
  const b = { ...a, spaceID: 'S2' };
  let auth: BehaviorSubject<{
    status: string;
    user: { uid: string; providerId?: string } | null;
  }>;
  let streams: Subject<IProjectSummary | undefined>[];
  let read: ReturnType<typeof vi.fn>;
  let service: SharedProjectSummaryService;
  beforeEach(() => {
    auth = new BehaviorSubject<{
      status: string;
      user: { uid: string; providerId?: string } | null;
    }>({
      status: 'authenticated',
      user: { uid: 'alice', providerId: 'google.com' },
    });
    streams = [];
    read = vi.fn(() => {
      const s = new Subject<IProjectSummary | undefined>();
      streams.push(s);
      return s;
    });
    TestBed.configureTestingModule({
      providers: [
        SharedProjectSummaryService,
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: DatatugStoreFirestoreService,
          useValue: { getSharedProjectSummary: read },
        },
      ],
    });
    service = TestBed.inject(SharedProjectSummaryService);
  });
  it('keeps same-ID Space watches separate and shares only the exact scope', () => {
    const av: unknown[] = [],
      bv: unknown[] = [];
    service.watch(a).subscribe((v) => av.push(v));
    service.watch(a).subscribe();
    service.watch(b).subscribe((v) => bv.push(v));
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls).toEqual([[a], [b]]);
    streams[1].next({ id: 'same', title: 'B', access: 'protected' });
    streams[0].next({ id: 'same', title: 'A', access: 'protected' });
    expect(av.at(-1)).toMatchObject({ title: 'A' });
    expect(bv.at(-1)).toMatchObject({ title: 'B' });
  });
  it('clears and cancels old reads at sign-out, rejects late delivery, then rereads on sign-in', () => {
    const values: unknown[] = [];
    service.watch(a).subscribe((v) => values.push(v));
    streams[0].next({ id: 'same', title: 'A', access: 'protected' });
    auth.next({ status: 'notAuthenticated', user: null });
    expect(values.at(-1)).toBeUndefined();
    streams[0].next({ id: 'same', title: 'late secret', access: 'protected' });
    expect(values.at(-1)).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    auth.next({ status: 'authenticated', user: { uid: 'bob' } });
    expect(read).toHaveBeenCalledTimes(2);
    expect(values.at(-1)).toBeUndefined();
  });
  it('same UID provider/session transition clears metadata and starts a fresh rules read', () => {
    const values: unknown[] = [];
    service.watch(a).subscribe((v) => values.push(v));
    streams[0].next({ id: 'same', title: 'A', access: 'protected' });
    auth.next({
      status: 'authenticated',
      user: { uid: 'alice', providerId: 'github.com' },
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(values.at(-1)).toBeUndefined();
    streams[0].next({ id: 'same', title: 'old session', access: 'protected' });
    expect(values.at(-1)).toBeUndefined();
  });
  it('permission failure clears metadata without poisoning future authenticated reads', () => {
    const values: unknown[] = [];
    service.watch(a).subscribe((v) => values.push(v));
    streams[0].next({ id: 'same', title: 'A', access: 'protected' });
    streams[0].error({ code: 'permission-denied' });
    expect(values.at(-1)).toBeUndefined();
    auth.next({ status: 'authenticated', user: { uid: 'alice' } });
    expect(read).toHaveBeenCalledTimes(2);
    streams[1].next({
      id: 'same',
      title: 'Allowed again',
      access: 'protected',
    });
    expect(values.at(-1)).toMatchObject({ title: 'Allowed again' });
  });
  it('releases the watch and retained replay when the last subscriber leaves', () => {
    const s = service.watch(a).subscribe();
    streams[0].next({ id: 'same', title: 'Old', access: 'protected' });
    s.unsubscribe();
    expect(streams[0].observed).toBe(false);
    const values: unknown[] = [];
    service.watch(a).subscribe((v) => values.push(v));
    expect(read).toHaveBeenCalledTimes(2);
    expect(values).toEqual([undefined]);
  });
  it.each([
    { ...a, spaceID: '' },
    { ...a, spaceID: '../S1' },
    { ...a, storeId: 'github.com' },
  ])('rejects malformed shared ref before reads', (ref) => {
    let error: unknown;
    service.watch(ref).subscribe({ error: (e) => (error = e) });
    expect(error).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });
});
