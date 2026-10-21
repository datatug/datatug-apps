import { heldRowSelectors } from './held-row-evidence.component';
import {
  heldEvidenceIdentity,
  readRetainedQueryResponse,
} from './retained-evidence-contract';
import fixture from './testdata/backend-v044-retained.json';
const scope = {
  projectRef: {
    storeId: 'firestore',
    spaceID: 'fixture-space',
    projectId: 'fixture-project',
  },
  environment: 'demo',
  actor: 'current-reader',
};
describe('Exact held table row evidence selection', () => {
  it('uses the authenticated response identity and the exact original row key/slot without altering NULL business cells', async () => {
    const response = await readRetainedQueryResponse(
        fixture.query,
        scope,
        'shipping/receipt',
      ),
      identity = heldEvidenceIdentity(response, scope);
    if (!identity) throw new Error('Expected actual provider identity');
    const choices = await heldRowSelectors(response.result, identity);
    expect(choices).toHaveLength(1);
    expect(choices[0].selector).toEqual(fixture.selector);
    expect(response.result.recordset.rows[0][3]).toEqual({
      type: 'null',
      value: null,
    });
  });
  it.each(['generation', 'scope', 'execution', 'incomplete'] as const)(
    'rejects %s mismatch before returning any available row selector',
    async (change) => {
      const response = await readRetainedQueryResponse(
          fixture.query,
          scope,
          'shipping/receipt',
        ),
        identity = heldEvidenceIdentity(response, scope);
      if (!identity) throw new Error('Expected provider identity');
      const invalid = { ...identity };
      if (change === 'generation')
        invalid.source = { ...invalid.source, generation: 'reset' };
      else if (change === 'scope')
        invalid.scope = { ...invalid.scope, environment: 'other' };
      else if (change === 'execution')
        invalid.execution = {
          storeId: 'firestore',
          projectId: 'fixture-project',
          executionId: 'other',
        };
      else invalid.complete = false;
      await expect(heldRowSelectors(response.result, invalid)).rejects.toThrow(
        /identity/,
      );
    },
  );
});
