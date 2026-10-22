import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { BoardWidget, CardParameterDef } from '@datatug/board-models';
import { QueriesService } from '../queries/queries.service';
import { CardParametersEditorComponent } from './card-parameters-editor.component';
import {
  CardQueryChoice,
  CardWidgetEditorComponent,
} from './card-widget-editor.component';

@Component({
  imports: [CardParametersEditorComponent],
  template: `<sneat-datatug-card-parameters-editor
    [parameters]="parameters()"
    [disabled]="disabled()"
    (parametersChange)="changes.push($event); parameters.set($event)"
  />`,
})
class ParametersHost {
  parameters = signal<CardParameterDef[]>([]);
  disabled = signal(false);
  changes: CardParameterDef[][] = [];
}

const fire = (el: Element, event: string, value: unknown) =>
  el.dispatchEvent(new CustomEvent(event, { detail: { value, checked: value } }));

describe('CardParametersEditorComponent', () => {
  let fixture: ComponentFixture<ParametersHost>;
  let host: ParametersHost;
  const q = (s: string) => fixture.nativeElement.querySelector(s) as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ParametersHost] }).compileComponents();
    fixture = TestBed.createComponent(ParametersHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('adds a required text input with a free name', async () => {
    q('[data-action="add-parameter"]').click();
    await settle();
    q('[data-action="add-parameter"]').click();
    await settle();
    expect(host.parameters().map((p) => p.id)).toEqual(['input1', 'input2']);
    expect(host.parameters()[0]).toEqual({
      id: 'input1',
      type: 'string',
      isRequired: true,
      match: [],
    });
  });

  it('edits name, label, default, required and type; supplied rows lose default and rules', async () => {
    host.parameters.set([{ id: 'a', type: 'integer', match: [{ column: 'A' }] }]);
    await settle();
    fire(q('[data-field="id"]'), 'ionInput', 'customerId');
    await settle();
    fire(q('[data-field="title"]'), 'ionInput', 'Customer');
    await settle();
    fire(q('[data-field="default"]'), 'ionInput', '7');
    await settle();
    fire(q('[data-field="required"]'), 'ionChange', true);
    await settle();
    expect(host.parameters()[0]).toEqual({
      id: 'customerId',
      type: 'integer',
      title: 'Customer',
      defaultValue: 7,
      isRequired: true,
      match: [{ column: 'A' }],
    });
    fire(q('[data-field="title"]'), 'ionInput', '');
    await settle();
    expect(host.parameters()[0].title).toBeUndefined();
    fire(q('[data-field="default"]'), 'ionInput', '');
    await settle();
    expect(host.parameters()[0].defaultValue).toBeUndefined();
    fire(q('[data-field="type"]'), 'ionChange', 'recordset');
    await settle();
    expect(host.parameters()[0]).toEqual({ id: 'customerId', type: 'recordset', isRequired: true });
    expect(q('[data-field="default"]')).toBeNull();
    expect(q('[data-action="add-rule"]')).toBeNull();
  });

  it('types defaults for booleans and text', async () => {
    host.parameters.set([{ id: 'a', type: 'boolean' }]);
    await settle();
    fire(q('[data-field="default"]'), 'ionInput', 'TRUE');
    await settle();
    expect(host.parameters()[0].defaultValue).toBe(true);
    fire(q('[data-field="type"]'), 'ionChange', 'string');
    await settle();
    fire(q('[data-field="default"]'), 'ionInput', 'x');
    await settle();
    expect(host.parameters()[0].defaultValue).toBe('x');
  });

  it('edits match rules of every kind, switching kind keeps what was typed', async () => {
    host.parameters.set([{ id: 'a', type: 'string', isRequired: true }]);
    await settle();
    expect(q('.hint')?.textContent).toContain('Add a rule');
    q('[data-action="add-rule"]').click();
    await settle();
    fire(q('[data-rule-row="0"] [data-field="rule-column"]'), 'ionInput', 'Customer*');
    await settle();
    expect(host.parameters()[0].match).toEqual([{ column: 'Customer*' }]);
    expect(fixture.nativeElement.textContent).toContain('Use * for any text');

    fire(q('[data-rule-row="0"] [data-field="rule-kind"]'), 'ionChange', 'table');
    await settle();
    expect(host.parameters()[0].match).toEqual([{ table: '', column: 'Customer*' }]);
    fire(q('[data-rule-row="0"] [data-field="rule-table"]'), 'ionInput', 'Orders');
    await settle();
    expect(host.parameters()[0].match).toEqual([{ table: 'Orders', column: 'Customer*' }]);

    fire(q('[data-rule-row="0"] [data-field="rule-kind"]'), 'ionChange', 'entity');
    await settle();
    expect(host.parameters()[0].match).toEqual([{ entity: '', field: 'Customer*' }]);
    fire(q('[data-rule-row="0"] [data-field="rule-entity"]'), 'ionInput', 'Customer');
    await settle();
    fire(q('[data-rule-row="0"] [data-field="rule-field"]'), 'ionInput', 'CustomerID');
    await settle();
    expect(host.parameters()[0].match).toEqual([{ entity: 'Customer', field: 'CustomerID' }]);

    q('[data-action="remove-rule"]').click();
    await settle();
    expect(host.parameters()[0].match).toBeUndefined();
  });

  it('warns that rules apply only to required inputs', async () => {
    host.parameters.set([{ id: 'a', type: 'string', match: [{ column: 'A' }] }]);
    await settle();
    expect(fixture.nativeElement.textContent).toContain('apply only to required inputs');
    host.parameters.set([{ id: 'a', type: 'string', isRequired: true, match: [{ column: 'A' }] }]);
    await settle();
    expect(fixture.nativeElement.textContent).not.toContain('apply only to required inputs');
  });

  it('removes an input and disables every control when read-only', async () => {
    host.parameters.set([
      { id: 'a', type: 'string' },
      { id: 'b', type: 'string' },
    ]);
    await settle();
    q('[data-parameter-row="0"] [data-action="remove-parameter"]').click();
    await settle();
    expect(host.parameters().map((p) => p.id)).toEqual(['b']);
    host.disabled.set(true);
    await settle();
    expect((q('[data-action="add-parameter"]') as never as { disabled: boolean }).disabled).toBe(true);
    expect((q('[data-field="id"]') as never as { disabled: boolean }).disabled).toBe(true);
  });
});

