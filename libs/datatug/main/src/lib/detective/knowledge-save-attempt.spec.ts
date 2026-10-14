import { knowledgeSaveAttempt } from './knowledge-save-attempt';

describe('knowledgeSaveAttempt', () => {
  it('reuses the proposal identity after a lost acknowledgment, and changes it when draft or scope changes', () => {
    let issued = 0;
    const newId = () => `proposal-${++issued}`;
    const first = knowledgeSaveAttempt(
      undefined,
      'scope-a/case-1/draft-a',
      newId,
    );
    const retry = knowledgeSaveAttempt(first, 'scope-a/case-1/draft-a', newId);
    const edited = knowledgeSaveAttempt(retry, 'scope-a/case-1/draft-b', newId);
    const switched = knowledgeSaveAttempt(
      edited,
      'scope-b/case-1/draft-b',
      newId,
    );
    expect(retry).toBe(first);
    expect(edited.proposalId).not.toBe(first.proposalId);
    expect(switched.proposalId).not.toBe(edited.proposalId);
    expect(issued).toBe(3);
  });
});
