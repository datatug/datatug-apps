import { parseTugQL } from '@dalgo/core';
import { useInvoiceIdAsAuthorFilter } from './author-row-filter-edit';

const SOURCE = [
  'parameters (',
  '  @CustomerId integer required',
  ')',
  'from Invoice as i',
  'join Customer as c',
  '  on i.CustomerId = c.CustomerId',
  'where i.CustomerId = @CustomerId',
  'order by i.InvoiceId',
  'limit 100',
  'select i.InvoiceId, i.InvoiceDate',
  '',
].join('\n');

describe('Use executed InvoiceId as an Author filter', () => {
  it('adds only the admitted literal and leaves other authored bytes intact', () => {
    const source = [
      'PARAMETERS (',
      '  @CustomerId INTEGER REQUIRED',
      ')',
      'FROM Invoice AS i',
      'JOIN Customer AS c',
      '  ON i.CustomerId = c.CustomerId',
      'WHERE i.CustomerId = @CustomerId  -- keep 東京',
      'ORDER BY i.InvoiceId',
      'LIMIT 100',
      'SELECT i.InvoiceId, i.InvoiceDate',
      '',
    ].join('\r\n');
    const edit = useInvoiceIdAsAuthorFilter(source, '143');
    expect(edit.ok ? '' : edit.reason).toBe('');
    if (!edit.ok) return;
    expect(edit.after).toBe(
      source.replace(
        'WHERE i.CustomerId = @CustomerId  -- keep 東京',
        'WHERE i.CustomerId = @CustomerId AND i.InvoiceId = 143  -- keep 東京',
      ),
    );
    expect(parseTugQL(edit.after).diagnostics).toEqual([]);
  });

  it('replaces an existing admitted literal and rejects unrelated predicates or bad values', () => {
    const first = useInvoiceIdAsAuthorFilter(SOURCE, '143');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replaced = useInvoiceIdAsAuthorFilter(first.after, '121');
    expect(replaced.ok).toBe(true);
    if (replaced.ok)
      expect(replaced.after).toContain(
        'where i.CustomerId = @CustomerId and i.InvoiceId = 121',
      );
    expect(useInvoiceIdAsAuthorFilter(SOURCE, '0')).toMatchObject({
      ok: false,
    });
    expect(
      useInvoiceIdAsAuthorFilter(SOURCE, '9007199254740993'),
    ).toMatchObject({ ok: false });
    expect(
      useInvoiceIdAsAuthorFilter(
        SOURCE.replace(
          'where i.CustomerId = @CustomerId',
          'where i.CustomerId = @CustomerId or i.InvoiceId = 143',
        ),
        '121',
      ),
    ).toMatchObject({ ok: false });
    expect(
      useInvoiceIdAsAuthorFilter(
        SOURCE.replace(
          'where i.CustomerId = @CustomerId',
          'where i.InvoiceId = 143',
        ),
        '121',
      ),
    ).toMatchObject({ ok: false });
  });
});