@Component({
  imports: [CardWidgetEditorComponent],
  template: `<sneat-datatug-card-widget-editor
    [widget]="widget()"
    [parameters]="parameters"
    [queries]="queries"
    (widgetChange)="changes.push($event); widget.set($event)"
  />`,
})
class WidgetHost {
  widget = signal<BoardWidget>({ name: 'text', data: { markdown: '' } });
  parameters: CardParameterDef[] = [
    { id: 'customerId', type: 'string', title: 'Customer' },
    { id: 'row', type: 'record' },
    { id: 'rows', type: 'recordset' },
  ];
  queries: CardQueryChoice[] = [
    { id: 'customers/by-id', title: 'Customer by id', parameters: [{ id: 'id', type: 'string', isRequired: true }] },
    { id: 'orders', title: 'Orders' },
  ];
  changes: BoardWidget[] = [];
}

describe('CardWidgetEditorComponent', () => {
  let fixture: ComponentFixture<WidgetHost>;
  let host: WidgetHost;
  const q = (s: string) => fixture.nativeElement.querySelector(s) as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const set = async (widget: BoardWidget) => {
    host.widget.set(widget);
    await settle();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WidgetHost],
      providers: [{ provide: QueriesService, useValue: {} }],
    }).compileComponents();
    fixture = TestBed.createComponent(WidgetHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('edits a text widget heading and markdown', async () => {
    fire(q('[data-field="markdown"]'), 'ionInput', 'Hi {{customerId}}');
    await settle();
    fire(q('[data-field="widget-title"]'), 'ionInput', 'Greeting');
    await settle();
    expect(host.widget()).toEqual({
      name: 'text',
      data: { markdown: 'Hi {{customerId}}', title: 'Greeting' },
    });
    fire(q('[data-field="widget-title"]'), 'ionInput', '');
    await settle();
    expect((host.widget().data as Record<string, unknown>)['title']).toBeUndefined();
  });

  it('edits a fields widget: query source, bound parameters, columns', async () => {
    await set({ name: 'fields', data: { source: { queryId: '' } } });
    fire(q('[data-field="query"]'), 'ionChange', 'customers/by-id');
    await settle();
    expect(host.widget().data).toEqual({ source: { queryId: 'customers/by-id' } });
    // the query's own parameter appears, bindable to a card input
    fire(q('[data-binding="id"] [data-field="binding"]'), 'ionChange', 'p:customerId');
    await settle();
    expect(host.widget().data).toEqual({
      source: {
        queryId: 'customers/by-id',
        parameters: [{ id: 'id', boardParameterId: 'customerId' }],
      },
    });
    fire(q('[data-binding="id"] [data-field="binding"]'), 'ionChange', 'v');
    await settle();
    fire(q('[data-binding="id"] [data-field="binding-value"]'), 'ionInput', 'ALFKI');
    await settle();
    expect((host.widget().data as { source: { parameters: unknown } }).source.parameters).toEqual([
      { id: 'id', value: 'ALFKI' },
    ]);
    fire(q('[data-field="fields"]'), 'ionInput', 'Name = Full name\nCity');
    await settle();
    expect((host.widget().data as { fields: unknown }).fields).toEqual([
      { column: 'Name', label: 'Full name' },
      { column: 'City' },
    ]);
    // changing the query drops bindings of the old one
    fire(q('[data-field="query"]'), 'ionChange', 'orders');
    await settle();
    expect((host.widget().data as { source: unknown }).source).toEqual({ queryId: 'orders' });
  });

  it('switches a fields widget to a record input as its source', async () => {
    await set({ name: 'fields', data: { source: { queryId: 'orders' } } });
    fire(q('ion-segment'), 'ionChange', 'parameter');
    await settle();
    expect((host.widget().data as { source: unknown }).source).toEqual({ parameter: 'row' });
    fire(q('[data-field="parameter"]'), 'ionChange', 'rows');
    await settle();
    expect((host.widget().data as { source: unknown }).source).toEqual({ parameter: 'rows' });
    fire(q('ion-segment'), 'ionChange', 'query');
    await settle();
    expect((host.widget().data as { source: unknown }).source).toEqual({ queryId: '' });
  });

  it('gives a grid of rows a recordset input as its source', async () => {
    await set({ name: 'SQL', data: { sql: { queryId: 'orders' } } });
    fire(q('ion-segment'), 'ionChange', 'parameter');
    await settle();
    expect(host.widget().data).toEqual({ source: { parameter: 'rows' } });
  });

  it('offers a chart view for a grid with a saved query only', async () => {
    await set({ name: 'SQL', data: { sql: { queryId: 'orders' } } });
    expect(q('details.chart-disclosure')).not.toBeNull();
    await set({ name: 'SQL', data: { source: { parameter: 'rows' } } });
    expect(q('details.chart-disclosure')).toBeNull();
  });

  it('keeps widgets it has no form for and says so', async () => {
    await set({ name: 'HTTP', data: { request: {} } });
    expect(q('[role="status"]')?.textContent).toContain('no form here');
    expect(q('[data-field="widget-title"]')).toBeNull();
  });
});
