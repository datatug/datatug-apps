import { IParameterDef, IParameterValueWithoutID } from '../parameter';
import { WidgetDef } from './widget-def';

// NOTE: this is a pre-existing, independently-evolved copy of the board
// schema, not a re-export of `@datatug/board-models` (libs/datatug/board-models,
// generated field-for-field from datatug-core's boards.go). It has already
// diverged from boards.go in ways that are not a pure rename (extra
// `description`/`related` fields here, no `boards.go` equivalent; widget-def
// shapes differ, e.g. `ISqlWidgetSettings` carries `db`/`env`/`hideColumns`
// via `ICommandDefinition` where boards.go's `SQLWidgetSettings` is `{ query }`
// only) — see @datatug/board-models's README ("Relationship to
// libs/datatug/main's existing board types") for the full list. Swapping
// these 9 consumer files over to the new package is therefore a real
// behaviour change, not a pure re-export, so it is left as-is here; not done
// in this change.

export interface IBoardDef {
  id: string;
  title: string;
  description?: string;
  rows?: IBoardRowDef[];
  parameters?: IParameterDef[];
  tags?: string[];
  related?: {
    boards?: string[];
  };
}

export interface IBoardRowDef {
  minHeight?: string;
  maxHeight?: string;
  cards?: IBoardCardDef[]; // No more then 4 cards per row as we have only 12 available columns
}

export interface IBoardCardDef {
  id: string; // Card ID, good to have for reordering for example
  title: string;
  cols?: number; // Specifies how many of 12 available columns it can take
  widget?: WidgetDef;
}

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
