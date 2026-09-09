import { describe, expect, it } from 'vitest';
import { Board } from './board';
import boardFixtureJson from './__fixtures__/board.fixture.json';
import { BOARD_WIDGET_NAME_TABS } from './board-widget';
import { HTTPWidgetDef, BOARD_WIDGET_NAME_HTTP } from './widget-http';
import { SQLWidgetDef, BOARD_WIDGET_NAME_SQL } from './widget-sql';
import { TabsWidgetDef } from './widget-tabs';
import { BOARD_MODELS_VERSION } from './version';

// `boardFixtureJson satisfies Board` is the compile-time half of the
// round-trip assertion: if a field in board.fixture.json (hand-written from
// boards.go's struct tags) stops matching the TS shape, `nx build`/`tsc`
// fails here before any test runs.
const boardFixture = boardFixtureJson satisfies Board;

describe('Board JSON shape (fixture derived from boards.go struct tags)', () => {
  it('exposes a semver-ish version constant', () => {
    expect(BOARD_MODELS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
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
    expect(boardFixture.requiredParams).toEqual([
      ['year'],
      ['region', 'year'],
    ]);
  });

  it('types a SQL widget card end to end', () => {
    const card = boardFixture.rows?.[0]?.cards?.[0];
    expect(card?.id).toBe('card-revenue');
    expect(card?.widget?.name).toBe(BOARD_WIDGET_NAME_SQL);

    const sqlDef = card?.widget?.data as SQLWidgetDef;
    expect(sqlDef.sql.query).toContain('SUM(amount)');
    expect(sqlDef.parameters?.[0]?.id).toBe('year');
  });

  it('types a nested tabs widget (tab -> SQL, tab -> HTTP) end to end', () => {
    const card = boardFixture.rows?.[0]?.cards?.[1];
    expect(card?.widget?.name).toBe(BOARD_WIDGET_NAME_TABS);

    const tabsDef = card?.widget?.data as TabsWidgetDef;
    expect(tabsDef.tabs).toHaveLength(2);

    const sqlTabWidget = tabsDef.tabs[0].widget;
    expect(sqlTabWidget?.name).toBe(BOARD_WIDGET_NAME_SQL);
    expect((sqlTabWidget?.data as SQLWidgetDef).sql.query).toContain('region');

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
});
