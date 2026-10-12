import { TestBed } from '@angular/core/testing';
import type { PublicSqliteSourceDiscovery } from '../../public-sqlite-query.service';
import type { AuthorRelationshipSourceReview } from './author-relationship-source-edit';
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

    const outputReview: AuthorRelationshipSourceReview = {
      before: 'from Invoice as i',
      after: 'from Invoice as i join Customer as c',
      relationship: admitted.relationship,
      selectedFields: ['FirstName'],
      customerAlias: 'c',
      limit: 100,
      outputLineage: [{ output: 'FirstName', source: 'c', field: 'FirstName' }],
    };
    fixture.componentRef.setInput('review', outputReview);
    fixture.componentRef.setInput('choices', ['FirstName', 'Email']);
    fixture.componentRef.setInput('selectedFields', ['FirstName']);
    fixture.detectChanges();
    const firstNameCheckbox = fixture.nativeElement.querySelector(
      'ion-checkbox[aria-label="Customer.FirstName"]',
    ) as HTMLElement | null;
    const emailCheckbox = fixture.nativeElement.querySelector(
      'ion-checkbox[aria-label="Customer.Email"]',
    ) as HTMLElement | null;
    expect(firstNameCheckbox).not.toBeNull();
    expect(emailCheckbox).not.toBeNull();
    expect(firstNameCheckbox?.nextElementSibling?.tagName).toBe('ION-LABEL');
    expect(emailCheckbox?.nextElementSibling?.tagName).toBe('ION-LABEL');

    fixture.componentRef.setInput('review', undefined);
    fixture.componentRef.setInput('choices', []);
    fixture.componentRef.setInput('selectedFields', []);
    fixture.detectChanges();

    fixture.componentInstance.toggleTable('Customer');
    fixture.detectChanges();
    const customerDetails = fixture.nativeElement.querySelector(
      '[data-testid="author-related-customer-details"]',
    ) as HTMLElement | null;
    const customerText = customerDetails?.innerHTML ?? '';
    expect(customerText).toContain('main.Invoice.CustomerId');
    expect(customerText).toContain('main.Customer.CustomerId');
    expect(customerText).toContain('chinook.refs.json');
    expect(fixture.nativeElement.querySelector('[data-testid="author-related-invoice"]')).toBeNull();

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

  it('does not list an already participating Customer as an available addition', async () => {
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
    fixture.componentRef.setInput('canJoin', false);
    fixture.componentRef.setInput('customerAlreadyJoined', true);
    fixture.componentRef.setInput('statusMessage', '');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="author-related-customer"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="author-related-empty"]')?.innerHTML)
      .toContain('No other admitted related sources');
  });
});
