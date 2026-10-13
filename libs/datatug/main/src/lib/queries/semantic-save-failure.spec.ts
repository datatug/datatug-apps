import { signal } from '@angular/core';
import { describe, it, expect, vi } from 'vitest';
import { throwError } from 'rxjs';
import { QueryPageComponent } from './query/page/query-page.component';
import {
  createSemanticModel,
  rebuildMeaningBindings,
} from './semantic-mapping';
import { QueryType } from '../models/definition/query-def';
import type { IQueryState } from '../editor/models';

describe('mapping failed-save boundary', () => {
  it('retains saved definition and badge while preserving the mapping dialog draft', async () => {
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
    const harness = {
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
          throwError(() => new Error('Concurrent revision conflict.')),
        ),
      },
    };
    await QueryPageComponent.prototype.saveColumnMeaning.call(
      harness as unknown as QueryPageComponent,
      draft,
    );
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
