import { describe, expect, it } from 'vitest';
import { MAX_QUESTION_BYTES, matchScenarioByQuestion, normaliseQuestion, parseHandoff, scenarioById, SCENARIOS } from './demo-scenarios';

describe('hand-off URL', () => {
  it('parses scenario, question and language', () => {
    expect(parseHandoff('?scenario=countries-music-per-capita&q=Which+countries+buy+the+most+music%3F&lang=ru')).toEqual({
      scenario: 'countries-music-per-capita', question: 'Which countries buy the most music?', lang: 'ru',
    });
  });

  it('resolves the design document\'s scenario id as an alias', () => {
    expect(parseHandoff('?scenario=sales-per-capita').scenario).toBe('countries-music-per-capita');
  });

  it('keeps an unknown or custom scenario so the page can say so, and never throws', () => {
    expect(parseHandoff('?scenario=something-else&q=hi')).toEqual({ unknownScenario: 'something-else', question: 'hi' });
    expect(parseHandoff('?scenario=custom')).toEqual({ unknownScenario: 'custom' });
    expect(parseHandoff('')).toEqual({});
    expect(parseHandoff('?lang=de')).toEqual({});
    expect(parseHandoff('?%E0%A4%A')).toBeDefined();
  });

  it('cuts a long question at the byte limit, on a character boundary', () => {
    const long = 'я'.repeat(800); // 2 bytes each
    const parsed = parseHandoff(`?q=${encodeURIComponent(long)}`);
    expect(new TextEncoder().encode(parsed.question ?? '').length).toBeLessThanOrEqual(MAX_QUESTION_BYTES);
    expect(parsed.question).toBe('я'.repeat(500));
  });
});

describe('scenarios', () => {
  it('lists three curated scenarios and only the first can run in this release', () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual(['countries-music-per-capita', 'jazz-artists', 'customer-artist-path']);
    expect(SCENARIOS.map((scenario) => scenario.available)).toEqual([true, false, false]);
  });

  it('matches the canonical question and its known wordings after normalisation, in English and Russian', () => {
    for (const wording of [
      'Which countries buy the most music relative to their population?',
      '  which COUNTRIES buy the most music relative to their population ',
      'Music sales per capita by country',
      'Какие страны покупают больше всего музыки на душу населения?',
    ]) expect(matchScenarioByQuestion(wording)?.id).toBe('countries-music-per-capita');
    expect(matchScenarioByQuestion('who spends most on tunes?')).toBeUndefined();
  });

  it('normalises punctuation and case', () => {
    expect(normaliseQuestion(' Hello,   World?! ')).toBe('hello world');
  });

  it('finds a scenario by id or alias', () => {
    expect(scenarioById('jazz-artists')?.available).toBe(false);
    expect(scenarioById('nope')).toBeUndefined();
    expect(scenarioById(undefined)).toBeUndefined();
  });
});
