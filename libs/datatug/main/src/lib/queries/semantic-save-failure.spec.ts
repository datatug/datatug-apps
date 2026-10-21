import { signal } from '@angular/core';
import { describe, it, expect, vi } from 'vitest';
import { Subject, throwError } from 'rxjs';
import { QueryPageComponent } from './query/page/query-page.component';
import {
  createSemanticModel,
  rebuildMeaningBindings,
} from './semantic-mapping';
import { QueryType } from '../models/definition/query-def';
import type { IQueryState } from '../editor/models';

describe('mapping failed-save boundary', () => {
  it.each(['failure', 'late failure', 'late copy success', 'late copy after leave'])('preserves source and destination boundaries: %s', async (scenario) => {
    const semanticModel = createSemanticModel({
      queryHash: 'a'.repeat(64),
      resultIndex: 0,
      columns: [{ name: 'InvoiceId', dataType: 'integer' }],
    });
    semanticModel.meaning.concepts = [
      {
        id: 'invoice',
        kind: 'entity',
        labels: { en: 'Invoice' },
        description: 'Invoice',
      },
      {
        id: 'number',
        kind: 'property',
        of: 'invoice',
        labels: { en: 'Number' },
        description: 'Number',
      },
    ];
    semanticModel.bindings = [
      { columnIndex: 0, field: 'column1', concept: 'number' },
    ];
    const original = {
      id: 'device-personal-33333333-3333-3333-3333-333333333333',
      request: { queryType: QueryType.SQL, text: 'SELECT InvoiceId' },
      semanticModel: rebuildMeaningBindings(semanticModel),
    };
    const draft = structuredClone(original.semanticModel);
    draft.meaning.concepts[1].labels.en = 'Rejected draft';
    const queryDef = signal(original);
    const pending = new Subject<never>();
    const harness = {
      semanticMappingLifetime: 0,
    semanticLocalSave: signal(undefined),
      runResult: () => undefined,
      selectedSource: () => undefined,
      project: {
        ref: { storeId: 'github.com', projectId: 'repo@owner@folder' },
      },
      queryDef,
      queryState: {
        id: original.id,
        queryType: QueryType.SQL,
        def: original,
        request: original.request,
      } as IQueryState,
      queriesService: { createQuery: vi.fn(() => pending) },
      semanticSaveToProject: signal(false),
      semanticSaving: signal(false),
      semanticBeforeSave: signal(original.semanticModel),
      semanticError: signal(''),
      semanticDialog: signal(draft),
      queryEditorStateService: {
        updateQueryState: vi.fn((state: IQueryState) => {
          harness.queryState = state;
          if (state.def) queryDef.set(state.def as typeof original);
        }),
        saveQuery: vi.fn(() =>
          scenario === 'failure' ? throwError(() => new Error('Concurrent revision conflict.')) : pending,
        ),
      },
    };
    if (scenario.startsWith('late copy')) {
      harness.queryState = { ...harness.queryState, id: 'public-source', def: { ...original, id: 'public-source' } };
      queryDef.set({ ...original, id: 'public-source' });
    }
    const saving = QueryPageComponent.prototype.saveColumnMeaning.call(
      harness as unknown as QueryPageComponent,
      draft,
    );
    if (scenario !== 'failure') {
      if (scenario === 'late copy after leave') {
        (QueryPageComponent.prototype as unknown as { invalidateSemanticMapping: (this: typeof harness) => void }).invalidateSemanticMapping.call(harness);
      }
      const destination = { ...original, id: scenario === 'late copy after leave' ? 'public-source' : 'destination' };
      harness.queryState = { ...harness.queryState, id: destination.id, def: destination };
      queryDef.set(destination);
      harness.queryEditorStateService.updateQueryState.mockClear();
      if (scenario === 'late failure') pending.error(new Error('Late conflict'));
      else pending.next(undefined as never);
      await saving;
      expect(harness.queryState.def).toBe(destination);
      expect(harness.queryEditorStateService.updateQueryState).not.toHaveBeenCalled();
      expect(harness.semanticError()).toBe('');
      return;
    }
    await saving;
    expect(harness.queryState.def).toEqual(original);
    expect(
      QueryPageComponent.prototype.semanticColumnLabel.call(
        harness as unknown as QueryPageComponent,
        0,
      ),
    ).toBe('Invoice · Number');
    expect(harness.semanticDialog()?.meaning.concepts[1].labels.en).toBe(
      'Rejected draft',
    );
    expect(harness.semanticError()).toContain('revision conflict');
    expect(harness.semanticSaving()).toBe(false);
  });
});
