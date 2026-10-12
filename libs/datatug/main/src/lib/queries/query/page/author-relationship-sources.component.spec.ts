import { TestBed } from '@angular/core/testing';
import type { PublicSqliteSourceDiscovery } from '../../public-sqlite-query.service';
import { AuthorRelationshipSourcesComponent } from './author-relationship-sources.component';

describe('AuthorRelationshipSourcesComponent', () => {
  const admitted: PublicSqliteSourceDiscovery = {
    fixtureSha256: 'fixture-sha',
    schemaVersion: 'schema-v1',
    invoiceFields: [{ name: 'InvoiceId', type: 'INTEGER' }],
    customerFields: [{ name: 'CustomerId', type: 'INTEGER' }],
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

  it('inspects admitted metadata separately from immediate join and optional output review', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorRelationshipSourcesComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthorRelationshipSourcesComponent);
    fixture.componentRef.setInput('active', true);
    fixture.componentRef.setInput('sources', admitted);
    fixture.componentRef.setInput('currentLimit', '100');
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('review', undefined);
    fixture.componentRef.setInput('choices', []);
    fixture.componentRef.setInput('selectedFields', []);
    fixture.componentRef.setInput('disabled', false);
    fixture.componentRef.setInput('canJoin', true);
    fixture.componentRef.setInput('statusMessage', '');
    fixture.detectChanges();

    fixture.componentInstance.toggleTable('Invoice');
    fixture.detectChanges();
    const invoiceDetails = fixture.nativeElement.querySelector(
      '[data-testid="author-related-invoice-details"]',
    ) as HTMLElement | null;
    const invoiceText = invoiceDetails?.innerHTML ?? '';
    expect(invoiceText).toContain('InvoiceId');
    expect(invoiceText).toContain('INTEGER');

    fixture.componentInstance.toggleTable('Customer');
    fixture.detectChanges();
    const customerDetails = fixture.nativeElement.querySelector(
      '[data-testid="author-related-customer-details"]',
    ) as HTMLElement | null;
    const customerText = customerDetails?.innerHTML ?? '';
    expect(customerText).toContain('main.Invoice.CustomerId');
    expect(customerText).toContain('main.Customer.CustomerId');
    expect(customerText).toContain('chinook.refs.json');

    let reviewCount = 0;
    let joinCount = 0;
    let applyCount = 0;
    fixture.componentInstance.reviewRequested.subscribe(() => reviewCount++);
    fixture.componentInstance.applyRequested.subscribe(() => applyCount++);
    fixture.componentInstance.joinRequested.subscribe(() => joinCount++);
    const click = new Event('click');
    const stopPropagation = vi.spyOn(click, 'stopPropagation');
    fixture.componentRef.setInput('canJoin', false);
    fixture.componentInstance.joinRelationship(click);
    expect(joinCount).toBe(0);
    fixture.componentRef.setInput('canJoin', true);
    fixture.componentInstance.joinRelationship(click);
    expect(stopPropagation).toHaveBeenCalledTimes(2);
    expect(joinCount).toBe(1);
    expect(reviewCount).toBe(0);
    expect(applyCount).toBe(0);
    expect(fixture.componentInstance.expandedTable()).toBe('Customer');

    fixture.componentInstance.requestOutputReview(new Event('click'));
    expect(reviewCount).toBe(1);
    expect(joinCount).toBe(1);
    expect(applyCount).toBe(0);

    fixture.componentRef.setInput('active', false);
    fixture.detectChanges();
    expect(fixture.componentInstance.expandedTable()).toBeUndefined();
  });
});
