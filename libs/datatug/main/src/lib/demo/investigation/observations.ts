// Observations about a result, computed from its rows and nothing else.
//
// Every number in an observation is a value the grid shows (after the same rounding) or a rank computed
// from those rows. No AI is involved: these are facts about this result, worded from fixed templates.
import type { TraceMessage } from '../../chat/chat-trace.types';
import { formatFixed, formatInteger } from './format';
import { msg } from '../trace/trace-recorder';

export interface PerCapitaRow {
  readonly country: string;
  readonly totalSales: number;
  readonly population: number;
  readonly salesPerMillion: number;
}

export interface Observation {
  readonly id: string;
  readonly message: TraceMessage;
  /** The countries (row keys) this observation rests on; the UI highlights them in the grid and the chart. */
  readonly rowKeys: readonly string[];
}

/** Under this many people counts as a small country for the "small countries dominate" observation. */
export const SMALL_COUNTRY_POPULATION = 20_000_000;
/** Gap, as a share of the leader's value, under which the top two count as nearly tied. */
export const NEAR_TIE_SHARE = 0.05;
export const TOP_COUNT = 10;

export function toPerCapitaRows(rows: readonly Record<string, unknown>[]): PerCapitaRow[] {
  return rows.flatMap((row) => {
    const { country, totalSales, population, salesPerMillion } = row;
    if (typeof country !== 'string' || typeof totalSales !== 'number' || typeof population !== 'number' || typeof salesPerMillion !== 'number') return [];
    return [{ country, totalSales, population, salesPerMillion }];
  });
}

export function computeObservations(rows: readonly PerCapitaRow[], locale = 'en'): readonly Observation[] {
  if (rows.length < 2) return [];
  const byRate = [...rows].sort((a, b) => b.salesPerMillion - a.salesPerMillion);
  const byTotal = [...rows].sort((a, b) => b.totalSales - a.totalSales);
  const observations: Observation[] = [];

  const biggest = byTotal[0];
  const rank = byRate.findIndex((row) => row.country === biggest.country) + 1;
  observations.push({
    id: 'largest-total',
    rowKeys: [biggest.country],
    message: rank === 1
      ? msg('obs.largestAlsoFirst', { country: biggest.country, total: formatFixed(biggest.totalSales, 2, locale), perMillion: formatFixed(biggest.salesPerMillion, 2, locale) })
      : msg('obs.largestVsRank', { country: biggest.country, total: formatFixed(biggest.totalSales, 2, locale), rank, perMillion: formatFixed(biggest.salesPerMillion, 2, locale) }),
  });

  const [first, second] = byRate;
  const near = first.salesPerMillion > 0 && (first.salesPerMillion - second.salesPerMillion) / first.salesPerMillion < NEAR_TIE_SHARE;
  observations.push({
    id: 'leader',
    rowKeys: [first.country, second.country],
    message: msg(near ? 'obs.leaderNear' : 'obs.leader', {
      first: first.country, a: formatFixed(first.salesPerMillion, 2, locale), second: second.country, b: formatFixed(second.salesPerMillion, 2, locale),
    }),
  });

  const top = byRate.slice(0, TOP_COUNT);
  const small = top.filter((row) => row.population < SMALL_COUNTRY_POPULATION);
  if (top.length === TOP_COUNT && small.length >= Math.ceil(TOP_COUNT * 0.7)) {
    observations.push({
      id: 'small-countries',
      rowKeys: small.map((row) => row.country),
      message: msg('obs.small', { n: small.length, k: top.length, m: formatInteger(SMALL_COUNTRY_POPULATION / 1_000_000, locale) }),
    });
  }
  return observations;
}
