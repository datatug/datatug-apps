import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DEMODB_LOCAL_COPY } from '../project/demo-db-connections.component';
import { DemoDbLocalQueryComponent } from './demo-db-local-query.component';

const params = convertToParamMap({ storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1', dataset: 'chinook' });
const connection = {
  id: 'chinook-indexeddb-local', dataset: 'chinook', environment: 'Dev', storage: 'indexeddb',
  tags: ['chinook', 'indexeddb', 'local'], sourceConnectionId: 'chinook-sqlite', sourceStorage: 'sqlite',
  databaseName: 'datatug-demo-dev-chinook-generated', rowCount: 2, provenanceScope: 'descriptor-declared',
  snapshotScope: 'per-table', tables: [{ name: 'Things', rowCount: 2,
    columns: [{ name: 'amount', type: 'DECIMAL_TEXT(10,2)', transport: 'json-numeric-wire-token' },
      { name: 'discontinued', type: 'BOOLEAN', transport: 'json-scalar' },
      { name: 'largeId', type: 'INTEGER', transport: 'json-safe-number-or-decimal-string' }] }],
};

describe('shared project local Dev query page', () => {
  it('loads the promoted source after reload and submits a typed DALgo page', async () => {
    const query = vi.fn(async () => ({ records: [{ key: { path: 'main.Things/1' }, data: { amount: '10.00' } }],
      nextCursor: { values: ['10.00', 'main.Things/1'] } }));
    const load = vi.fn(async (dataset: string) => ({ ...connection, dataset,
      id: `${dataset}-indexeddb-local` }));
    const route = { paramMap: new BehaviorSubject(params), snapshot: { paramMap: params } };
    await TestBed.configureTestingModule({ imports: [DemoDbLocalQueryComponent], providers: [
      { provide: ActivatedRoute, useValue: route },
      { provide: DEMODB_LOCAL_COPY, useValue: { connection: load, query } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbLocalQueryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance['connection']()?.id).toBe('chinook-indexeddb-local');
    fixture.componentInstance['setFilterField']('amount');
    fixture.componentInstance['setOperator']('>');
    fixture.componentInstance['setFilterValue']('2');
    fixture.componentInstance['setOrderField']('amount');
    await fixture.componentInstance['run'](false);
    expect(query).toHaveBeenCalledWith('chinook', 'Things', {
      filters: [{ field: 'amount', operator: '>', value: '2' }],
      orders: [{ field: 'amount', direction: 'asc' }], limit: 20,
    });
    expect(fixture.componentInstance['results']()).toContain('10.00');
    await fixture.componentInstance['run'](true);
    expect(query.mock.calls[1]?.[2]).toHaveProperty('startAfter', { values: ['10.00', 'main.Things/1'] });
    fixture.componentInstance['setFilterValue']('3');
    expect(fixture.componentInstance['nextCursor']()).toBeUndefined();
    expect(fixture.componentInstance['results']()).toBe('');
    await fixture.componentInstance['run'](false);
    expect(query.mock.calls[2]?.[2]).not.toHaveProperty('startAfter');
    fixture.componentInstance['setFilterField']('discontinued');
    fixture.componentInstance['setFilterValue']('1');
    await fixture.componentInstance['run'](false);
    expect(query.mock.calls[3]?.[2]).toMatchObject({ filters: [{ field: 'discontinued', operator: '>', value: true }] });
    fixture.componentInstance['setFilterValue']('true');
    await fixture.componentInstance['run'](false);
    expect(query.mock.calls[4]?.[2]).toMatchObject({ filters: [{ field: 'discontinued', operator: '>', value: true }] });
    fixture.componentInstance['setFilterField']('largeId');
    fixture.componentInstance['setFilterValue']('9007199254740993');
    await fixture.componentInstance['run'](false);
    expect(query.mock.calls[5]?.[2]).toMatchObject({ filters: [{ field: 'largeId', operator: '>', value: '9007199254740993' }] });
    route.paramMap.next(convertToParamMap({ storeId: 'github.com', projectId: params.get('projectId'), dataset: 'northwind' }));
    await vi.waitFor(() => expect(fixture.componentInstance['connection']()?.dataset).toBe('northwind'));
    expect(load).toHaveBeenCalledWith('northwind');
    expect(fixture.componentInstance['nextCursor']()).toBeUndefined();
    fixture.destroy();
  });

  it('refuses the route outside the exact shared project', async () => {
    const wrong = convertToParamMap({ storeId: 'github.com', projectId: 'chinook-demo@datatug@', dataset: 'chinook' });
    const route = { paramMap: new BehaviorSubject(wrong), snapshot: { paramMap: wrong } };
    const load = vi.fn();
    await TestBed.configureTestingModule({ imports: [DemoDbLocalQueryComponent], providers: [
      { provide: ActivatedRoute, useValue: route },
      { provide: DEMODB_LOCAL_COPY, useValue: { connection: load } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(DemoDbLocalQueryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(load).not.toHaveBeenCalled();
    expect(fixture.componentInstance['error']()).toContain('shared DemoDB project');
    fixture.destroy();
  });
});
