import {
  admittedMessagePresentation,
  isPendingIncidentMessage,
  isIncidentNotePresentation,
} from './incident-message-presentation';

describe('Incident presentation boundary validation', () => {
  const available = {
    status: 'available',
    kind: 'demo-character',
    characterIds: ['sarah', 'maya', 'daniel'],
  };
  it('accepts only the complete canonical advertisement without authority metadata', () => {
    expect(admittedMessagePresentation(available)?.status).toBe('available');
    for (const value of [
      undefined,
      null,
      {},
      { ...available, actorId: 'other' },
      { ...available, characterIds: ['maya', 'sarah', 'daniel'] },
      { ...available, characterIds: ['sarah', 'maya'] },
      { ...available, characterIds: ['sarah', 'maya', 'maya'] },
      { status: 'not-eligible', characterIds: available.characterIds },
    ])
      expect(admittedMessagePresentation(value)).toBeUndefined();
    expect(admittedMessagePresentation({ status: 'not-eligible' })).toEqual({
      status: 'not-eligible',
    });
  });
  it('keeps compatible legacy operation IDs and rejects unsafe or overlong stored attempts without rewriting them', () => {
    const pending = { expectedSeq: 1, message: { body: 'Original message' } };
    for (const operationId of [
      'operation-legacy_ABC-123',
      'operation-',
      'operation-' + 'a'.repeat(118),
    ]) {
      expect(isPendingIncidentMessage({ ...pending, operationId })).toBe(true);
    }
    for (const operationId of [
      'operation-/bad',
      'operation-a.b',
      'operation- bad',
      'operation-é',
      'operation-a\n',
      'operation-' + 'a'.repeat(119),
      'legacy-valid_123',
    ]) {
      const serialized = JSON.stringify({ ...pending, operationId });
      const restored: unknown = JSON.parse(serialized);
      expect(isPendingIncidentMessage(restored)).toBe(false);
      // Invalid stored attempts reach the existing blocked/reviewed-abandonment
      // branch; validation must never sanitize them into dispatchable retries.
      expect(JSON.stringify(restored)).toBe(serialized);
    }
  });
  it('validates stored pending shapes without coercing optional refs or changing payloads', () => {
    const pending = {
      operationId: 'operation-original',
      expectedSeq: 1,
      message: { body: 'Where is the assignment?' },
    };
    const original = JSON.stringify(pending);
    expect(isPendingIncidentMessage(pending)).toBe(true);
    expect(JSON.stringify(pending)).toBe(original);
    expect('refs' in pending.message).toBe(false);
    for (const characterId of ['sarah', 'maya', 'daniel'])
      expect(
        isPendingIncidentMessage({
          ...pending,
          message: {
            ...pending.message,
            presentation: { kind: 'demo-character', characterId },
          },
        }),
      ).toBe(true);
    for (const message of [
      { body: ' ' },
      { body: '🙂'.repeat(1001) },
      { body: 'text', actor: { id: 'other' } },
      {
        body: 'text',
        presentation: { kind: 'demo-character', characterId: 'Maya' },
      },
      {
        body: 'text',
        presentation: {
          kind: 'demo-character',
          characterId: 'maya',
          uid: 'other',
        },
      },
      { body: 'text', refs: null },
      {
        body: 'text',
        refs: [
          {
            kind: 'execution',
            execution: { storeId: 'firestore', projectId: 'p' },
          },
        ],
      },
      { body: 'text', assertion: 'deterministic-result' },
    ])
      expect(isPendingIncidentMessage({ ...pending, message })).toBe(false);
    expect(isPendingIncidentMessage({ ...pending, actorId: 'other' })).toBe(
      false,
    );
    expect(
      isIncidentNotePresentation({
        kind: 'demo-character',
        characterId: 'daniel',
      }),
    ).toBe(true);
    expect(
      isIncidentNotePresentation({
        kind: 'demo-character',
        characterId: 'daniel',
        name: 'Admin',
      }),
    ).toBe(false);
  });
});
