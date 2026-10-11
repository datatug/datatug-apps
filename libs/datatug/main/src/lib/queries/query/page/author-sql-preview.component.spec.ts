import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { PublicSqliteQueryPreview } from '../../public-sqlite-tugql';
import { testAuthorProof } from './author-query-proof.spec-helper';
import { AuthorSqlPreviewComponent } from './author-sql-preview.component';

describe('AuthorSqlPreviewComponent', () => {
  let fixture: ComponentFixture<AuthorSqlPreviewComponent>;
  const authorProof = testAuthorProof();

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
      authorProof: testAuthorProof(),
      relationship: {
        id: 'FK_Invoice_Customer_CustomerId',
        version: 'fp-main.Invoice.CustomerId-main.Customer.CustomerId',
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
    const relationship = metadata.querySelector(
      '[aria-label="Prepared relationship"]',
    ) as HTMLElement;
    expect(relationship.textContent).toContain('inner');
    expect(relationship.textContent).not.toContain(' vfp-');
    const fingerprint = relationship.querySelector(
      '.author-source-fingerprint',
    ) as HTMLDetailsElement;
    expect(fingerprint.open).toBe(false);
    expect(fingerprint.textContent).toContain(
      'fp-main.Invoice.CustomerId-main.Customer.CustomerId',
    );
    expect(metadata.textContent).toContain(
      'Prepared metadata · not worker-verified or executed.',
    );
    const outputRows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.author-output-columns li',
      ),
    ).map((row) =>
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
      authorProof: testAuthorProof(),
      relationship: {
        id: 'FK_Invoice_Customer_CustomerId',
        version: 'fp-main.Invoice.CustomerId-main.Customer.CustomerId',
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

  it('renders ordered SQL binding slots with their own labels and values', () => {
    fixture.componentRef.setInput('plan', {
      sql: 'SELECT ... WHERE x = ? AND CustomerId = ? HAVING count(*) >= ?',
      fixedBindings: [3, 7],
      bindingNames: [
        'WHERE literal',
        'CustomerId',
        'HAVING threshold (literal)',
      ],
      bindingSlots: [
        { kind: 'literal', name: 'WHERE literal', value: 3 },
        { kind: 'customer-id', name: 'CustomerId' },
        { kind: 'literal', name: 'HAVING threshold (literal)', value: 7 },
      ],
      sourceId: 'chinook-sqlite',
      fixtureSha256: 'pin',
      schemaVersion: '1',
      draftRevision: 4,
      authorProof,
    } satisfies PublicSqliteQueryPreview);
    fixture.componentRef.setInput('customerId', '1');
    fixture.componentRef.setInput('customerIdValid', true);
    fixture.componentRef.setInput('customerIdMissing', false);
    fixture.detectChanges();

    const rows = Array.from(
      fixture.nativeElement.querySelectorAll('.author-binding-row'),
    ) as HTMLElement[];
    expect(rows.map((row) => [
      row.querySelector('.author-binding-index')?.textContent,
      row.querySelector('.author-binding-name')?.textContent,
      row.querySelector('.author-binding-value')?.textContent?.trim(),
    ])).toEqual([
      ['?1', 'WHERE literal · integer literal', '3'],
      ['?2', '@CustomerId · integer', '1 · ready'],
      ['?3', 'HAVING threshold · integer literal', '7'],
    ]);
  });
});
