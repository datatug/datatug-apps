import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import goldens from '../../models/definition/environment-receipts.golden.json';
import {
  EnvironmentOperationRecoveryService,
  PendingEnvironmentOperation,
} from './environment-operation-recovery.service';

const original = {
  version: 1,
  actor: 'actor-A',
  project: { storeId: 'http-localhost:18990', projectId: 'p' },
  before: goldens[0].before,
  request: goldens[0].request,
  attempts: 0,
} as unknown as PendingEnvironmentOperation;
describe('durable environment recovery', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    TestBed.configureTestingModule({});
  });
  it('survives service recreation, preserves exact operation, and isolates actor/full scope', async () => {
    const first = TestBed.inject(EnvironmentOperationRecoveryService);
    await first.reserve(original);
    const second = TestBed.runInInjectionContext(
      () => new EnvironmentOperationRecoveryService(),
    );
    expect(await second.read(original.actor, original.project)).toEqual(
      original,
    );
    await expect(second.read('actor-B', original.project)).rejects.toThrow(
      'another actor',
    );
    expect(
      await second.read(original.actor, {
        ...original.project,
        branch: 'other',
      }),
    ).toBeUndefined();
    const attemptOne = await first.attempt(original),
      attemptTwo = await second.attempt(original);
    expect(attemptOne.attempts).toBe(1);
    expect(attemptTwo.attempts).toBe(2);
    await expect(
      first.reserve({ ...attemptOne, definitiveRejection: true }),
    ).rejects.toThrow('another tab');
    expect(
      (await second.read(original.actor, original.project))?.attempts,
    ).toBe(2);
    await second.remove(attemptTwo);
    expect(await first.read(original.actor, original.project)).toBeUndefined();
  });
});
