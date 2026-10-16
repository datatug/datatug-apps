import { describe, expect, it } from 'vitest';
import { Board } from './board';
import boardFixtureJson from './__fixtures__/board.fixture.json';
import chartBoardFixtureJson from './__fixtures__/chart-board.fixture.json';
import packageJson from '../../package.json';
import { BOARD_WIDGET_NAME_TABS } from './board-widget';
import { HTTPWidgetDef, BOARD_WIDGET_NAME_HTTP } from './widget-http';
import { SQLWidgetDef, BOARD_WIDGET_NAME_SQL } from './widget-sql';
import { TabsWidgetDef } from './widget-tabs';
import { BOARD_MODELS_VERSION } from './version';
import {
  ChartWidgetDef,
  BOARD_WIDGET_NAME_CHART,
  CHART_TYPE_BAR_RACE,
  ChartSpec,
} from '../public_api';

// `boardFixtureJson satisfies Board` is the compile-time half of the
// round-trip assertion: if a field in board.fixture.json (hand-written from
// boards.go's struct tags) stops matching the TS shape, `nx build`/`tsc`
// fails here before any test runs.
function fixtureAccess(value: string): Board['access'] {
  if (value === 'private' || value === 'protected' || value === 'public') return value;
  throw new Error(`Unsupported fixture access: ${value}`);
}
const boardFixture = { ...boardFixtureJson, access: fixtureAccess(boardFixtureJson.access) } satisfies Board;
const chartBoardFixture = chartBoardFixtureJson satisfies Board;

