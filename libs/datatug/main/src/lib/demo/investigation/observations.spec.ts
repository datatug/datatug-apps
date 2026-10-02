import { describe, expect, it } from 'vitest';
import { formatFixed, roundHalfEven } from './format';
import { computeObservations, toPerCapitaRows, type PerCapitaRow } from './observations';

// The Go CLI's rows for demo-project-1 (see federated-query-chinook-sales-per-capita.spec.ts).
const rows: PerCapitaRow[] = ([
  ['Ireland', 45.62, 5484367], ['Czech Republic', 90.24, 10886878], ['Finland', 41.62, 5646436], ['Canada', 303.96, 41651653],
  ['Portugal', 77.24, 10804871], ['Norway', 39.62, 5610870], ['Denmark', 37.62, 6009169], ['Hungary', 45.62, 9514251],
  ['Austria', 42.62, 9208163], ['Sweden', 38.62, 10596620], ['Belgium', 37.62, 11941781], ['France', 195.1, 68720337],
  ['Chile', 46.62, 19859921], ['Netherlands', 40.62, 18087633], ['Germany', 156.48, 83491249], ['United Kingdom', 112.86, 69487000],
  ['USA', 523.06, 341784857], ['Australia', 37.62, 27614411], ['Poland', 37.62, 36435861], ['Brazil', 190.1, 212812405],
  ['Argentina', 37.62, 45851378], ['Spain', 37.62, 49355143], ['Italy', 37.62, 58915656], ['India', 75.26, 1463865525],
] as const).map(([country, totalSales, population]) => ({ country, totalSales, population, salesPerMillion: totalSales / population * 1_000_000 }));

describe('observations computed from the result rows', () => {
  const observations = computeObservations(rows);

  it('finds the largest total against its rank per person', () => {
    expect(observations[0]).toEqual({
      id: 'largest-total', rowKeys: ['USA'],
      message: { key: 'obs.largestVsRank', params: { country: 'USA', total: '523.06', rank: 17, perMillion: '1.53' } },
    });
  });

  it('notes the near tie at the top, linked to both rows', () => {
    expect(observations[1]).toEqual({
      id: 'leader', rowKeys: ['Ireland', 'Czech Republic'],
      message: { key: 'obs.leaderNear', params: { first: 'Ireland', a: '8.32', second: 'Czech Republic', b: '8.29' } },
    });
  });

  it('notes that small countries dominate, linked to the nine small rows (Canada is the exception)', () => {
    expect(observations[2].id).toBe('small-countries');
    expect(observations[2].message).toEqual({ key: 'obs.small', params: { n: 9, k: 10, m: '20' } });
    expect(observations[2].rowKeys).toHaveLength(9);
    expect(observations[2].rowKeys).not.toContain('Canada');
  });

  it('every row key is a country in the result', () => {
    const countries = new Set(rows.map((row) => row.country));
    for (const observation of observations) for (const key of observation.rowKeys) expect(countries.has(key)).toBe(true);
  });

  it('says so when the largest total also leads per person, and uses a plain lead when the top two are apart', () => {
    const flipped = rows.map((row) => row.country === 'USA' ? { ...row, salesPerMillion: 100 } : row);
    const result = computeObservations(flipped);
    expect(result[0].message.key).toBe('obs.largestAlsoFirst');
    expect(result[1].message.key).toBe('obs.leader');
  });

  it('says nothing with fewer than two rows, and skips "small countries" when they do not dominate', () => {
    expect(computeObservations(rows.slice(0, 1))).toEqual([]);
    const big = rows.map((row) => ({ ...row, population: 90_000_000 }));
    expect(computeObservations(big).map((observation) => observation.id)).toEqual(['largest-total', 'leader']);
  });

  it('formats numbers for the language', () => {
    expect(computeObservations(rows, 'ru')[0].message.params['total']).toBe('523,06');
  });

  it('ignores rows that are not this shape', () => {
    expect(toPerCapitaRows([{ country: 'X' }, { country: 'Y', totalSales: 1, population: 2, salesPerMillion: 3 }])).toHaveLength(1);
  });
});

describe('display rounding', () => {
  it('rounds half to even on the decimal digits', () => {
    expect(roundHalfEven(0.125, 2)).toBe(0.12);
    expect(roundHalfEven(0.135, 2)).toBe(0.14);
    expect(roundHalfEven(8.318188771830915, 2)).toBe(8.32);
    expect(roundHalfEven(90.24000000000001, 2)).toBe(90.24);
  });
  it('formats fixed places', () => {
    expect(formatFixed(8.3181, 2)).toBe('8.32');
    expect(formatFixed(45.6, 2)).toBe('45.60');
  });
});
