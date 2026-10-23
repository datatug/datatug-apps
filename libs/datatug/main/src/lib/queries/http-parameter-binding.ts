import type { ContextSnapshot } from '../session-context/session-context-contract';
import {
  renderHttpParameterValue,
  type HttpParameterDecl,
} from './http-template';

/**
 * Where an HTTP query parameter's run value came from (spec
 * http-query-parameters REQ:binding-sources), in precedence order.
 */
export type HttpValueSource = 'typed' | 'row' | 'board' | 'bag' | 'default';

export const HTTP_VALUE_SOURCE_LABEL: Readonly<Record<HttpValueSource, string>> = {
  typed: 'typed',
  row: 'row',
  board: 'board',
  bag: 'context bag',
  default: 'default',
};

export interface HttpMeaningRef {
  readonly entity: string;
  readonly field: string;
}

/** The one selected result row a run binds from (REQ:multi-row-selection). */
export interface HttpRowBinding {
  readonly columns: readonly {
    readonly name: string;
    readonly meta?: HttpMeaningRef;
  }[];
  readonly values: readonly unknown[];
  /** Human label of the row's source, e.g. "requests row 3". */
  readonly label?: string;
}

/** A session context bag entry reduced to what binding reads (REQ:context-bag-binding). */
export interface HttpBagEntry {
  readonly entity: string;
  readonly field: string;
  readonly kind: 'scalar' | 'set';
  readonly value?: unknown;
}

export interface HttpBindingSources {
  /** Values typed in the run panel for this run only. */
  readonly typed?: Readonly<Record<string, unknown>>;
  readonly row?: HttpRowBinding;
  /** Board or card parameter bindings (WidgetParameterBinding), resolved to values by the board. */
  readonly board?: Readonly<Record<string, unknown>>;
  readonly bag?: readonly HttpBagEntry[];
  /** Row columns the user picked in the run panel, by parameter id; wins over the automatic match. */
  readonly rowColumns?: Readonly<Record<string, string>>;
}

export interface ResolvedHttpParameter {
  readonly id: string;
  readonly source?: HttpValueSource;
  readonly value?: unknown;
  /** The coerced text substituted into the request. */
  readonly rendered?: string;
  /** The row column a row value came from. */
  readonly column?: string;
  /** Why the run is blocked for this parameter. */
  readonly error?: string;
  /** Sources that offered a value the parameter refuses (a credential takes typed values only). */
  readonly refused?: readonly HttpValueSource[];
}

const missing = (v: unknown) => v === undefined || v === null || v === '';

const sameMeaning = (a: HttpMeaningRef | undefined, b: HttpMeaningRef | undefined) =>
  !!a && !!b && a.entity === b.entity && a.field === b.field;

/** The row column a parameter binds to: meaning first, then the column name, case-insensitively (REQ:row-binding). */
export function rowColumnFor(
  def: Pick<HttpParameterDecl, 'id' | 'meta'>,
  row: HttpRowBinding,
): number {
  const meta = def.meta as HttpMeaningRef | undefined;
  const byMeta = meta ? row.columns.findIndex((c) => sameMeaning(c.meta, meta)) : -1;
  if (byMeta >= 0) return byMeta;
  const id = def.id.toLowerCase();
  return row.columns.findIndex((c) => c.name.toLowerCase() === id);
}

/** True when every parameter without a default can bind from the row (the row action lists such queries). */
export function canBindFromRow(
  defs: readonly HttpParameterDecl[],
  row: HttpRowBinding,
): boolean {
  const needed = defs.filter((d) => !d.isCredential && d.defaultValue === undefined);
  return (
    defs.some((d) => !d.isCredential && rowColumnFor(d, row) >= 0) &&
    needed.every((d) => rowColumnFor(d, row) >= 0)
  );
}

/**
 * Resolves each declared parameter from the first source that supplies a
 * value: typed > row > board > bag > default. A credential parameter takes a
 * typed value only. A value that cannot be coerced to the type blocks the
 * run naming the parameter and its source; there is no silent fallback.
 */