describe('Board JSON shape (fixture derived from boards.go struct tags)', () => {
  it('exposes a semver-ish version constant', () => {
    expect(BOARD_MODELS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BOARD_MODELS_VERSION).toBe(packageJson.version);
  });

  it('accepts the fixture as a Board and round-trips through JSON losslessly', () => {
    const board: Board = boardFixture;

    // Round-trip: encode then decode must reproduce the exact same JSON —
    // proves the TS shape has no field the JSON encoder would drop or rename.
    const roundTripped = JSON.parse(JSON.stringify(board));
    expect(roundTripped).toEqual(boardFixtureJson);
  });

  it('carries the top-level ProjectItem-derived fields flattened onto Board', () => {
    expect(boardFixture.id).toBe('sales-overview');
    expect(boardFixture.title).toBe('Sales overview');
    expect(boardFixture.folder).toBe('~/dashboards');
    expect(boardFixture.tags).toEqual(['sales', 'demo']);
    expect(boardFixture.userIds).toEqual(['u1']);
    expect(boardFixture.access).toBe('protected');
  });

  it('carries its own parameters and requiredParams, mirroring ProjBoardBrief', () => {
    expect(boardFixture.parameters).toHaveLength(2);
    expect(boardFixture.parameters?.[0]).toEqual({
      id: 'year',
      type: 'integer',
      title: 'Year',
      isRequired: true,
      defaultValue: 2026,
    });
    expect(boardFixture.parameters?.[1]).toEqual({
      id: 'region',
      type: 'string',
      isMultiValue: true,
    });
    expect(boardFixture.requiredParams).toEqual([['year'], ['region', 'year']]);
  });

  it('types a SQL widget card end to end', () => {
    const card = boardFixture.rows?.[0]?.cards?.[0];
    expect(card?.id).toBe('card-revenue');
    expect(card?.widget?.name).toBe(BOARD_WIDGET_NAME_SQL);

    const sqlDef = card?.widget?.data as SQLWidgetDef;
    expect(sqlDef.sql.queryId).toBe('q-revenue-by-month');
    expect(sqlDef.sql.parameters?.[0]).toEqual({
      id: 'year',
      boardParameterId: 'year',
    });
    expect(sqlDef.parameters?.[0]?.id).toBe('year');
  });

  it('types a nested tabs widget (tab -> SQL, tab -> HTTP) end to end', () => {
    const card = boardFixture.rows?.[0]?.cards?.[1];
    expect(card?.widget?.name).toBe(BOARD_WIDGET_NAME_TABS);

    const tabsDef = card?.widget?.data as TabsWidgetDef;
    expect(tabsDef.tabs).toHaveLength(2);

    const sqlTabWidget = tabsDef.tabs[0].widget;
    expect(sqlTabWidget?.name).toBe(BOARD_WIDGET_NAME_SQL);
    const sqlTabDef = sqlTabWidget?.data as SQLWidgetDef;
    expect(sqlTabDef.sql.queryId).toBe('q-revenue-by-region');
    expect(sqlTabDef.sql.parameters?.[0]).toEqual({
      id: 'region',
      value: 'EMEA',
    });

    const httpTabWidget = tabsDef.tabs[1].widget;
    expect(httpTabWidget?.name).toBe(BOARD_WIDGET_NAME_HTTP);
    const httpDef = httpTabWidget?.data as HTTPWidgetDef;
    expect(httpDef.request.method).toBe('GET');
    expect(httpDef.request.headers?.[0]).toEqual({
      name: 'Accept',
      value: 'application/json',
    });
  });

  it('types an HTTP widget card with a looked-up parameter', () => {
    const card = boardFixture.rows?.[1]?.cards?.[0];
    expect(card?.widget?.name).toBe(BOARD_WIDGET_NAME_HTTP);

    const httpDef = card?.widget?.data as HTTPWidgetDef;
    expect(httpDef.request.method).toBe('POST');
    expect(httpDef.parameters?.[0]?.meta).toEqual({
      entity: 'Customer',
      field: 'ID',
    });
    expect(httpDef.parameters?.[0]?.lookup?.db).toBe('sales');
  });

  it('accepts and round-trips chart widgets and stable tab IDs without runtime data', () => {
    const board: Board = chartBoardFixture;
    expect(JSON.parse(JSON.stringify(board))).toEqual(chartBoardFixtureJson);

    const card = board.rows?.[0]?.cards?.[0];
    expect(card?.widget?.name).toBe(BOARD_WIDGET_NAME_TABS);
    const tabsDef = card?.widget?.data as TabsWidgetDef;
    expect(tabsDef.tabs[0].id).toBe('monthly-orders');
    expect(tabsDef.tabs[1].id).toBeUndefined();
    expect(tabsDef.tabs[0].widget?.name).toBe(BOARD_WIDGET_NAME_CHART);

    const typedRaceSpec: ChartSpec = {
      type: CHART_TYPE_BAR_RACE,
      categoryColumn: 'category',
      valueColumn: 'value',
      periodColumn: 'period',
      unit: 'orders',
      grain: 'month',
      onDuplicate: 'reject',
      mode: 'cumulative',
      topN: 10,
    };
    const typedChartWidget: ChartWidgetDef = {
      sources: [{
        id: 'orders',
        queryId: 'q-orders',
        parameters: [{ id: 'year', boardParameterId: 'year' }],
        transform: {
          name: 'orders-monthly-country-count',
          orderIdColumn: 'OrderID',
          dateColumn: 'OrderDate',
          countryColumn: 'ShipCountry',
        },
      }],
      chart: typedRaceSpec,
      defaultView: 'chart',
    };
    const chartData: unknown = tabsDef.tabs[0].widget?.data;
    expect(chartData).toEqual(typedChartWidget);
    expect(chartData).not.toHaveProperty('rows');
    expect(chartData).not.toHaveProperty('receipt');
    const chartDef = typedChartWidget;
    expect(chartDef.chart.type).toBe(CHART_TYPE_BAR_RACE);
    expect(chartData).not.toHaveProperty('sources.0.rows');
    expect(chartData).not.toHaveProperty('sources.0.receipt');

    const simpleBar: ChartWidgetDef = {
      sources: [{ id: 'revenue', queryId: 'q-revenue' }],
      chart: { type: 'bar', categoryColumn: 'month', valueColumn: 'revenue' },
      defaultView: 'grid',
    };
    expect(JSON.parse(JSON.stringify(simpleBar))).toEqual({
      sources: [{ id: 'revenue', queryId: 'q-revenue' }],
      chart: { type: 'bar', categoryColumn: 'month', valueColumn: 'revenue' },
      defaultView: 'grid',
    });

    // @ts-expect-error Core rejects race-only options on a plain bar chart.
    const invalidBar: ChartSpec = { type: 'bar', categoryColumn: 'month', valueColumn: 'revenue', grain: 'month' };
    // @ts-expect-error Core requires all bar-race options.
    const incompleteRace: ChartSpec = { type: 'bar-race', categoryColumn: 'month', valueColumn: 'revenue' };
    void invalidBar;
    void incompleteRace;
  });
});
