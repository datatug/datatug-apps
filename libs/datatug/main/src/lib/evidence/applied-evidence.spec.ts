import {
  appliedEvidenceChoices,
  requireAppliedInputMatch,
} from './applied-evidence';
import {
  appliedCapabilities,
  appliedSnapshot,
  scope,
} from './applied-context.spec-helper';
describe('Explicit native applied evidence selection', () => {
  it('selects the actual applied revision even when a newer unapplied draft exists, without creating a Case', () => {
    const choices = appliedEvidenceChoices(
      appliedCapabilities,
      appliedSnapshot(),
      'demo',
      'incidents/INC-1',
    );
    expect(choices).toHaveLength(1);
    expect(choices[0].evidence).toEqual({
      retention: 'project-pinned',
      incidentRef: 'incidents/INC-1',
      context: {
        sessionId: 'session',
        expectedSessionVersion: 3,
        expectedContextSetId: 'set',
        scope,
        bindings: [
          { inputName: 'order_id', entryId: 'entry', revisionId: 'applied' },
        ],
      },
    });
    expect(() =>
      requireAppliedInputMatch(choices[0], {
        order_id: { type: 'integer', value: '11045' },
      }),
    ).not.toThrow();
    expect(() =>
      requireAppliedInputMatch(choices[0], {
        order_id: { type: 'integer', value: '11062' },
      }),
    ).toThrow(/differs/);
  });

  it('keeps two same-order Sessions as explicit distinct selection requests',()=>{
    const one=appliedSnapshot(),snapshot=appliedSnapshot(),two={...snapshot,session:{...snapshot.session,id:'second-session'}};
    const a=appliedEvidenceChoices(appliedCapabilities,one,'demo','incidents/INC-1')[0];
    const b=appliedEvidenceChoices(appliedCapabilities,two,'demo','incidents/INC-1')[0];
    expect(a.value).toEqual(b.value);
    expect(a.evidence.context.sessionId).not.toBe(b.evidence.context.sessionId);
  });
  it.each([
    'disabled',
    'generation',
    'bag-revision',
    'actor',
    'missing-applied',
  ] as const)(
    'refuses %s context rather than using a draft fallback',
    (change) => {
      const snapshot = appliedSnapshot();
      const changed =
        change === 'disabled'
          ? {
              ...snapshot,
              contextSet: { ...snapshot.contextSet, enabled: false },
            }
          : change === 'generation'
            ? {
                ...snapshot,
                bags: snapshot.bags.map((bag) => ({
                  ...bag,
                  scope: { ...scope, identityDomain: 'shipping:g2' },
                })),
              }
            : change === 'bag-revision'
              ? {
                  ...snapshot,
                  bags: snapshot.bags.map((bag) => ({ ...bag, version: 3 })),
                }
              : change === 'actor'
                ? {
                    ...snapshot,
                    session: { ...snapshot.session, owner: 'maya' },
                  }
                : { ...snapshot, revisions: [] };
      expect(
        appliedEvidenceChoices(
          appliedCapabilities,
          changed,
          'demo',
          'incidents/INC-1',
        ),
      ).toEqual([]);
    },
  );
});
