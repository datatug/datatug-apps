import { IAstJoin, SqlParser } from './sql-parser';

describe('SqlParser', () => {
  const parser = new SqlParser();

  describe('parseQuery', () => {
    it('throws when text is missing', () => {
      expect(() => parser.parseQuery(undefined as unknown as string)).toThrow(
        'text is a required parameter',
      );
    });

    it('returns empty joins and order for an empty string', () => {
      expect(parser.parseQuery('')).toEqual({ joins: [], orderBy: [] });
    });

    it.each([
      ['FROM dbo.Users AS u', { schema: 'dbo', name: 'Users', alias: 'u' }],
      ['from sales.Orders o', { schema: 'sales', name: 'Orders', alias: 'o' }],
      ['FROM x.T', { schema: 'x', name: 'T', alias: undefined }],
    ])('parses FROM in %j', (sql, from) => {
      expect(parser.parseQuery(`SELECT * ${sql}`).from).toEqual(from);
    });

    it('parses joins, including commented-out ones, and ORDER BY', () => {
      const sql =
        'SELECT *\n' +
        'FROM dbo.Orders o\n' +
        'INNER JOIN dbo.Customers AS c ON c.ID = o.CustomerID\n' +
        '-- LEFT JOIN Products p ON p.ID = o.ProductID\n' +
        'ORDER BY o.Date DESC, c.Name,';
      const q = parser.parseQuery(sql);
      expect(q.from).toEqual({ schema: 'dbo', name: 'Orders', alias: 'o' });
      expect(q.joins?.map(({ match, ...j }) => ({ ...j, index: match.index })))
        .toEqual([
          {
            comment: '',
            disabled: false,
            side: 'INNER',
            schema: 'dbo',
            name: 'Customers',
            alias: 'c',
            index: sql.indexOf('INNER'),
          },
          {
            comment: '-- ',
            disabled: true,
            side: 'LEFT',
            schema: 'dbo',
            name: 'Products',
            alias: 'p',
            index: sql.indexOf('-- LEFT'),
          },
        ]);
      expect(q.orderBy).toEqual(['o.Date DESC', 'c.Name']);
    });

    it('can be reused: the global join regex is reset between calls', () => {
      const sql = 'SELECT 1 FROM a.B b\nCROSS JOIN C c\n';
      expect(parser.parseQuery(sql).joins).toHaveLength(1);
      expect(parser.parseQuery(sql).joins).toHaveLength(1);
    });
  });

  describe('uncommentJoin', () => {
    const sql = 'SELECT *\nFROM dbo.A a\n-- LEFT JOIN B b ON b.ID = a.ID\n';

    it('removes the comment prefix of a disabled join', () => {
      const join = parser.parseQuery(sql).joins?.[0] as IAstJoin;
      expect(parser.uncommentJoin(sql, join)).toBe(
        'SELECT *\nFROM dbo.A a\nLEFT JOIN B b ON b.ID = a.ID\n',
      );
    });

    it('leaves an enabled join unchanged', () => {
      const enabled = sql.replace('-- ', '');
      const join = parser.parseQuery(enabled).joins?.[0] as IAstJoin;
      expect(parser.uncommentJoin(enabled, join)).toBe(enabled);
    });

    it('returns the text unchanged when the match has no index', () => {
      const join = { match: ['x'] as RegExpMatchArray } as IAstJoin;
      expect(parser.uncommentJoin(sql, join)).toBe(sql);
    });
  });
});
