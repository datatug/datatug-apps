import type { EvidenceShareSelection } from '../../../evidence/evidence-share-panel.component';
import { IParameterValueWithoutID } from '../parameter';
import type { QueryRuntimeTarget } from '../../../queries/query-dispatch';
import type { OvdbConnection } from '../../../ovdb/ovdb-connection';

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
  /** Explicit runtime sharing selection, never part of a persisted Board. */
  evidenceSelection?: EvidenceShareSelection;
  parameters: Record<string, IParameterValueWithoutID>;
  environment?: string;
  /** Runtime selection is explicit context, independent of project storage. */
  executionTarget?: QueryRuntimeTarget;
  securityContextId?: string;
  runtimeBinding?: OvdbConnection;
}
