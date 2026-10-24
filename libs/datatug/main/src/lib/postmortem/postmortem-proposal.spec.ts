import {
  patchProposalDefinition,
  type ProposalFields,
} from './postmortem-proposal';
const fields: ProposalFields = {
  kind: 'check',
  id: 'native',
  title: 'Reviewed',
  description: 'Why',
  connection: 'source',
  queryType: 'SQL',
  queryText: 'SELECT 1 LIMIT 1',
  queryId: 'new-query',
  environment: 'uat',
  checkId: 'check',
  interval: 300,
};
describe('native recommendation adjustments', () => {
  it('preserves all Check steps and nested bindings/validators when changing the first query', () => {
    const original = {
      steps: [
        {
          id: 'one',
          kind: 'query',
          queryId: 'old',
          bindings: [{ input: 'order_id', fromInput: 'order_id' }],
          validators: [{ id: 'non-null' }],
        },
        { id: 'two', kind: 'check', checkId: 'other' },
      ],
      inputs: [{ name: 'order_id', type: 'integer' }],
    };
    const updated = patchProposalDefinition(original, fields);
    expect(updated['steps']).toEqual([
      { ...original.steps[0], queryId: 'new-query' },
      original.steps[1],
    ]);
    expect(updated['inputs']).toEqual(original.inputs);
    expect(original.steps[0].queryId).toBe('old');
  });
  it('preserves query parameters and request options without inventing persistence timestamps', () => {
    const updated = patchProposalDefinition(
      {
        parameters: [{ name: 'order_id' }],
        request: { queryType: 'TugQL', maxRows: 42 },
        folderPath: 'checks',
      },
      { ...fields, kind: 'query', queryType: 'TugQL' },
    );
    expect(updated['request']).toEqual({
      queryType: 'TugQL',
      text: 'SELECT 1 LIMIT 1',
      maxRows: 42,
    });
    expect(updated['parameters']).toEqual([{ name: 'order_id' }]);
    expect(updated).not.toHaveProperty('createdAt');
  });
  it('keeps Watch subscriptions and native source pins while proposing paused execution', () => {
    const updated = patchProposalDefinition(
      {
        sourceRevision: 'pin',
        sourceFingerprint: 'fingerprint',
        checkVersion: '5',
        notificationPolicy: { recovery: true, cooldownSeconds: 180 },
        enabled: true,
        lifecycle: 'enabled',
      },
      { ...fields, kind: 'watch' },
    );
    expect(updated).toMatchObject({
      sourceRevision: 'pin',
      sourceFingerprint: 'fingerprint',
      checkVersion: '5',
      enabled: false,
      lifecycle: 'paused',
      notificationPolicy: { recovery: true, cooldownSeconds: 180 },
      schedule: { intervalSeconds: 300 },
    });
  });
});
