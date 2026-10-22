import type { TypedValue } from '@sneat/datatug-semantic';
import type { IProjectRef } from '../../core/project-context';

/** Where a parameter input lives: what the picker needs to know about its host. */
export interface ParameterLookupContext {
  readonly projectRef?: IProjectRef;
  /** The host's environment, when it has one. */
  readonly environment?: string | null;
  /** The host's own catalog connection (a saved query's `connectionId`); boards and cards have none. */
  readonly hostConnectionId?: string;
}

export interface ParameterLookupSourceOption {
  readonly id: string;
  readonly label: string;
}

export interface ParameterLookupColumnView {
  readonly name: string;
  readonly label: string;
  readonly key: boolean;
}

/** One answer of a lookup search. The key is always the first cell of a row. */
export interface ParameterLookupPage {
  readonly collection: string;
  readonly columns: readonly ParameterLookupColumnView[];
  readonly rows: readonly (readonly TypedValue[])[];
  /** More rows exist than are shown. */
  readonly limited: boolean;
  readonly limitNotice?: string;
  /** Set when the display columns were guessed. */
  readonly inferredNote?: string;
  /** Set when this source cannot serve the lookup; no rows then. */
  readonly unavailable?: string;
  readonly limitations?: readonly string[];
}

/** Everything the lookup dialog needs; one implementation per runtime. */
export interface ParameterLookupProvider {
  /** "Customer" — the meaning's entity label, or the parameter label for an explicit lookup. */
  readonly subject: string;
  readonly sources: readonly ParameterLookupSourceOption[];
  readonly preselectedSourceId?: string;
  /** Where the list comes from, shown under the searchbar, e.g. "Northwind sample, pinned". */
  readonly sourceNote?: string;
  /**
   * Set when the parameter's meaning was inferred from its name rather than
   * declared (REQ:inferred-parameter-meaning); the dialog shows it.
   */
  readonly meaningNote?: string;
  search(sourceId: string, filter: string, signal: AbortSignal): Promise<ParameterLookupPage>;
  /**
   * Optional check run when the dialog opens, before any search, that narrows
   * several possible sources to the usable ones (for example, those whose
   * primary key really is the mapped column).
   */
  prepare?(signal: AbortSignal): Promise<ParameterLookupPreparation>;
}

export interface ParameterLookupPreparation {
  readonly sources: readonly ParameterLookupSourceOption[];
  readonly preselectedSourceId?: string;
  /** Set when no source is usable; the dialog shows it instead of rows. */
  readonly unavailable?: string;
}

/** What the dialog dismisses with when the user picks a row. */
export interface ParameterLookupResult {
  readonly value: TypedValue;
}
