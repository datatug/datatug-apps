import { readFileSync } from 'node:fs';
import { executePinnedSql } from './public-sqlite-query.worker';

const fixturePath = process.env['DATATUG_CHINOOK_FIXTURE'];
const sqlPath = process.env['DATATUG_CHINOOK_GENRE_SQL'];

it.skipIf(!fixturePath || !sqlPath)(
  'runs the saved Customer Genre Mix against the pinned Chinook fixture',
  async () => {
    const sql = readFileSync(sqlPath!, 'utf8');
    const fixture = readFileSync(fixturePath!);
    const result = await executePinnedSql(sql, fixture);
    expect(result.columns).toEqual([
      'GenreId',
      'Genre',
      'InvoiceCount',
      'TotalCents',
    ]);
    expect(result.rows).toEqual([
      [1, 'Rock', 4, 1485],
      [3, 'Metal', 2, 594],
      [19, 'TV Shows', 1, 398],
      [4, 'Alternative & Punk', 2, 396],
      [9, 'Pop', 1, 396],
      [2, 'Jazz', 1, 297],
      [7, 'Latin', 1, 297],
      [21, 'Drama', 1, 199],
    ]);
  },
);
