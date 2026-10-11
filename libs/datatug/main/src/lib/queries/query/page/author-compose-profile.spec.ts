import { parseTugQL } from '@dalgo/core';
import {
  readAuthorComposeProfile,
  updateAuthorComposeSource,
} from './author-compose-profile';

const SIMPLE = [
  'parameters (',
  '  @CustomerId integer required',
  ')',
  'from Invoice as i',
  'where i.CustomerId = @CustomerId',
  'limit 100',
  'select i.InvoiceId, i.InvoiceDate',
  '',
].join('\n');

const GROUPED = [
  'parameters (',
  '  @CustomerId integer required',
  ')',
  'from Invoice as i',
  'where i.CustomerId = @CustomerId',
  'group by i.CustomerId',
  'having count(*) >= 7',
  'limit 100',
  'select i.CustomerId, count(*) as InvoiceCount',
  '',
].join('\n');

const STYLED_GROUPED = [
  'PARAMETERS (',
  '\t@CustomerId INTEGER REQUIRED',
  ')',
  'FROM main.Invoice AS i',
  'WHERE i.CustomerId = @CustomerId',
  'GROUP BY i.CustomerId',
  'HAVING count(*) >= 7',
  'LIMIT 100',
  'SELECT (',
  '\ti.CustomerId AS customer',
  '\tcount(*) AS total',
  ')',
  '',
].join('\n');

const JOINED = [
  'parameters (',
  '  @CustomerId integer required',
  ')',
  'from Invoice as i',
  '-- keep this relationship query comment',
  'join Customer as c',
  '  on i.CustomerId = c.CustomerId -- keep the declared key note',
  'where i.CustomerId = @CustomerId',
  'order by i.InvoiceId',
  'limit 100 -- keep the row-limit note',
  'select (',
  '  i.InvoiceId as id',
  '  i.InvoiceDate',
  '  c.FirstName as first_name',
  '  c.Email as contact',
  ')',
  '',
].join('\n');

const composeChanges = (changes: Partial<{
  grouped: boolean;
  includeInvoiceDate: boolean;
  limit: number;
}> = {}) => ({
  grouped: changes.grouped ?? false,
  includeInvoiceDate: changes.includeInvoiceDate ?? true,
  countExpression: 'star' as const,
  havingOperator: '>=' as const,
  threshold: 7,
  limit: changes.limit ?? 100,
});

