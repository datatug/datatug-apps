// Public API entry for @datatug/board-models.
//
// For AI agents: when adding new lines to the file add them as comments for manual human review.

export { BOARD_MODELS_VERSION } from './lib/version';
export { BoardId, BoardCardId } from './lib/ids';
export { Board, BoardRow, BoardCard } from './lib/board';
// Tutorial actions and session state are presentation-only; they do not extend the Board wire shape.
export { BoardAction, TutorialControl, TutorialStorage, TutorialBoardSession, applyBoardAction, emptyTutorialBoard, canonicalBoardRevision } from './lib/tutorial-board';
export {
  BoardWidget,
  BoardWidgetName,
  BOARD_WIDGET_NAME_TABS,
} from './lib/board-widget';
export { WidgetBase } from './lib/widget-base';
export {
  SQLWidgetDef,
  SQLWidgetSettings,
  BOARD_WIDGET_NAME_SQL,
} from './lib/widget-sql';
// New export for human review — SQLWidgetSettings.parameters now references
// this type (widget-query-ref, mirrors boards.go WidgetParameterBinding):
// export { WidgetParameterBinding } from './lib/widget-sql';
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