export function resolveHttpParameters(
  defs: readonly HttpParameterDecl[],
  sources: HttpBindingSources,
): ResolvedHttpParameter[] {
  return defs.map((def) => {
    const offers: { source: HttpValueSource; value: unknown; column?: string }[] = [];
    const typed = sources.typed?.[def.id];
    if (!missing(typed)) offers.push({ source: 'typed', value: typed });
    if (sources.row) {
      const picked = sources.rowColumns?.[def.id];
      const pickedAt = picked
        ? sources.row.columns.findIndex((c) => c.name === picked)
        : -1;
      const i = pickedAt >= 0 ? pickedAt : rowColumnFor(def, sources.row);
      if (i >= 0 && !missing(sources.row.values[i]))
        offers.push({ source: 'row', value: sources.row.values[i], column: sources.row.columns[i].name });
    }
    const board = sources.board?.[def.id];
    if (!missing(board)) offers.push({ source: 'board', value: board });
    const meta = def.meta as HttpMeaningRef | undefined;
    const bag = meta
      ? sources.bag?.find((e) => e.kind === 'scalar' && sameMeaning(e, meta) && !missing(e.value))
      : undefined;
    if (bag) offers.push({ source: 'bag', value: bag.value });
    if (!missing(def.defaultValue)) offers.push({ source: 'default', value: def.defaultValue });

    const refused = def.isCredential
      ? offers.filter((o) => o.source !== 'typed').map((o) => o.source)
      : [];
    const usable = def.isCredential ? offers.filter((o) => o.source === 'typed') : offers;
    const chosen = usable[0];
    const base = { id: def.id, ...(refused.length ? { refused } : {}) };
    if (!chosen)
      return {
        ...base,
        error: def.isCredential
          ? `Type a value for {${def.id}}. A credential is only ever typed.`
          : `{${def.id}} needs a value.`,
      };
    const rendered = renderHttpParameterValue(def.type, chosen.value);
    if (rendered === undefined)
      return {
        ...base,
        source: chosen.source,
        value: chosen.value,
        ...(chosen.column ? { column: chosen.column } : {}),
        error: `The ${HTTP_VALUE_SOURCE_LABEL[chosen.source]} value for {${def.id}} is not a valid ${def.type}.`,
      };
    return {
      ...base,
      source: chosen.source,
      value: chosen.value,
      rendered,
      ...(chosen.column ? { column: chosen.column } : {}),
    };
  });
}

export interface HttpRunParameterRecord {
  readonly id: string;
  readonly source?: HttpValueSource;
  /** Absent for a credential parameter: history and logs never hold its value. */
  readonly value?: string;
}

/** What a run's history keeps: ids and sources, and values only for non-credential parameters. */
export function httpRunParameterRecord(
  defs: readonly HttpParameterDecl[],
  resolved: readonly ResolvedHttpParameter[],
): HttpRunParameterRecord[] {
  return resolved.map((r) => {
    const credential = defs.find((d) => d.id === r.id)?.isCredential;
    return {
      id: r.id,
      ...(r.source ? { source: r.source } : {}),
      ...(!credential && r.rendered !== undefined ? { value: r.rendered } : {}),
    };
  });
}

/** The applied context entries of a session snapshot, as binding reads them. */
export function bagEntriesFromSnapshot(snapshot: ContextSnapshot | undefined): HttpBagEntry[] {
  if (!snapshot?.contextSet.enabled) return [];
  const out: HttpBagEntry[] = [];
  for (const slot of snapshot.contextSet.slots)
    for (const ref of slot.entries) {
      const revision = snapshot.revisions.find(
        (r) => r.id === ref.revisionId && r.entryId === ref.entryId,
      );
      if (!revision) continue;
      out.push({
        entity: revision.subject.conceptId,
        field: revision.subject.fieldId,
        kind: revision.value.kind,
        ...(revision.value.kind === 'scalar' && revision.value.scalar
          ? { value: revision.value.scalar.value }
          : {}),
      });
    }
  return out;
}
