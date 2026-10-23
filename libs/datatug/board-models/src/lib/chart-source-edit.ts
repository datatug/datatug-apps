import { validateChartDefinition } from './board-presentation';
import type { ChartWidgetDef } from './widget-chart';

export type ChartSourceEdit =
  | {
      readonly type: 'add-chart-source';
      readonly sourceId: string;
      readonly queryId: string;
    }
  | { readonly type: 'remove-chart-source'; readonly sourceId: string };

/** Shared definition/session operation. Execution and semantic unit confirmation remain separate. */
export function editChartSources(
  definition: ChartWidgetDef,
  edit: ChartSourceEdit,
  authorizedQueryIds: readonly string[],
): ChartWidgetDef {
  validateChartDefinition(definition);
  if (
    definition.chart.type !== 'bar' ||
    definition.chart.series ||
    !definition.chart.unit?.trim()
  )
    throw new Error(
      'Independent sources require a plain bar chart with a declared common unit.',
    );
  let sources = definition.sources;
  if (edit.type === 'add-chart-source') {
    if (sources.length >= 2)
      throw new Error('Compare at most two independent sources.');
    if (!authorizedQueryIds.includes(edit.queryId))
      throw new Error('Choose a currently available saved query.');
    if (
      sources.some(
        (source) =>
          source.id === edit.sourceId || source.queryId === edit.queryId,
      )
    )
      throw new Error(
        'The chart already contains this source ID or saved query.',
      );
    sources = [...sources, { id: edit.sourceId, queryId: edit.queryId }];
  } else {
    if (sources.length === 1)
      throw new Error('Keep at least one chart source.');
    if (sources.filter((source) => source.id === edit.sourceId).length !== 1)
      throw new Error('The chart source no longer exists.');
    sources = sources.filter((source) => source.id !== edit.sourceId);
  }
  const next = { ...definition, sources };
  validateChartDefinition(next);
  return next;
}

/** Only a subset of unmodified canonical bindings may seed a normal add-card action. */
export function seedChartSources(
  definition: ChartWidgetDef,
  ids: readonly string[],
): ChartWidgetDef {
  validateChartDefinition(definition);
  if (
    definition.chart.type !== 'bar' ||
    definition.chart.series ||
    !definition.chart.unit?.trim() ||
    !ids.length ||
    ids.length > 2 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !definition.sources.some((source) => source.id === id))
  )
    throw new Error(
      'Choose a nonempty subset of the canonical plain-bar source IDs.',
    );
  const sources = definition.sources.filter((source) =>
    ids.includes(source.id),
  );
  return { ...definition, sources };
}
