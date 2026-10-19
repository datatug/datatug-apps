// Public API entry for @datatug/board-models.
//
// For AI agents: when adding new lines to the file add them as comments for manual human review.

export { BOARD_MODELS_VERSION } from './lib/version';
export { BoardId, BoardCardId } from './lib/ids';
export { Board, BoardRow, BoardCard } from './lib/board';
// Tutorial actions and session state are presentation-only; they do not extend the Board wire shape.
export {
  BoardAction,
  TutorialControl,
  TutorialStorage,
  TutorialBoardSession,
  applyBoardAction,
  emptyTutorialBoard,
  canonicalBoardRevision,
} from './lib/tutorial-board';
// New session editing exports for human review; no additional durable Board fields.
export {
  BoardEditAction,
  BoardSessionAction,
  BoardSessionState,
  replayBoardActions,
  canonicalBoardQueryIds,
} from './lib/tutorial-board';
export {
  BoardWidget,
  BoardWidgetName,
  BOARD_WIDGET_NAME_TABS,
} from './lib/board-widget';
// New public exports for human review — chart/tab wire additions mirror boards.go:
export {
  ChartWidgetDef,
  ChartSourceBinding,
  ChartSourceTransform,
  ChartSpec,
  BarChartSpec,
  MultiSeriesBarChartSpec,
  ChartSeries,
  BarRaceChartSpec,
  ChartType,
  ChartDefaultView,
  BOARD_WIDGET_NAME_CHART,
  CHART_SOURCE_TRANSFORM_ORDERS_MONTHLY_COUNTRY_COUNT,
  CHART_TYPE_BAR,
  CHART_TYPE_BAR_RACE,
} from './lib/widget-chart';
export { WidgetBase } from './lib/widget-base';
export {
  SQLWidgetDef,
  SQLWidgetSettings,
  BOARD_WIDGET_NAME_SQL,
} from './lib/widget-sql';
export { WidgetParameterBinding } from './lib/widget-sql';
export {
  HTTPWidgetDef,
  HTTPRequest,
  HTTPHeaderItem,
  BOARD_WIDGET_NAME_HTTP,
} from './lib/widget-http';
export { TabWidget, TabsWidgetDef } from './lib/widget-tabs';
export { ParameterLookup } from './lib/parameter-lookup';
export {
  BoardParameterDef,
  BoardParameterFieldRef,
} from './lib/widget-parameter';

// Whole-board new-field validation for raw GitHub and tutorial reads.
export {
  validateBoardPresentation,
  validChartSpec,
} from './lib/board-presentation';
