// Public API entry — see ../public_api.ts.

import { WidgetBase } from './widget-base';
import { WidgetParameterBinding } from './widget-sql';

/** The `BoardWidget.name` value that selects `ChartWidgetDef` (boards.go `"chart"`). */
export const BOARD_WIDGET_NAME_CHART = 'chart' as const;

/** The only persisted chart source transform currently admitted by boards.go. */
export const CHART_SOURCE_TRANSFORM_ORDERS_MONTHLY_COUNTRY_COUNT = 'orders-monthly-country-count' as const;

/** Persisted chart types currently admitted by boards.go. */
export const CHART_TYPE_BAR = 'bar' as const;
export const CHART_TYPE_BAR_RACE = 'bar-race' as const;
export type ChartType = typeof CHART_TYPE_BAR | typeof CHART_TYPE_BAR_RACE;

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

/** Mirrors `ChartSpec` (boards.go) field for field. */
export interface ChartSpec {
  type: ChartType;
  categoryColumn: string;
  valueColumn: string;
  periodColumn?: string;
  unit?: string;
  grain?: 'month';
  onDuplicate?: 'sum' | 'reject';
  mode?: 'period' | 'cumulative';
  topN?: number;
}
