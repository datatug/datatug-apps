import { Injectable, signal } from '@angular/core';
import {
  Board,
  BoardSessionAction,
  BoardWidget,
  TutorialBoardSession,
  canonicalBoardQueryIds,
  canonicalBoardRevision,
  replayBoardActions,
  SQLWidgetDef,
  ChartWidgetDef,
} from '@datatug/board-models';
import { IProjectRef, projectRefToString } from '../../core/project-context';
import { widgetAtTabPath } from '../ui/components/board-widget/nested-tab-path';

interface TutorialRuntimeState {
  readonly session: TutorialBoardSession;
  readonly scope: string;
  readonly selections: Readonly<Record<string, string>>;
  readonly dispatch: (action: BoardSessionAction) => void;
}

/** Page-scoped browser memory. It neither reads nor writes project storage. */
@Injectable()
export class TutorialBoardRuntime {
  readonly state = signal<TutorialRuntimeState | undefined>(undefined);

  publish(
    ref: IProjectRef,
    session: TutorialBoardSession,
    dispatch: (action: BoardSessionAction) => void,
  ): void {
    const scope = projectRefToString(ref);
    this.state.set(
      scope
        ? { session, scope, selections: session.presentation, dispatch }
        : undefined,
    );
  }

  clear(): void {
    this.state.set(undefined);
  }

  activeFor(
    ref: IProjectRef | undefined,
    boardId: string | undefined,
  ): boolean {
    const state = this.state();
    return (
      !!ref &&
      !!state &&
      state.scope === projectRefToString(ref) &&
      state.session.canonical.id === boardId
    );
  }

  selectedTab(
    cardId: string | undefined,
    path: readonly string[],
  ): string | undefined {
    return cardId
      ? this.state()?.selections[JSON.stringify([cardId, ...path])]
      : undefined;
  }

  dispatch(action: BoardSessionAction): void {
    this.state()?.dispatch(action);
  }

  /** Re-read canonical first. A session is an editing request, never an authorization receipt. */
  async admit(
    canonical: Board,
    ref: IProjectRef,
    cardId: string,
    path: readonly string[],
    expected: BoardWidget,
  ): Promise<boolean> {
    const state = this.state();
    if (!state || !this.activeFor(ref, canonical.id)) return false;
    if ((await canonicalBoardRevision(canonical)) !== state.session.revision)
      return false;
    const current = this.state();
    if (current?.session !== state.session || current.scope !== state.scope)
      return false;
    const history = state.session.history;
    // Replay validates the entire bounded history, including the redo tail.
    const replayed = replayBoardActions(
      canonical,
      history.actions,
      history.cursor,
    ).board;
    const cards = (replayed.rows ?? [])
      .flatMap((row) => row.cards ?? [])
      .filter((card) => card.id === cardId);
    if (cards.length !== 1) return false;
    const widget = widgetAtTabPath(cards[0].widget, path);
    if (!widget || JSON.stringify(widget) !== JSON.stringify(expected))
      return false;
    const queries = new Set(canonicalBoardQueryIds(canonical));
    if (widget.name === 'SQL')
      return queries.has((widget.data as SQLWidgetDef).sql.queryId ?? '');
    if (widget.name !== 'chart') return false;
    const sources = (widget.data as ChartWidgetDef).sources;
    // Composition is not admitted by the single-source execution path.
    return sources?.length === 1 && queries.has(sources[0].queryId);
  }
}
