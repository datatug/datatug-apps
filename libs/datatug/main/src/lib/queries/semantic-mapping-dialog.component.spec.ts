import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { SemanticMappingDialogComponent } from './semantic-mapping-dialog.component';
import {
  createSemanticModel,
  rebuildMeaningBindings,
  validateSemanticModel,
} from './semantic-mapping';
const bundle = () => {
  const model = createSemanticModel({
    queryHash: 'a'.repeat(64),
    resultIndex: 0,
    columns: [
      { name: 'ID', dataType: 'integer' },
      { name: 'OtherID', dataType: 'integer' },
    ],
  });
  model.meaning.concepts = [
    {
      id: 'invoice',
      kind: 'entity',
      labels: { en: 'Invoice' },
      description: 'Invoice',
    },
    {
      id: 'number',
      kind: 'property',
      labels: { en: 'Number' },
      description: 'Invoice number',
      of: 'invoice',
    },
  ];
  model.bindings = [
    { columnIndex: 0, field: 'column1', concept: 'number' },
    { columnIndex: 1, field: 'column2', concept: 'number' },
  ];
  return rebuildMeaningBindings(model);
};
describe('meaning dialog review and shared definitions', () => {
  it('prevents stale Remove from reconfirming another mapping', () => {
    TestBed.configureTestingModule({
      imports: [SemanticMappingDialogComponent],
    });
    const fixture = TestBed.createComponent(SemanticMappingDialogComponent);
    fixture.componentRef.setInput('bundle', bundle());
    fixture.componentRef.setInput('needsReview', true);
    fixture.detectChanges();
    const component = fixture.componentInstance,
      emit = vi.spyOn(component.save, 'emit');
    component.remove();
    expect(emit).not.toHaveBeenCalled();
    component.reviewed.set(true);
    component.remove();
    const saved = emit.mock.calls[0][0];
    expect(saved.bindings).toHaveLength(1);
    expect(saved.meaning.concepts).toHaveLength(2);
    validateSemanticModel(saved);
  });
  it('editing a reused property updates one definition and all output bindings', () => {
    TestBed.configureTestingModule({
      imports: [SemanticMappingDialogComponent],
    });
    const fixture = TestBed.createComponent(SemanticMappingDialogComponent);
    fixture.componentRef.setInput('bundle', bundle());
    fixture.detectChanges();
    const component = fixture.componentInstance,
      emit = vi.spyOn(component.save, 'emit');
    component.propertyName.set('Reference');
    component.role.set('Billing');
    component.submit();
    const saved = emit.mock.calls[0][0];
    expect(saved.bindings.map((binding) => binding.concept)).toEqual([
      'number',
      'number',
    ]);
    expect(
      saved.meaning.concepts.find((concept) => concept.id === 'number')?.labels
        .en,
    ).toBe('Reference');
    expect(
      saved.bindings.find((binding) => binding.columnIndex === 0)?.role,
    ).toBe('Billing');
    validateSemanticModel(saved);
  });
});

describe('saved property picker draft isolation', () => {
  it('selects a saved property into the draft only; editing/cancel cannot mutate the input or source', () => {
    TestBed.configureTestingModule({
      imports: [SemanticMappingDialogComponent],
    });
    const fixture = TestBed.createComponent(SemanticMappingDialogComponent),
      original = bundle();
    const empty = createSemanticModel(original.basis);
    const choice = {
      key: 'saved:source:number',
      sourceQueryId: 'source',
      sourceTitle: 'Invoices',
      entity: original.meaning.concepts[0],
      property: original.meaning.concepts[1],
    };
    fixture.componentRef.setInput('bundle', empty);
    fixture.componentRef.setInput('savedChoices', [choice]);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.chooseProperty(choice.key);
    component.propertyName.set('Changed here');
    const emit = vi.spyOn(component.save, 'emit');
    component.submit();
    expect(
      emit.mock.calls[0][0].meaning.concepts.find((c) => c.id === 'number')
        ?.labels.en,
    ).toBe('Changed here');
    expect(original.meaning.concepts[1].labels.en).toBe('Number');
    expect(empty.meaning.concepts).toEqual([]);
    fixture.componentRef.setInput('bundle', undefined);
    fixture.detectChanges();
    expect(component.draft()).toBeUndefined();
  });
});
