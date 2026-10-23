import { validBoardParameterDefinitions } from './widget-parameter';
import type { Board } from './board';
import type { ChartWidgetDef, ChartSpec } from './widget-chart';
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.trim() === value;
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

/** Closed new chart branches mirror Core's wire, including null/absent distinctions. */
export function validChartSpec(value: unknown): value is ChartSpec {
  if (!record(value)) return false;
  if (value['type'] === 'timeline' || value['type'] === 'timing-bars' || value['type'] === 'heatmap') {
    const arm =
      value['type'] === 'timing-bars' ? 'timing' : (value['type'] as string);
    const fields =
      arm === 'timeline'
        ? [
            'laneColumn',
            'eventColumn',
            'sequenceColumn',
            'timeColumn',
            'clockDomainColumn',
            'precisionColumn',
            'statusColumn',
            'evidenceRefColumn',
          ]
        : arm === 'heatmap'
          ? ['rowColumn', 'columnColumn', 'statusColumn', 'evidenceRefColumn']
          : [
              'rowKeyColumn',
              'labelColumn',
              'startTimeColumn',
              'endTimeColumn',
              'startClockDomainColumn',
              'endClockDomainColumn',
              'startPrecisionColumn',
              'endPrecisionColumn',
              'startEvidenceRefColumn',
              'endEvidenceRefColumn',
              'startIdentityColumn',
              'endIdentityColumn',
            ];
    // Go strings.TrimSpace: NEL is whitespace; BOM is a valid non-space rune.
    const coreSpace = (character: string): boolean => {
      const code = character.charCodeAt(0);
      return (
        (code >= 9 && code <= 13) ||
        (code >= 0x2000 && code <= 0x200a) ||
        [
          0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
        ].includes(code)
      );
    };
    const canonicalText = (v: unknown): v is string =>
      typeof v === 'string' &&
      v.length > 0 &&
      !coreSpace(v[0]) &&
      !coreSpace(v[v.length - 1]);
    if (
      !keys(value, ['type', 'selectionId', arm]) ||
      !canonicalText(value['selectionId'])
    )
      return false;
    const mapping = value[arm];
    if (!record(mapping) || !keys(mapping, arm === 'timeline' ? [...fields, 'timeMode', 'anchorColumn'] : fields)) return false;
    if (arm === 'timeline') {
      if ('timeMode' in mapping && mapping['timeMode'] !== 'absolute' && mapping['timeMode'] !== 'elapsed') return false;
      if (mapping['timeMode'] === 'elapsed') fields.push('anchorColumn');
      else if ('anchorColumn' in mapping) return false;
    }
    const seen = new Set<string>();
    for (const field of fields) {
      const column = mapping[field];
      if (!canonicalText(column)) return false;
      if (
        (field === 'endClockDomainColumn' &&
          column === mapping['startClockDomainColumn']) ||
        (field === 'endPrecisionColumn' &&
          column === mapping['startPrecisionColumn'])
      )
        continue;
      if (seen.has(column)) return false;
      seen.add(column);
    }
    return true;
  }
  if (!text(value['categoryColumn'])) return false;
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

/** Shared raw-wire admission for saved charts and tutorial edits. */
export function validateChartDefinition(
  value: unknown,
): asserts value is ChartWidgetDef {
  if (
    !record(value) ||
    !keys(value, ['title', 'parameters', 'sources', 'chart', 'defaultView']) ||
    !validChartSpec(value['chart']) ||
    !Array.isArray(value['sources']) ||
    !value['sources'].length ||
    (value['defaultView'] !== undefined &&
      !['', 'chart', 'grid'].includes(String(value['defaultView'])))
  )
    throw new Error('Invalid chart configuration.');
  const chart = value['chart'];
  const sources = value['sources'];
  if (
    ['bar-race', 'timeline', 'timing-bars', 'heatmap'].includes(chart.type) &&
    sources.length !== 1
  )
    throw new Error(
      'The board wire contract requires one source for a bar race.',
    );
  if (chart.series && sources.length !== 1)
    throw new Error('Grouped bars require one source.');
  const validSourceBindings = (items: unknown): boolean =>
    items == null ||
    (Array.isArray(items) &&
      items.every(
        (item) =>
          record(item) &&
          keys(item, ['id', 'value', 'boardParameterId']) &&
          typeof item['id'] === 'string' &&
          !!item['id'] &&
          (item['boardParameterId'] === undefined ||
            typeof item['boardParameterId'] === 'string') &&
          !(item['value'] != null && item['boardParameterId']),
      ) &&
      new Set(items.map((item) => item['id'])).size === items.length);
  if (!validBoardParameterDefinitions(value['parameters']))
    throw new Error('Invalid chart parameters.');
  const ids = new Set<string>();
  for (const source of sources) {
    if (
      !record(source) ||
      !keys(source, ['id', 'queryId', 'parameters', 'transform']) ||
      !text(source['id']) ||
      !text(source['queryId']) ||
      ids.has(source['id']) ||
      !validSourceBindings(source['parameters'])
    )
      throw new Error('Chart sources need distinct IDs and saved queries.');
    ids.add(source['id']);
    const transform = source['transform'];
    if (transform == null) continue;
    if (
      !record(transform) ||
      !keys(transform, [
        'name',
        'orderIdColumn',
        'dateColumn',
        'countryColumn',
      ]) ||
      transform['name'] !== 'orders-monthly-country-count' ||
      !text(transform['orderIdColumn']) ||
      !text(transform['dateColumn']) ||
      !text(transform['countryColumn']) ||
      new Set([
        transform['orderIdColumn'],
        transform['dateColumn'],
        transform['countryColumn'],
      ]).size !== 3 ||
      chart.type !== 'bar-race' ||
      chart.periodColumn !== 'period' ||
      chart.categoryColumn !== 'category' ||
      chart.valueColumn !== 'value' ||
      chart.onDuplicate !== 'reject'
    )
      throw new Error(
        'The Orders transform requires its canonical race mapping.',
      );
  }
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
      validateChartDefinition(data);
      const selection = data['chart'].selectionId;
      if (selection) {
        if (producers.has(selection)) fail();
        producers.add(selection);
      }
    } else if (widget['name'] === 'SQL') {
      // Parameter-sourced rows carry no saved query and nothing to filter on.
      if (
        record(data) &&
        data['sql'] === undefined &&
        record(data['source']) &&
        keys(data['source'], ['parameter'])
      )
        return;
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
      if (data == null) return;
      if (!record(data)) return fail();
      if (data['tabs'] == null) return;
      if (!Array.isArray(data['tabs'])) return fail();
      for (const tab of data['tabs']) {
        if (!record(tab)) return fail();
        visit(tab['widget'], depth + 1);
        if (tab['widgets'] != null) {
          if (!Array.isArray(tab['widgets'])) return fail();
          for (const inner of tab['widgets']) visit(inner, depth + 1);
        }
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
