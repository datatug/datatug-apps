import { RetainedRunIntent } from './run-intent';
describe('Retained operation journal', () => {
  beforeEach(() => sessionStorage.clear());
  it('recovers the exact original operation after lost response/remount without storing protected inputs', async () => {
    const payload = {
      inputs: { order_id: { type: 'integer', value: '11045' } },
      evidence: {
        context: {
          sessionId: 'private-session',
          bindings: [{ entryId: 'private-entry', revisionId: 'revision' }],
        },
      },
    };
    const first = new RetainedRunIntent();
    const accepted = await first.prepare('sarah/project/demo', payload);
    expect(await first.prepare('sarah/project/demo', payload)).toEqual(
      accepted,
    );
    const disk = JSON.stringify(
      Array.from({ length: sessionStorage.length }, (_, i) => {
        const key = sessionStorage.key(i) || '';
        return [key, sessionStorage.getItem(key)];
      }),
    );
    expect(disk).not.toContain('11045');
    expect(disk).not.toContain('private-session');
    expect(disk).not.toContain('private-entry');
    const remount = new RetainedRunIntent();
    expect(
      (await remount.prepare('sarah/project/demo', payload)).operationId,
    ).toBe(accepted.operationId);
    remount.confirm();
    expect(
      (await remount.prepare('sarah/project/demo', payload)).operationId,
    ).not.toBe(accepted.operationId);
  });
  it('refuses changed uncertain payload until explicit reviewed abandonment, and isolates other actors', async () => {
    const journal = new RetainedRunIntent();
    const first = await journal.prepare('sarah/project/demo', {
      value: '11045',
    });
    await expect(
      journal.prepare('sarah/project/demo', { value: '11062' }),
    ).rejects.toThrow(/previous run/);
    journal.abandonReviewed();
    expect(
      (await journal.prepare('sarah/project/demo', { value: '11062' }))
        .operationId,
    ).not.toBe(first.operationId);
    const other = await new RetainedRunIntent().prepare('maya/project/demo', {
      value: '11045',
    });
    expect(other.operationId).not.toBe(first.operationId);
  });
  it('blocks a conflicted mutation until explicit reviewed abandonment', async () => {
    const journal = new RetainedRunIntent();
    await journal.prepare('sarah/project/demo', { value: '11045' });
    journal.rejectConflict({ status: 409 });
    await expect(
      journal.prepare('sarah/project/demo', { value: '11045' }),
    ).rejects.toThrow(/explicitly abandon/);
    const remount = new RetainedRunIntent();
    await expect(
      remount.prepare('sarah/project/demo', { value: '11045' }),
    ).rejects.toThrow(/explicitly abandon/);
    expect(remount.hasPending).toBe(true);
    remount.abandonReviewed();
    journal.abandonReviewed();
    await expect(
      journal.prepare('sarah/project/demo', { value: '11045' }),
    ).resolves.toHaveProperty('operationId');
  });
  it('does not restore held content or journal an intent after synchronous scope cancellation during digest', async () => {
    const journal = new RetainedRunIntent();
    const preparing = journal.prepare('sarah/project/demo', { value: '11045' });
    journal.clearHeld();
    await expect(preparing).rejects.toThrow(/scope changed/);
    expect(sessionStorage.length).toBe(0);
  });
});
