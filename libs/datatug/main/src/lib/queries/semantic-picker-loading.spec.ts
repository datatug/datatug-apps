import { Subject } from 'rxjs';
import { signal } from '@angular/core';
import { describe, it, expect, vi } from 'vitest';
import { QueryPageComponent } from './query/page/query-page.component';
import { createSemanticModel, type SemanticModel } from './semantic-mapping';
import type { SavedMeaningChoice } from './semantic-meaning-reuse';
import { QueryType } from '../models/definition/query-def';
const harness = (list: () => Promise<never[]>) => {
  const basis = {
    queryHash: 'a'.repeat(64),
    resultIndex: 0,
    columns: [{ name: 'ID', dataType: 'integer' }],
  };
  return {
    semanticMappingLifetime: 0,
    semanticLocalSave: signal(undefined),
    semanticBasis: signal(basis),
    project: { ref: { storeId: 'github.com', projectId: 'project' } },
    displayedResultIsPreviousRun: () => false,
    semanticCurrentHash: signal(basis.queryHash),
    semanticNotice: signal(''),
    semanticError: signal(''),
    semanticColumn: signal(0),
    queryDef: () => ({
      id: 'current',
      request: { queryType: QueryType.SQL, text: 'SELECT ID' },
    }),
    queryState: { id: 'current' },
    semanticSaveToProject: signal(false),
    semanticStorage: signal(''),
    semanticSaveLabel: signal(''),
    semanticSavedChoices: signal<readonly SavedMeaningChoice[]>([]),
    semanticChoicesLoading: signal(false),
    semanticChoicesMessage: signal(''),
    semanticDialog: signal<SemanticModel | undefined>(undefined),
    queriesService: { devicePersonal: { list } },
  };
};
describe('saved meaning picker loading lifecycle', () => {
  it('opens immediately and keeps creation available while lookup is pending or fails', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<never[]>((_resolve, rejected) => {
      reject = rejected;
    });
    const state = harness(vi.fn(() => pending));
    await QueryPageComponent.prototype.openColumnMeaning.call(
      state as unknown as QueryPageComponent,
      0,
    );
    const opened = state.semanticDialog();
    expect(opened).toBeDefined();
    expect(state.semanticChoicesLoading()).toBe(true);
    reject(new Error('device read failed'));
    await pending.catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.semanticDialog()).toBe(opened);
    expect(state.semanticChoicesMessage()).toContain('You can still create');
    expect(state.semanticChoicesLoading()).toBe(false);
  });
  it('a cancelled dialog or changed project cannot receive late saved choices', async () => {
    for (const change of ['dialog', 'project']) {
      let resolve!: (queries: never[]) => void;
      const pending = new Promise<never[]>((resolved) => {
        resolve = resolved;
      });
      const state = harness(() => pending);
      await QueryPageComponent.prototype.openColumnMeaning.call(
        state as unknown as QueryPageComponent,
        0,
      );
      const fresh = createSemanticModel(state.semanticBasis());
      if (change === 'dialog') state.semanticDialog.set(fresh);
      else
        state.project = {
          ref: { storeId: 'github.com', projectId: 'another' },
        };
      state.semanticChoicesMessage.set('New dialog state');
      resolve([]);
      await pending;
      await Promise.resolve();
      await Promise.resolve();
      expect(state.semanticChoicesMessage()).toBe('New dialog state');
      if (change === 'dialog') expect(state.semanticDialog()).toBe(fresh);
    }
  });
  it('does not open an old result after delayed capabilities and scope navigation', async () => {
    const capabilities = new Subject<{ querySave: boolean; semanticModel: boolean }>();
    const state = harness(vi.fn(async () => []));
    Object.assign(state.project.ref, { projectApi: 'cloud' });
    Object.assign(state.queriesService, { capabilities: () => capabilities });
    const opening = QueryPageComponent.prototype.openColumnMeaning.call(state as unknown as QueryPageComponent, 0);
    state.queryState = { id: 'destination' };
    capabilities.next({ querySave: true, semanticModel: true });
    await opening;
    expect(state.semanticDialog()).toBeUndefined();
    expect(state.queriesService.devicePersonal.list).not.toHaveBeenCalled();
  });

});
