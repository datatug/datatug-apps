import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import type { PublicSqliteQueryPreview } from '../../public-sqlite-tugql';
import { testAuthorProof } from './author-query-proof.spec-helper';
import { AuthorSqlPreviewComponent } from './author-sql-preview.component';

const preview = (
  sql: string,
  fixtureSha256 = 'a'.repeat(64),
): PublicSqliteQueryPreview => ({
  sql,
  fixedBindings: [1],
  bindingNames: ['CustomerId'],
  sourceId: 'chinook-sqlite',
  fixtureSha256,
  schemaVersion: '1',
  draftRevision: 3,
  authorProof: testAuthorProof(),
});

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('AuthorSqlPreviewComponent', () => {
  let fixture: ComponentFixture<AuthorSqlPreviewComponent>;
  const authorProof = testAuthorProof();
  const navigatorClipboardDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.navigator,
    'clipboard',
  );

  const installClipboard = (
    writeText: ((text: string) => Promise<void>) | undefined,
  ): void => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: writeText ? { writeText } : undefined,
    });
  };

  const setPlan = (value: PublicSqliteQueryPreview): void => {
    fixture.componentRef.setInput('plan', value);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorSqlPreviewComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(AuthorSqlPreviewComponent);
  });

  afterEach(() => {
    if (navigatorClipboardDescriptor) {
      Object.defineProperty(
        globalThis.navigator,
        'clipboard',
        navigatorClipboardDescriptor,
      );
    } else {
      Reflect.deleteProperty(globalThis.navigator, 'clipboard');
    }
  });

  it('copies only the exact current preview SQL and reports signal-driven success', async () => {
    const sql = 'SELECT "i"."InvoiceId" WHERE "i"."CustomerId" = ?';
    const writeText = vi.fn(async () => undefined);
    installClipboard(writeText);
    setPlan(preview(sql));

    const copyButton = fixture.nativeElement.querySelector(
      '[data-testid="author-copy-sql"]',
    ) as HTMLButtonElement;
    expect(copyButton.textContent).toContain('Copy SQL');
    expect(copyButton.getAttribute('aria-label')).toBe('Copy SQL');
    copyButton.click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(sql);
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql-status"]',
      )?.textContent,
    ).toContain('Preview SQL copied');
    expect(fixture.nativeElement.textContent).toContain(
      'Preview · Not executed',
    );
    expect(fixture.nativeElement.textContent).toContain('Required · unset');
  });

  it('shows missing and rejected clipboard writes as retryable failure', async () => {
    setPlan(preview('SELECT ?'));
    installClipboard(undefined);

    (
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql-status"]',
      )?.textContent,
    ).toContain("Couldn't copy SQL. Try again.");

    const writeText = vi.fn((): Promise<void> => {
      throw new Error('unavailable');
    });
    installClipboard(writeText);
    (
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-testid="author-copy-sql"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(writeText).toHaveBeenNthCalledWith(1, 'SELECT ?');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql-status"]',
      )?.textContent,
    ).toContain("Couldn't copy SQL. Try again.");

    writeText.mockImplementation(async () => {
      throw new Error('denied');
    });
    (
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenNthCalledWith(2, 'SELECT ?');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql-status"]',
      )?.textContent,
    ).toContain("Couldn't copy SQL. Try again.");

    writeText.mockImplementation(async () => undefined);
    (
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledTimes(3);
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql-status"]',
      )?.textContent,
    ).toContain('Preview SQL copied');
  });

  it('suppresses duplicate writes and fences old outcomes from a replacement with identical SQL', async () => {
    const sql = 'SELECT ?';
    const first = deferred<void>();
    const second = deferred<void>();
    const third = deferred<void>();
    const writeText = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    installClipboard(writeText);
    const planA = preview(sql, 'b'.repeat(64));
    const planB = preview(sql, 'c'.repeat(64));
    setPlan(planA);

    const copyButton = (): HTMLButtonElement =>
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql"]',
      ) as HTMLButtonElement;
    copyButton().click();
    fixture.detectChanges();
    copyButton().click();
    await fixture.componentInstance.copyCurrentSql();
    expect(copyButton().disabled).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(sql);

    setPlan(planB);
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="author-copy-sql-status"]')
        ?.textContent.trim(),
    ).toBe('');
    copyButton().click();
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql-status"]',
      )?.textContent,
    ).toContain('Copying preview SQL');

    first.resolve();
    await Promise.resolve();
    await fixture.componentInstance.copyCurrentSql();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql-status"]',
      )?.textContent,
    ).toContain('Copying preview SQL');
    second.resolve();
    await Promise.resolve();
    expect(fixture.componentInstance.copyStatus()).toContain('Preview SQL copied');
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql-status"]',
      )?.textContent,
    ).toContain('Preview SQL copied');

    setPlan(preview(sql, 'd'.repeat(64)));
    copyButton().click();
    third.resolve();
    await Promise.resolve();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledTimes(3);
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql-status"]',
      )?.textContent,
    ).toContain('Preview SQL copied');
  });

  it('keeps pending feedback isolated when an old write rejects and is safe after destroy', async () => {
    const oldWrite = deferred<void>();
    const newWrite = deferred<void>();
    const writeText = vi
      .fn()
      .mockReturnValueOnce(oldWrite.promise)
      .mockReturnValueOnce(newWrite.promise);
    installClipboard(writeText);
    setPlan(preview('SELECT ?', 'b'.repeat(64)));
    const copyButton = (): HTMLButtonElement =>
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql"]',
      ) as HTMLButtonElement;
    copyButton().click();
    setPlan(preview('SELECT ?', 'c'.repeat(64)));
    copyButton().click();
    fixture.detectChanges();
    oldWrite.reject(new Error('late old rejection'));
    await Promise.resolve();
    await fixture.componentInstance.copyCurrentSql();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="author-copy-sql-status"]',
      )?.textContent,
    ).toContain('Copying preview SQL');
    newWrite.resolve();
    await fixture.whenStable();

    const afterDestroy = deferred<void>();
    installClipboard(vi.fn().mockReturnValue(afterDestroy.promise));
    const copyAfterDestroy = fixture.componentInstance.copyCurrentSql();
    fixture.destroy();
    afterDestroy.reject(new Error('settled after destroy'));
    await copyAfterDestroy;
  });

  it('wraps only presentation and resets to off for a new plan identity', () => {
    const sql =
      'SELECT a_really_long_column_name, ?\nFROM a_very_long_table_name';
    const firstPlan = preview(sql, 'b'.repeat(64));
    setPlan(firstPlan);
    const previewRegion = fixture.nativeElement.querySelector(
      '.author-sql-scroll',
    ) as HTMLElement;
    const wrapButton = fixture.nativeElement.querySelector(
      '[data-testid="author-wrap-sql"]',
    ) as HTMLButtonElement;
    const pre = previewRegion.querySelector('pre') as HTMLElement;

    expect(wrapButton.getAttribute('aria-pressed')).toBe('false');
    expect(pre.textContent).toBe(sql);
    wrapButton.click();
    fixture.detectChanges();
    expect(wrapButton.getAttribute('aria-pressed')).toBe('true');
    expect(pre.textContent).toBe(sql);
    expect(pre.parentElement?.classList).toContain(
      'author-sql-scroll--wrapped',
    );
    wrapButton.click();
    fixture.detectChanges();
    expect(wrapButton.getAttribute('aria-pressed')).toBe('false');
    expect(pre.textContent).toBe(sql);

    wrapButton.click();
    fixture.detectChanges();
    setPlan(preview(sql, 'c'.repeat(64)));
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-testid="author-wrap-sql"]',
        ) as HTMLButtonElement
      ).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      (
        fixture.nativeElement.querySelector(
          '.author-sql-scroll pre',
        ) as HTMLElement
      ).textContent,
    ).toBe(sql);
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
