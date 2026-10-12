import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import type { PublicSqliteSourceDiscovery } from '../../public-sqlite-query.service';
import { inspectAuthorParticipatingSources } from './author-participating-sources';
import { AuthorParticipatingSourcesComponent } from './author-participating-sources.component';

describe('AuthorParticipatingSourcesComponent', () => {
  const source = `from Invoice as i
join Customer as c
  on i.CustomerId = c.CustomerId
limit 10
select i.InvoiceId, c.FirstName
`;
  const metadata: PublicSqliteSourceDiscovery = {
    fixtureSha256: 'fixture-sha',
    schemaVersion: 'schema-v1',
    invoiceFields: [{ name: 'InvoiceId', type: 'INTEGER' }],
    customerFields: [{ name: 'FirstName', type: 'TEXT' }],
    relationship: {
      id: 'Invoice_Customer_CustomerId',
      version: 'relationship-v1',
      from: { schema: 'main', table: 'Invoice' },
      to: { schema: 'main', table: 'Customer' },
      pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
    },
    relationshipProvenance: 'chinook.refs.json · Core v1 declared foreign key',
    cardinality: 'many invoices to one customer · declared',
    crossSourceCost: 'unknown',
  };

  it('renders current sources from the draft and exposes separate metadata and removal events', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorParticipatingSourcesComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(AuthorParticipatingSourcesComponent);
    fixture.componentRef.setInput('inventory', inspectAuthorParticipatingSources(source));
    fixture.componentRef.setInput('metadata', metadata);
    fixture.componentRef.setInput('disabled', false);
    fixture.componentRef.setInput('canRemoveJoin', true);
    fixture.componentRef.setInput('removeJoinReason', undefined);
    fixture.componentRef.setInput('removalOutputs', ['FirstName']);
    fixture.componentRef.setInput('removalConfirmOpen', false);
    fixture.detectChanges();

    const sourceRows = fixture.nativeElement.querySelectorAll('[data-testid="author-participating-source"]');
    expect(sourceRows).toHaveLength(2);
    expect(sourceRows[0].innerHTML).toContain('Invoice');
    expect(sourceRows[1].innerHTML).toContain('Customer');
    const customerSource = inspectAuthorParticipatingSources(source).sources[1];
    if (!customerSource) throw new Error('Customer join source was not inventoried.');
    fixture.componentInstance.toggleDetails(customerSource);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="author-participating-source-details"]')?.innerHTML)
      .toContain('FirstName');

    let removeCount = 0;
    fixture.componentInstance.removeRequested.subscribe(() => removeCount++);
    const removeButton = fixture.nativeElement.querySelector('[data-testid="author-source-remove-join"]') as HTMLElement;
    removeButton.click();
    expect(removeCount).toBe(1);

    let refreshCount = 0;
    fixture.componentInstance.refreshRequested.subscribe(() => refreshCount++);
    const refreshButton = fixture.nativeElement.querySelector('[data-testid="author-sources-refresh"]') as HTMLElement;
    refreshButton.click();
    expect(refreshCount).toBe(1);
  });

  it('keeps the source inventory honest for invalid drafts', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorParticipatingSourcesComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(AuthorParticipatingSourcesComponent);
    fixture.componentRef.setInput('inventory', inspectAuthorParticipatingSources('from Invoice\nselect ('));
    fixture.componentRef.setInput('metadata', undefined);
    fixture.componentRef.setInput('disabled', true);
    fixture.componentRef.setInput('canRemoveJoin', false);
    fixture.componentRef.setInput('removeJoinReason', undefined);
    fixture.componentRef.setInput('removalOutputs', []);
    fixture.componentRef.setInput('removalConfirmOpen', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="author-participating-source"]')).toBeNull();
    expect(fixture.componentInstance.disabled()).toBe(true);
    const template = readFileSync(
      resolve('libs/datatug/main/src/lib/queries/query/page/author-participating-sources.component.html'),
      'utf8',
    );
    expect(template).toContain('[disabled]="disabled()"');
    expect(fixture.nativeElement.innerHTML).toContain('diagnostics');
  });

  it('does not attach Chinook field metadata to a qualified non-main table with the same name', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorParticipatingSourcesComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(AuthorParticipatingSourcesComponent);
    const qualified = inspectAuthorParticipatingSources(`from other.Invoice as i
select i.InvoiceId
`);
    fixture.componentRef.setInput('inventory', qualified);
    fixture.componentRef.setInput('metadata', metadata);
    fixture.componentRef.setInput('disabled', true);
    fixture.componentRef.setInput('canRemoveJoin', false);
    fixture.componentRef.setInput('removalOutputs', []);
    fixture.componentRef.setInput('removalConfirmOpen', false);
    fixture.detectChanges();
    const invoiceSource = qualified.sources[0];
    if (!invoiceSource) throw new Error('Qualified Invoice was not inventoried.');
    expect(fixture.componentInstance.tableFields(invoiceSource)).toEqual([]);
    fixture.componentInstance.toggleDetails(invoiceSource);
    fixture.detectChanges();
    expect(fixture.componentInstance.tableSchema(invoiceSource)).toBeUndefined();
    expect(fixture.componentInstance.tableFields(invoiceSource)).toEqual([]);
  });
});
