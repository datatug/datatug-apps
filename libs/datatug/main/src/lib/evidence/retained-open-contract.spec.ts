import fixture from './testdata/backend-v044-retained.json';
import {
  readRetainedCheck,
  readRetainedExecution,
} from './retained-open-contract';
import { readRetainedQueryResponse } from './retained-evidence-contract';
const scope = {
  projectRef: {
    storeId: 'firestore',
    spaceID: 'fixture-space',
    projectId: 'fixture-project',
  },
  environment: 'demo',
  actor: 'another-current-reader',
  nativeDatabaseId: 'fixture-db',
  nativeProjectId: 'fixture-project',
};
const ref = {
  storeId: 'firestore',
  projectId: 'fixture-project',
  environment: 'demo',
  checkId: 'request-received',
  checkVersion: 1,
  runId: 'fixture-run',
};
describe('Actual published Go retained response codecs', () => {
  it('admits the original execution for an independently authorized current reader without relabeling its actor', async () => {
    const view = await readRetainedExecution(
      fixture.execution,
      scope,
      fixture.execution.result.execution,
    );
    expect(view.manifest.actorId).toBe('fixture-actor');
    expect(view.queryId).toBe('shipping/receipt');
    expect(view.manifest.revisionId).toBe('fixture-revision');
    expect(view.result.recordset.rows[0][3]).toEqual({
      type: 'null',
      value: null,
    });
    const run = await readRetainedQueryResponse(
      fixture.query,
      scope,
      'shipping/receipt',
      { incidentRef: 'fixture-incidents/INC-1' },
    );
    expect(run.result.rowEvidence?.recordsetFingerprint).not.toBe(
      run.resultFingerprint,
    );
  });
  it('admits the actual Check definition/version and exact node executions before any Case', async () => {
    const view = await readRetainedCheck(fixture.check, scope, ref);
    expect(view.run.definition.version).toBe(1);
    expect(view.run.caseId).toBeUndefined();
    expect(view.results[0].result.execution?.executionId).toBe(
      'fixture-execution',
    );
    expect(view.results[0].queryId).toBe('shipping/receipt');
  });
  it.each([
    'actor',
    'selected-entry',
    'applied-slot',
    'source',
    'query-folder',
    'input',
    'row-hash',
    'manifest-database',
    'manifest-project',
  ] as const)(
    'rejects %s substitution rather than opening a current-definition fallback',
    async (change) => {
      const value = structuredClone(fixture.execution);
      if (change === 'actor') value.actorId = 'different-executor';
      else if (change === 'selected-entry')
        value.manifest.entries[0].revisionId = 'unselected';
      else if (change === 'applied-slot')
        value.manifest.contextSet.slots[0].bagVersion++;
      else if (change === 'source')
        value.sourcePin.revision.generation = 'reset-generation';
      else if (change === 'query-folder') value.savedQuery.folderPath = 'other';
      else if (change === 'input') value.inputs.order_id.value = '11062';
      else if (change === 'manifest-database')
        value.manifest.session.databaseId = 'other-database';
      else if (change === 'manifest-project')
        value.manifest.session.projectId = 'other-project';
      else value.result.rowEvidence.recordsetFingerprint = 'a'.repeat(64);
      await expect(readRetainedExecution(value, scope)).rejects.toThrow();
    },
  );
  it.each([
    'version',
    'node-fingerprint',
    'node-execution',
    'missing-node',
    'actor',
  ] as const)(
    'rejects Check %s corruption without exposing partial node results',
    async (change) => {
      const value = structuredClone(fixture.check);
      if (change === 'version') value.run.definition.version++;
      else if (change === 'node-fingerprint')
        value.results[0].resultFingerprint = 'a'.repeat(64);
      else if (change === 'node-execution')
        value.results[0].result.execution.executionId = 'unrelated';
      else if (change === 'missing-node') value.results = [];
      else value.run.actor = 'different-executor';
      await expect(readRetainedCheck(value, scope, ref)).rejects.toThrow();
    },
  );
});
