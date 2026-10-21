// Public API entry — see ../public_api.ts.

import type { EvidenceChartSpec } from '@sneat/datatug-semantic';

import { WidgetBase } from './widget-base';
import { WidgetParameterBinding } from './widget-sql';

/** The `BoardWidget.name` value that selects `ChartWidgetDef` (boards.go `"chart"`). */
export const BOARD_WIDGET_NAME_CHART = 'chart' as const;

/** The only persisted chart source transform currently admitted by boards.go. */
export const CHART_SOURCE_TRANSFORM_ORDERS_MONTHLY_COUNTRY_COUNT =
  'orders-monthly-country-count' as const;

/** Persisted chart types currently admitted by boards.go. */
export const CHART_TYPE_BAR = 'bar' as const;
export const CHART_TYPE_BAR_RACE = 'bar-race' as const;
export type ChartType =
  | typeof CHART_TYPE_BAR
  | typeof CHART_TYPE_BAR_RACE
  | EvidenceChartSpec['type'];

/** Persisted view choices currently admitted by boards.go. */
export type ChartDefaultView = 'chart' | 'grid';

/** Mirrors `ChartWidgetDef` (boards.go) field for field: `WidgetBase` is inlined. */
export interface ChartWidgetDef extends WidgetBase {
  sources: ChartSourceBinding[];
  chart: ChartSpec;
  defaultView?: ChartDefaultView;
}

/** Mirrors `ChartSourceBinding` (boards.go) field for field. */
export interface ChartSourceBinding {
  id: string;
  queryId: string;
  parameters?: WidgetParameterBinding[];
  transform?: ChartSourceTransform;
}

/** Mirrors `ChartSourceTransform` (boards.go) field for field. */
export interface ChartSourceTransform {
  name: typeof CHART_SOURCE_TRANSFORM_ORDERS_MONTHLY_COUNTRY_COUNT;
  orderIdColumn: string;
  dateColumn: string;
  countryColumn: string;
}

/** Mirrors the `bar` branch accepted by `ChartSpec.Validate()` (boards.go). */
export interface BarChartSpec {
  type: typeof CHART_TYPE_BAR;
  categoryColumn: string;
  valueColumn: string;
  series?: never;
  selectionId?: string;
  unit?: string;
  periodColumn?: never;
  grain?: never;
  onDuplicate?: never;
  mode?: never;
  topN?: never;
}

/** Mirrors Core's grouped bar branch; every measure comes from one held result. */
export interface ChartSeries {
  id: string;
  title: string;
  valueColumn: string;
}
export interface MultiSeriesBarChartSpec extends Omit<
  BarChartSpec,
  'valueColumn' | 'series' | 'unit'
> {
  valueColumn?: never;
  series: ChartSeries[];
  unit: string;
}

/** Mirrors the `bar-race` branch accepted by `ChartSpec.Validate()` (boards.go). */
export interface BarRaceChartSpec {
  type: typeof CHART_TYPE_BAR_RACE;
  series?: never;
  selectionId?: never;
  categoryColumn: string;
  valueColumn: string;
  periodColumn: string;
  unit: string;
  grain: 'month';
  onDuplicate: 'sum' | 'reject';
  mode: 'period' | 'cumulative';
  /** Core validates this to the inclusive range 1 through 100. */
  topN: number;
}

/** Mirrors `ChartSpec` (boards.go), with validated chart variants represented as a discriminated union. */
/** Core evidence variants reuse the shared mapping contract, never cached rows. */
export type EvidenceBoardChartSpec = EvidenceChartSpec & {
  categoryColumn?: never;
  valueColumn?: never;
  series?: never;
  unit?: never;
  periodColumn?: never;
  grain?: never;
  onDuplicate?: never;
  mode?: never;
  topN?: never;
};
export type ChartSpec =
  | EvidenceBoardChartSpec
  | BarChartSpec
  | MultiSeriesBarChartSpec
  | BarRaceChartSpec;
