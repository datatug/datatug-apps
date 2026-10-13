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
    validateSemanticModel(saved);
  });
});
