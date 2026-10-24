import {
  draftFromWork,
  workOverdue,
  workScopeKey,
  workError,
} from './work.models';
import { workFixture } from './work.spec-helper';
import { localDateInput } from './work-form.component';
describe('Work presentation rules', () => {
  it('distinguishes an existing-project migration gate from a stale-write conflict', () => {
    expect(
      workError({
        status: 409,
        error: { error: { code: 'work_migration_required' } },
      }),
    ).toContain('Ask your project owner to complete the Work migration');
    expect(
      workError({ status: 409, error: { error: { code: 'work_conflict' } } }),
    ).toContain('changed elsewhere');
  });
  it('marks only unfinished work strictly past its deadline overdue', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(
      workOverdue(workFixture({ dueAt: '2026-10-23T11:59:59Z' }), now),
    ).toBe(true);
    for (const lifecycle of ['done', 'archived'] as const)
      expect(
        workOverdue(
          workFixture({ lifecycle, dueAt: '2026-01-01T00:00:00Z' }),
          now,
        ),
      ).toBe(false);
    expect(
      workOverdue(workFixture({ dueAt: '2026-10-23T12:00:00Z' }), now),
    ).toBe(false);
    expect(workOverdue(workFixture(), now)).toBe(false);
  });
  it('does not turn current server metadata into editable fields', () => {
    const draft = draftFromWork(workFixture());
    expect(draft).not.toHaveProperty('version');
    expect(draft).not.toHaveProperty('contextSessionId');
    draft.assigneeIds?.push('other');
    expect(workFixture().assigneeIds).toEqual(['developer']);
  });
  it('keeps project and Space identity distinct', () =>
    expect(workScopeKey({ spaceID: 'a', projectID: 'bc' })).not.toBe(
      workScopeKey({ spaceID: 'ab', projectID: 'c' }),
    ));
  it('roundtrips a due instant through the local date control', () => {
    const date = '2026-10-23T12:30:00.000Z';
    expect(new Date(localDateInput(date)).toISOString()).toBe(date);
    expect(localDateInput('invalid')).toBe('');
  });
});
