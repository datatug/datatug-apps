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

describe('author compose profile', () => {
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