describe('author compose profile', () => {
  it('admits only the declared parameterized Invoice-to-Customer scan for joined Compose', () => {
    expect(parseTugQL(JOINED).diagnostics).toEqual([]);
    expect(readAuthorComposeProfile(JOINED)).toMatchObject({
      supported: true,
      writable: true,
      grouped: false,
      joined: true,
      customerAlias: 'c',
      includeInvoiceDate: true,
      invoiceDateToggleSupported: true,
      limit: 100,
    });
  });

  it.each([
    JOINED.replace('i.CustomerId = c.CustomerId', 'i.CustomerId = c.InvoiceId'),
    JOINED.replace('order by i.InvoiceId', 'order by i.InvoiceId desc'),
    JOINED.replace('order by i.InvoiceId\n', ''),
    JOINED.replace('join Customer as c', 'left join Customer as c'),
    JOINED.replace('limit 100', 'group by i.CustomerId\nhaving count(*) > 1\nlimit 100'),
    JOINED.replace('i.InvoiceDate', 'c.InvoiceDate'),
  ])('keeps an unsupported joined query in Code without changing its draft', (source) => {
    expect(readAuthorComposeProfile(source)).toMatchObject({
      supported: false,
      writable: false,
    });
  });

  it('patches only the joined row limit and keeps ON, ordering, aliases, comments, and projection bytes', () => {
    const result = updateAuthorComposeSource(JOINED, composeChanges({ limit: 75 }));
    expect(result).toBe(JOINED.replace('limit 100 -- keep the row-limit note', 'limit 75 -- keep the row-limit note'));
    expect(readAuthorComposeProfile(result ?? '')).toMatchObject({
      supported: true,
      joined: true,
      limit: 75,
    });

    const numericComment = JOINED.replace(
      'limit 100 -- keep the row-limit note',
      'limit 100 -- reviewed 2024',
    );
    expect(
      updateAuthorComposeSource(numericComment, composeChanges({ limit: 75 })),
    ).toBe(numericComment.replace('limit 100', 'limit 75'));
  });

  it('removes and restores only InvoiceDate in a joined block SELECT while retaining comments and other aliases', () => {
    const withoutDate = updateAuthorComposeSource(
      JOINED,
      composeChanges({ includeInvoiceDate: false }),
    );
    expect(withoutDate).toBe(
      JOINED.replace('  i.InvoiceDate\n', ''),
    );
    expect(withoutDate).toContain('join Customer as c');
    expect(withoutDate).toContain('order by i.InvoiceId');
    expect(withoutDate).toContain('c.FirstName as first_name');
    expect(withoutDate).toContain('c.Email as contact');
    expect(readAuthorComposeProfile(withoutDate ?? '')).toMatchObject({
      supported: true,
      joined: true,
      includeInvoiceDate: false,
    });

    const withDate = updateAuthorComposeSource(
      withoutDate ?? '',
      composeChanges({ includeInvoiceDate: true }),
    );
    expect(withDate).toBe(
      (withoutDate ?? '').replace(
        '  i.InvoiceId as id\n',
        '  i.InvoiceId as id\n  i.InvoiceDate\n',
      ),
    );
    expect(parseTugQL(withDate ?? '').diagnostics).toEqual([]);
    expect(readAuthorComposeProfile(withDate ?? '')).toMatchObject({
      supported: true,
      joined: true,
      includeInvoiceDate: true,
    });
  });

  it.each([
    JOINED.replace('  i.InvoiceDate\n', '  i.InvoiceDate as issued\n'),
    JOINED.replace('  i.InvoiceDate\n', '  i.InvoiceDate -- keep this field note\n'),
    JOINED.replace(
      '  i.InvoiceDate\n  c.FirstName as first_name\n',
      '  c.FirstName as first_name\n  i.InvoiceDate\n',
    ),
  ])('keeps joined InvoiceDate fixed when toggling would lose authored details', (source) => {
    expect(readAuthorComposeProfile(source)).toMatchObject({
      supported: true,
      joined: true,
      invoiceDateToggleSupported: false,
    });
    expect(readAuthorComposeProfile(source).invoiceDateToggleReason).toContain(
      'InvoiceDate is fixed',
    );
    expect(
      updateAuthorComposeSource(source, composeChanges({ includeInvoiceDate: false })),
    ).toBeUndefined();
    const limited = updateAuthorComposeSource(source, composeChanges({ limit: 75 }));
    expect(limited).toBe(source.replace('limit 100', 'limit 75'));
  });

  it('keeps a projection named InvoiceDate from colliding with a newly enabled field', () => {
    const withoutDate = JOINED
      .replace('  i.InvoiceDate\n', '')
      .replace('  c.FirstName as first_name', '  c.FirstName as InvoiceDate');
    expect(readAuthorComposeProfile(withoutDate)).toMatchObject({
      supported: true,
      joined: true,
      includeInvoiceDate: false,
      invoiceDateToggleSupported: false,
    });
    expect(
      updateAuthorComposeSource(withoutDate, composeChanges({ includeInvoiceDate: true })),
    ).toBeUndefined();
  });

  it('disables InvoiceDate when adding it would exceed six joined outputs', () => {
    const sixColumnNoDate = JOINED
      .replace('  i.InvoiceDate\n', '')
      .replace(
        '  i.InvoiceId as id\n',
        '  i.InvoiceId as id\n  i.InvoiceId as invoice_copy\n  i.CustomerId as invoice_customer\n',
      )
      .replace('  c.Email as contact\n', '  c.LastName as surname\n  c.Email as contact\n');
    expect(parseTugQL(sixColumnNoDate).diagnostics).toEqual([]);
    expect(readAuthorComposeProfile(sixColumnNoDate)).toMatchObject({
      supported: true,
      joined: true,
      includeInvoiceDate: false,
      invoiceDateToggleSupported: false,
    });
    expect(
      updateAuthorComposeSource(sixColumnNoDate, composeChanges({ includeInvoiceDate: true })),
    ).toBeUndefined();
    expect(
      updateAuthorComposeSource(
        sixColumnNoDate,
        composeChanges({ includeInvoiceDate: false, limit: 75 }),
      ),
    ).toBe(sixColumnNoDate.replace('limit 100', 'limit 75'));
  });

  it('never uses structural grouping regeneration for a joined scan', () => {
    expect(updateAuthorComposeSource(JOINED, composeChanges({ grouped: true }))).toBeUndefined();
  });

  it('reads the maintained Invoice source without changing its text', () => {
    const before = SIMPLE;
    const profile = readAuthorComposeProfile(SIMPLE);

    expect(profile).toMatchObject({
      supported: true,
      writable: true,
      grouped: false,
      includeInvoiceDate: true,
      limit: 100,
    });
    expect(SIMPLE).toBe(before);
  });

  it('updates a supported projection through formatted, reparsed TugQL', () => {
    const result = updateAuthorComposeSource(SIMPLE, {
      grouped: false,
      includeInvoiceDate: false,
      countExpression: 'star',
      havingOperator: '>=',
      threshold: 7,
      limit: 25,
    });
    expect(result).toBeDefined();
    expect(parseTugQL(result ?? '').diagnostics).toEqual([]);
    expect(result).toContain('limit 25');
    expect(result).toContain('select i.InvoiceId');
    expect(result).not.toContain('InvoiceDate');
    expect(readAuthorComposeProfile(result ?? '').supported).toBe(true);
  });

  it('round-trips declared schema, table alias, and projection aliases', () => {
    const aliased = SIMPLE
      .replace(
        'select i.InvoiceId, i.InvoiceDate',
        'select i.InvoiceId as id, i.InvoiceDate as issued',
      )
      .replace('from Invoice as i', 'from main.Invoice as inv')
      .replaceAll('i.', 'inv.');
    const result = updateAuthorComposeSource(aliased, {
      grouped: false,
      includeInvoiceDate: true,
      countExpression: 'star',
      havingOperator: '>=',
      threshold: 7,
      limit: 24,
    });
    expect(readAuthorComposeProfile(aliased)).toMatchObject({
      supported: true,
      schema: 'main',
      tableAlias: 'inv',
      invoiceIdAlias: 'id',
      invoiceDateAlias: 'issued',
    });
    expect(result).toContain('from main.Invoice as inv');
    expect(result).toContain('select inv.InvoiceId as id, inv.InvoiceDate as issued');
  });

  it('preserves grouped COUNT and HAVING choices when updating the threshold and limit', () => {
    const result = updateAuthorComposeSource(GROUPED, {
      grouped: true,
      includeInvoiceDate: false,
      countExpression: 'InvoiceId',
      havingOperator: '>',
      threshold: 12,
      limit: 50,
    });
    expect(result).toContain('having count(i.InvoiceId) > 12');
    expect(result).toContain('limit 50');
    expect(parseTugQL(result ?? '').diagnostics).toEqual([]);
    expect(readAuthorComposeProfile(result ?? '')).toMatchObject({
      supported: true,
      grouped: true,
      countExpression: 'InvoiceId',
      havingOperator: '>',
      threshold: 12,
      limit: 50,
    });
  });

  it('keeps grouped output aliases while changing only the threshold', () => {
    const aliased = GROUPED.replace(
      'select i.CustomerId, count(*) as InvoiceCount',
      'select i.CustomerId as customer, count(*) as total',
    );
    const result = updateAuthorComposeSource(aliased, {
      grouped: true,
      includeInvoiceDate: false,
      countExpression: 'star',
      havingOperator: '>=',
      threshold: 9,
      limit: 100,
    });
    expect(result).toContain('select i.CustomerId as customer, count(*) as total');
  });

  it('patches only HAVING and LIMIT literals while preserving uppercase, tabs, and block SELECT layout', () => {
    expect(parseTugQL(STYLED_GROUPED).diagnostics).toEqual([]);
    const styledProfile = readAuthorComposeProfile(STYLED_GROUPED);
    expect(styledProfile.reason).toBeUndefined();
    expect(styledProfile).toMatchObject({
      supported: true,
      grouped: true,
      countExpression: 'star',
      havingOperator: '>=',
      threshold: 7,
    });
    const result = updateAuthorComposeSource(STYLED_GROUPED, {
      grouped: true,
      includeInvoiceDate: false,
      countExpression: 'star',
      havingOperator: '>',
      threshold: 12,
      limit: 25,
    });
    expect(result).toBe(
      STYLED_GROUPED.replace('HAVING count(*) >= 7', 'HAVING count(*) > 12').replace(
        'LIMIT 100',
        'LIMIT 25',
      ),
    );
  });

  it('rejects a legacy comma-separated multiline projection without changing its draft', () => {
    const source = [
      'PARAMETERS (',
      '\t@CustomerId INTEGER REQUIRED',
      ')',
      'FROM main.Invoice AS i',
      'WHERE i.CustomerId = @CustomerId',
      'LIMIT 100',
      'SELECT',
      '\ti.InvoiceId AS id,',
      '\ti.InvoiceDate AS issued',
      '',
    ].join('\n');
    const result = updateAuthorComposeSource(source, {
      grouped: false,
      includeInvoiceDate: false,
      countExpression: 'star',
      havingOperator: '>=',
      threshold: 7,
      limit: 100,
    });
    expect(parseTugQL(source).diagnostics).toMatchObject([
      {
        code: 'invalid_select',
        message: "multiline SELECT requires '(' on the SELECT header line",
      },
    ]);
    expect(result).toBeUndefined();
    expect(readAuthorComposeProfile(source)).toMatchObject({
      supported: false,
      writable: false,
    });
    expect(source).toContain('\ti.InvoiceId AS id,\n\ti.InvoiceDate AS issued');
  });

  it('refuses to expand a legacy bare multiline projection and retains its draft', () => {
    const source = [
      'PARAMETERS (',
      '\t@CustomerId INTEGER REQUIRED',
      ')',
      'FROM main.Invoice AS i',
      'WHERE i.CustomerId = @CustomerId',
      'LIMIT 100',
      'SELECT',
      '\ti.InvoiceId AS id',
      '',
    ].join('\n');
    const result = updateAuthorComposeSource(source, {
      grouped: false,
      includeInvoiceDate: true,
      countExpression: 'star',
      havingOperator: '>=',
      threshold: 7,
      limit: 100,
    });
    expect(parseTugQL(source).diagnostics).toMatchObject([
      {
        code: 'invalid_select',
        message: "multiline SELECT requires '(' on the SELECT header line",
      },
    ]);
    expect(result).toBeUndefined();
    expect(readAuthorComposeProfile(source)).toMatchObject({
      supported: false,
      writable: false,
    });
    expect(source).toContain('\ti.InvoiceId AS id\n');
  });

  it('removes an optional projection from an approved comma-free parenthesized block', () => {
    const source = [
      'PARAMETERS (',
      '\t@CustomerId INTEGER REQUIRED',
      ')',
      'FROM main.Invoice AS i',
      'WHERE i.CustomerId = @CustomerId',
      'LIMIT 100',
      'SELECT (',
      '\ti.InvoiceId AS id',
      '\ti.InvoiceDate AS issued',
      ')',
      '',
    ].join('\n');
    expect(parseTugQL(source).diagnostics).toEqual([]);
    expect(readAuthorComposeProfile(source)).toMatchObject({
      supported: true,
      writable: true,
      includeInvoiceDate: true,
    });
    const result = updateAuthorComposeSource(source, {
      grouped: false,
      includeInvoiceDate: false,
      countExpression: 'star',
      havingOperator: '>=',
      threshold: 7,
      limit: 100,
    });
    expect(result).toBe(source.replace('\ti.InvoiceDate AS issued\n', ''));
    expect(result).not.toMatch(/InvoiceId\s*,/u);
    expect(parseTugQL(result ?? '').diagnostics).toEqual([]);
    expect(readAuthorComposeProfile(result ?? '')).toMatchObject({
      supported: true,
      writable: true,
      includeInvoiceDate: false,
    });
  });

  it('adds an optional projection to an approved comma-free parenthesized block', () => {
    const source = [
      'PARAMETERS (',
      '\t@CustomerId INTEGER REQUIRED',
      ')',
      'FROM main.Invoice AS i',
      'WHERE i.CustomerId = @CustomerId',
      'LIMIT 100',
      'SELECT (',
      '\ti.InvoiceId AS id',
      ')',
      '',
    ].join('\n');
    expect(parseTugQL(source).diagnostics).toEqual([]);
    expect(readAuthorComposeProfile(source)).toMatchObject({
      supported: true,
      writable: true,
      includeInvoiceDate: false,
    });
    const result = updateAuthorComposeSource(source, {
      grouped: false,
      includeInvoiceDate: true,
      countExpression: 'star',
      havingOperator: '>=',
      threshold: 7,
      limit: 100,
    });
    expect(result).toBe(
      source.replace(
        '\ti.InvoiceId AS id\n',
        '\ti.InvoiceId AS id\n\ti.InvoiceDate\n',
      ),
    );
    expect(result).not.toMatch(/InvoiceId\s*,/u);
    expect(parseTugQL(result ?? '').diagnostics).toEqual([]);
    expect(readAuthorComposeProfile(result ?? '')).toMatchObject({
      supported: true,
      writable: true,
      includeInvoiceDate: true,
    });
  });

  it('uses authored uppercase and tab style when a structural Compose edit regenerates the source', () => {
    const source = [
      'PARAMETERS (',
      '\t@CustomerId INTEGER REQUIRED',
      ')',
      'FROM main.Invoice AS i',
      'WHERE i.CustomerId = @CustomerId',
      'LIMIT 100',
      'SELECT i.InvoiceId AS id',
      '',
    ].join('\n');
    const result = updateAuthorComposeSource(source, {
      grouped: true,
      includeInvoiceDate: false,
      countExpression: 'star',
      havingOperator: '>=',
      threshold: 7,
      limit: 100,
    });
    expect(result).toContain('\t@CustomerId INTEGER REQUIRED');
    expect(result).toContain('FROM main.Invoice AS i');
    expect(result).toContain('GROUP BY i.CustomerId');
    expect(result).toContain('HAVING count(*) >= 7');
    expect(result).toContain('SELECT i.CustomerId, count(*) AS InvoiceCount');
    expect(result).not.toContain('\n  @CustomerId');
  });

  it.each([
    `${SIMPLE}\n-- keep this note`,
    SIMPLE.replace('select i.InvoiceId, i.InvoiceDate', 'select i.CustomerId'),
    SIMPLE.replace('limit 100', 'limit 101'),
    SIMPLE.replace('where i.CustomerId = @CustomerId', 'where i.CustomerId = 1'),
  ])('refuses Compose for unsupported source without replacing its text', (source) => {
    expect(readAuthorComposeProfile(source).supported).toBe(false);
    expect(
      updateAuthorComposeSource(source, {
        grouped: false,
        includeInvoiceDate: false,
        countExpression: 'star',
        havingOperator: '>=',
        threshold: 7,
        limit: 20,
      }),
    ).toBeUndefined();
    expect(source).toContain('parameters (');
  });
});
