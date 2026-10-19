import type { Board } from './board';
import type { ChartSpec } from './widget-chart';
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.trim() === value;
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

/** Closed new chart branches mirror Core's wire, including null/absent distinctions. */
export function validChartSpec(value: unknown): value is ChartSpec {
  if (!record(value) || !text(value['categoryColumn'])) return false;
  const common = ['type', 'categoryColumn', 'valueColumn', 'unit'];
  if (value['type'] === 'bar') {
    if (!keys(value, [...common, 'series', 'selectionId'])) return false;
    if ('selectionId' in value && !text(value['selectionId'])) return false;
    if ('series' in value) {
      const series = value['series'];
      return (
        !('valueColumn' in value) &&
        text(value['unit']) &&
        Array.isArray(series) &&
        series.length >= 2 &&
        series.length <= 8 &&
        series.every(
          (item) =>
            record(item) &&
            keys(item, ['id', 'title', 'valueColumn']) &&
            text(item['id']) &&
            text(item['title']) &&
            text(item['valueColumn']) &&
            item['valueColumn'] !== value['categoryColumn'],
        ) &&
        new Set(series.map((item) => item['id'])).size === series.length &&
        new Set(series.map((item) => item['valueColumn'])).size ===
          series.length
      );
    }
    return (
      text(value['valueColumn']) &&
      value['valueColumn'] !== value['categoryColumn'] &&
      (value['unit'] === undefined ||
        value['unit'] === '' ||
        text(value['unit']))
    );
  }
  return (
    value['type'] === 'bar-race' &&
    keys(value, [
      ...common,
      'periodColumn',
      'grain',
      'onDuplicate',
      'mode',
      'topN',
    ]) &&
    text(value['valueColumn']) &&
    text(value['periodColumn']) &&
    text(value['unit']) &&
    new Set([
      value['categoryColumn'],
      value['valueColumn'],
      value['periodColumn'],
    ]).size === 3 &&
    value['grain'] === 'month' &&
    ['sum', 'reject'].includes(String(value['onDuplicate'])) &&
    ['period', 'cumulative'].includes(String(value['mode'])) &&
    Number.isSafeInteger(value['topN']) &&
    Number(value['topN']) >= 1 &&
    Number(value['topN']) <= 100
  );
}

/** Bounded pass across inactive tabs too. Does not execute or rewrite legacy widget data. */
export function validateBoardPresentation(board: unknown): readonly string[] {
  const producers = new Set<string>(),
    references: string[] = [];
  let remaining = 2048;
  const fail = (): never => {
    throw new Error('This board has an invalid chart or presentation filter.');
  };
  const visit = (widget: unknown, depth: number): void => {
    if (--remaining < 0 || depth > 32) fail();
    if (
      widget === undefined ||
      (record(widget) &&
        (!widget['name'] || widget['name'] === '') &&
        widget['data'] == null)
    )
      return;
    if (!record(widget)) return fail();
    const data = widget['data'];
    if (widget['name'] === 'chart') {
      if (
        !record(data) ||
        !validChartSpec(data['chart']) ||
        !Array.isArray(data['sources']) ||
        !data['sources'].length
      )
        return fail();
      if (
        !keys(data, [
          'title',
          'parameters',
          'sources',
          'chart',
          'defaultView',
        ]) ||
        (data['defaultView'] !== undefined &&
          !['chart', 'grid'].includes(String(data['defaultView'])))
      )
        fail();
      const sources = data['sources'];
      if (
        sources.some(
          (source) =>
            !record(source) || !text(source['id']) || !text(source['queryId']),
        ) ||
        new Set(sources.map((source) => source['id'])).size !== sources.length
      )
        fail();
      if (data['chart'].series && sources.length !== 1) fail();
      const selection = data['chart'].selectionId;
      if (selection) {
        if (producers.has(selection)) fail();
        producers.add(selection);
      }
    } else if (widget['name'] === 'SQL') {
      if (!record(data) || !record(data['sql'])) return fail();
      if (
        Object.keys(data['sql']).some(
          (key) =>
            key.toLowerCase() === 'presentationfilter' &&
            key !== 'presentationFilter',
        ) ||
        Object.keys(data).some(
          (key) => key.toLowerCase() === 'presentationfilter',
        )
      )
        fail();
      if ('presentationFilter' in data['sql']) {
        const filter = data['sql']['presentationFilter'];
        if (
          !record(filter) ||
          !keys(filter, ['selectionId', 'column']) ||
          !text(filter['selectionId']) ||
          !text(filter['column'])
        )
          return fail();
        references.push(filter['selectionId']);
      }
    } else if (widget['name'] === 'tabs') {
      if (!record(data) || !Array.isArray(data['tabs'])) return fail();
      for (const tab of data['tabs']) {
        if (!record(tab)) return fail();
        visit(tab['widget'], depth + 1);
      }
    }
  };
  if (
    !record(board) ||
    (board['rows'] !== undefined && !Array.isArray(board['rows']))
  )
    fail();
  for (const row of (board as Board).rows ?? []) {
    if (--remaining < 0) fail();
    if (
      !record(row) ||
      (row['cards'] !== undefined && !Array.isArray(row['cards']))
    )
      return fail();
    for (const card of row['cards'] ?? []) {
      if (--remaining < 0) fail();
      if (!record(card)) return fail();
      visit(card['widget'], 0);
    }
  }
  if (references.some((id) => !producers.has(id))) fail();
  return [...producers];
}
