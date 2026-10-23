import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/provide';
import { of } from 'rxjs';
import { QueryType, type IQueryFolder } from '../../models/definition/query-def';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { QueriesService } from '../queries.service';
import type { IProjectContext } from '../../nav/nav-models';
import { HttpRowActionComponent } from './http-row-action.component';
import { HttpRowBindingStore } from './http-row-binding.store';

const carrier = {
  id: 'carrier-status',
  title: 'Carrier booking',
  request: { queryType: QueryType.HTTP, url: 'https://carrier.demodb.dev/v1/bookings?request_id={request_id}', method: 'GET' },
  parameters: [{ id: 'request_id', type: 'string', isRequired: true, meta: { entity: 'ShippingRequest', field: 'id' } }],
};
const folder = {
  id: '~',
  items: [{ id: 'sql', request: { queryType: QueryType.SQL, text: 'select 1' } }],
  folders: [{ id: 'shipping', items: [carrier], folders: [] }],
} as unknown as IQueryFolder;
const row = { columns: [{ name: 'request_id' }, { name: 'status' }], values: ['request-11038', 'received'], label: 'requests row 1' };

describe('HttpRowActionComponent (http-query-parameters REQ:row-binding)', () => {
  const goQuery = vi.fn();
  async function create(checkedRows = 0, r: typeof row | undefined = row) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideIonicAngular(),
        { provide: QueriesService, useValue: { getQueriesFolder: () => of(folder) } },
        { provide: DatatugNavService, useValue: { goQuery } },
      ],
    });
    const fixture = TestBed.createComponent(HttpRowActionComponent);
    fixture.componentRef.setInput('project', { ref: { projectId: 'p', storeId: 'github.com' } } as unknown as IProjectContext);
    fixture.componentRef.setInput('row', r);
    fixture.componentRef.setInput('checkedRows', checkedRows);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('offers the bindable HTTP query and opens it with the row bound', async () => {
    const fixture = await create();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Run HTTP query');
    expect(el.textContent).toContain('Carrier booking');
    (fixture.componentInstance as unknown as { run(): void }).run();
    expect(goQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'shipping/carrier-status' }), 'execute');
    const store = TestBed.inject(HttpRowBindingStore);
    expect(store.take('shipping/carrier-status')).toEqual(row);
    expect(store.take('shipping/carrier-status')).toBeUndefined();
  });

  it('is disabled with "Select one row." when several rows are checked (AC multi-row-rejected)', async () => {
    goQuery.mockReset();
    const fixture = await create(2);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Select one row.');
    (fixture.componentInstance as unknown as { run(): void }).run();
    expect(goQuery).not.toHaveBeenCalled();
  });

  it('offers nothing without a bindable row', async () => {
    const fixture = await create(0, { ...row, columns: [{ name: 'x' }, { name: 'y' }] });
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Run HTTP query');
  });
});
