import { IParameterValueWithoutID } from '../parameter';

// The wire-schema board types (Board, BoardRow, BoardCard, BoardWidget and
// the widget defs) come from `@datatug/board-models`
// (libs/datatug/board-models), generated field-for-field from
// datatug-core's `boards.go`. The three interfaces below are UI-local state
// with no `boards.go` equivalent and stay here.

export interface IWidgetPosition {
  rowIndex: number;
  colIndex: number;
}

export interface IBoardWidgetInstance {
  initBoardWidget?: (position: IWidgetPosition) => void;
}

export interface IBoardContext {
  mode: 'edit' | 'view';
  parameters: Record<string, IParameterValueWithoutID>;
}
