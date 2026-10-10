import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { PublicSqliteQueryPreview } from '../../public-sqlite-tugql';
import { AuthorSqlPreviewComponent } from './author-sql-preview.component';

describe('AuthorSqlPreviewComponent', () => {
  let fixture: ComponentFixture<AuthorSqlPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorSqlPreviewComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(AuthorSqlPreviewComponent);
  });

  it('shows prepared source pins, relationship pairs, and ordered output lineage in a collapsed inspector', () => {
    fixture.componentRef.setInput('plan', {
      sql: 'SELECT ...',
      fixedBindings: [],
      bindingNames: ['CustomerId'],
      sourceId: 'chinook-sqlite',
      fixtureSha256: 'a'.repeat(64),
      schemaVersion: '1',
      draftRevision: 3,
      relationship: {
        id: 'FK_Invoice_Customer_CustomerId',
        version: '1',
        fromSource: 'Invoice',
        toSource: 'Customer',
        joinType: 'inner',
        pairs: [
          { fromField: 'CustomerId', toField: 'CustomerId' },
          { fromField: 'TenantId', toField: 'TenantId' },
        ],
      },
      outputColumns: [
        {
          name: 'InvoiceId',
          type: 'integer',
          lineage: [{ source: 'i', field: 'InvoiceId' }],
        },
        {
          name: 'CustomerId',
          type: 'integer',
          lineage: [{ source: 'i', field: 'CustomerId' }],
        },
        {
          name: 'FirstName',
          type: 'string',
          lineage: [{ source: 'c', field: 'FirstName' }],
        },
      ],
    } satisfies PublicSqliteQueryPreview);
    fixture.detectChanges();

    const inspector = fixture.nativeElement.querySelector(
      '[data-testid="author-source-inspector"]',
    ) as HTMLDetailsElement;
    const metadata = fixture.nativeElement.querySelector(
      '[data-testid="author-source-metadata"]',
    ) as HTMLElement;

    expect(inspector.open).toBe(false);
    expect(metadata.textContent).toContain('chinook-sqlite');
    expect(metadata.textContent).toContain('a'.repeat(64));
    expect(metadata.textContent).toContain('FK_Invoice_Customer_CustomerId');
    expect(metadata.textContent).toContain('Invoice.TenantId');
    expect(metadata.textContent).toContain('Customer.TenantId');
    expect(metadata.textContent).toContain(
      'Prepared metadata · not worker-verified or executed.',
    );
    const outputRows = Array.from(
      fixture.nativeElement.querySelectorAll('.author-output-columns li'),
    ).map((row: Element) =>
      Array.from(row.children).map((cell) => cell.textContent?.trim()),
    );
    expect(outputRows).toEqual([
      ['InvoiceId', 'integer', 'i.InvoiceId'],
      ['CustomerId', 'integer', 'i.CustomerId'],
      ['FirstName', 'string', 'c.FirstName'],
    ]);
  });

  it('does not invent relationship or lineage claims for a single-source preview and replaces old metadata', () => {
    const joined: PublicSqliteQueryPreview = {
      sql: 'SELECT ...',
      fixedBindings: [],
      bindingNames: [],
      sourceId: 'chinook-sqlite',
      fixtureSha256: 'old-pin',
      schemaVersion: '1',
      draftRevision: 1,
      relationship: {
        id: 'FK_Invoice_Customer_CustomerId',
        version: '1',
        fromSource: 'Invoice',
        toSource: 'Customer',
        joinType: 'inner',
        pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
      },
      outputColumns: [
        {
          name: 'CustomerId',
          type: 'integer',
          lineage: [{ source: 'i', field: 'CustomerId' }],
        },
      ],
    };
    fixture.componentRef.setInput('plan', joined);
    fixture.detectChanges();
    fixture.componentRef.setInput('plan', {
      ...joined,
      fixtureSha256: 'new-pin',
      relationship: undefined,
      outputColumns: undefined,
    });
    fixture.detectChanges();

    const metadata = fixture.nativeElement.querySelector(
      '[data-testid="author-source-metadata"]',
    ) as HTMLElement;
    expect(metadata.textContent).toContain('new-pin');
    expect(metadata.textContent).not.toContain('old-pin');
    expect(metadata.textContent).not.toContain(
      'FK_Invoice_Customer_CustomerId',
    );
    expect(metadata.textContent).not.toContain('i.CustomerId');
    expect(metadata.textContent).toContain(
      'Column lineage is unavailable for this preview.',
    );
  });
});
