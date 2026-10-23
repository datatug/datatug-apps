import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { ChartSourceEdit, ChartWidgetDef } from '@datatug/board-models';
import { ChartSourceEditorComponent } from './chart-source-editor.component';

const definition: ChartWidgetDef = {
  sources: [{ id: 'northwind', queryId: 'demo/n' }],
  chart: {
    type: 'bar',
    categoryColumn: 'country',
    valueColumn: 'customers',
    unit: 'customer records',
  },
};
async function editor(): Promise<ComponentFixture<ChartSourceEditorComponent>> {
  await TestBed.configureTestingModule({
    imports: [ChartSourceEditorComponent],
  }).compileComponents();
  const fixture = TestBed.createComponent(ChartSourceEditorComponent);
  fixture.componentRef.setInput('definition', definition);
  fixture.componentRef.setInput('queries', [
    { id: 'demo/n' },
    { id: 'demo/c', title: 'Chinook customers', sourceId: 'chinook' },
  ]);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}
describe('ordinary source editor', () => {
  it('requires explicit common-unit confirmation and emits the canonical binding identity through the shared action', async () => {
    const fixture = await editor(),
      actions: ChartSourceEdit[] = [];
    fixture.componentInstance.edit.subscribe((action) => actions.push(action));
    fixture.componentInstance.choose('demo/c');
    fixture.componentInstance.add();
    expect(actions).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain(
      'Declared unit: customer records',
    );
    fixture.componentInstance.confirmed.set(true);
    fixture.componentRef.setInput('queries', [
      { id: 'demo/n' },
      { id: 'demo/c', title: 'Chinook customers', sourceId: 'chinook' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.queryId()).toBe('demo/c');
    expect(fixture.componentInstance.confirmed()).toBe(true);
    fixture.componentInstance.add();
    expect(actions).toEqual([
      { type: 'add-chart-source', sourceId: 'chinook', queryId: 'demo/c' },
    ]);
    fixture.componentInstance.choose('demo/n');
    expect(fixture.componentInstance.confirmed()).toBe(false);
    fixture.componentInstance.confirmed.set(true);
    fixture.componentInstance.add();
    expect(actions).toHaveLength(1);
    expect(fixture.componentInstance.error()).toContain('already');
  });
  it('explains incompatible chart kinds and never removes the last source or edits while disabled', async () => {
    const fixture = await editor(),
      actions: ChartSourceEdit[] = [];
    fixture.componentInstance.edit.subscribe((action) => actions.push(action));
    fixture.componentInstance.remove('northwind');
    expect(actions).toEqual([]);
    expect(fixture.componentInstance.error()).toContain('at least one');
    fixture.componentRef.setInput('disabled', true);
    fixture.componentInstance.choose('demo/c');
    fixture.componentInstance.confirmed.set(true);
    fixture.componentInstance.add();
    expect(actions).toEqual([]);
    fixture.componentRef.setInput('definition', {
      ...definition,
      chart: { ...definition.chart, unit: undefined },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'Independent sources require a plain bar chart with a declared common unit',
    );
  });
});
