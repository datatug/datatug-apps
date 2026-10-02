// Runs the demo project's saved plan for "Which countries buy the most music relative to their population?"
//
// This is the "run a bound plan" engine: the plan is the project's saved cross-source query. The steps
// it records are the checks and the query that really ran in this browser tab, in order, each emitted
// when its work finished. Where the product does not do something yet (MeaningGraph service, a directory
// of sources, Jev, any model) there is either no step or a step that says what actually happened.
import type { IQueryDef } from '../../models/definition/query-def';
import type { FederatedQueryProgress, FederatedQueryResult, FederatedSourceLoaded } from '../../queries/federated-query-executor';
import type { TraceDecision, TraceEvidence, TraceStep } from '../../chat/chat-trace.types';
import { readCollection, type OvdbRecord } from '../data/read-collection';
import { demoBundle, HERO_QUERY_ID, queryDefinition, savedQuery, type DemoBundle, type DemoSourceRuntime } from '../demo-project';
import type { DemoScenario } from '../demo-scenarios';
import { msg, type TraceRecorder } from '../trace/trace-recorder';
import { formatFixed, formatInteger } from './format';

export interface RunnerHooks {
  readonly onProgress?: (progress: FederatedQueryProgress) => void;
  readonly onSourceLoaded?: (event: FederatedSourceLoaded) => void;
}

/** Runs the saved query in the browser engine. The app's implementation is the federated query worker. */
export interface DemoQueryRunner {
  run(definition: IQueryDef, runtime: DemoSourceRuntime, hooks: RunnerHooks): Promise<FederatedQueryResult>;
}

export type DemoCollectionReader = (runtime: DemoSourceRuntime, database: string, name: string) => Promise<readonly OvdbRecord[]>;

export const defaultCollectionReader: DemoCollectionReader = (runtime, database, name) =>
  readCollection({ baseUrl: runtime.baseUrl, ...(runtime.staticSource ? { staticSource: runtime.staticSource } : {}) }, database, name);

export interface InvestigationInput {
  readonly scenario: DemoScenario;
  /** True when the visitor's wording matched one of the scenario's known wordings. */
  readonly recognised: boolean;
  readonly question: string;
  readonly runtime: DemoSourceRuntime;
  readonly bundle?: DemoBundle;
}

export interface InvestigationDeps {
  readonly runner: DemoQueryRunner;
  readonly reader?: DemoCollectionReader;
  readonly recorder: TraceRecorder;
  readonly clock?: () => number;
}

export type InvestigationFailure = 'source-unavailable' | 'failed';

export type InvestigationOutcome =
  | {
    readonly state: 'result' | 'empty';
    readonly definition: IQueryDef;
    readonly columns: readonly string[];
    readonly rows: readonly Record<string, unknown>[];
    readonly queryMs: number;
    readonly populationYear?: number;
  }
  | { readonly state: 'failed'; readonly failure: InvestigationFailure; readonly reason: string };

const COUNTRY_STEP_DECISION = (question: string, selected: readonly string[], provenance: TraceDecision['provenance'], validatedBy: TraceDecision['validatedBy']): TraceDecision => ({
  question, selected, mechanism: 'deterministic', provenance, validatedBy,
});

export function isSourceUnavailable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const text = error instanceof Error ? error.message : String(error);
  return /failed to fetch|networkerror|load failed|OVDB .*(failed|returned|snapshot)|static source|\(\d{3}\)/i.test(text);
}

/** The name the reference data uses, from an alias record's own note ("... countries.names.en is 'Czechia'"). */
export function referenceName(note: string): string | undefined {
  return /countries\.names\.en is '([^']+)'/i.exec(note)?.[1];
}

const asNumber = (value: unknown): number => typeof value === 'number' ? value : Number.NaN;
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** The trace's data checks: how many countries, how the sources name them, how many have a population. */
export interface Reconciliation {
  readonly invoices: number;
  readonly invoiceTotal: number;
  readonly billingCountries: readonly string[];
  readonly aliases: number;
  readonly populationRecords: number;
  readonly exact: readonly string[];
  readonly manual: readonly { readonly alias: string; readonly note: string }[];
  readonly unmatched: readonly string[];
  readonly withPopulation: readonly string[];
  readonly withoutPopulation: readonly string[];
}

export function reconcile(invoices: readonly OvdbRecord[], aliases: readonly OvdbRecord[], population: readonly OvdbRecord[]): Reconciliation {
  const billing = [...new Set(invoices.map((invoice) => String(invoice.data['BillingCountry'])))].sort();
  const aliasByName = new Map(aliases.map((alias) => [String(alias.data['alias']), alias.data] as const));
  const populated = new Set(population.map((record) => String(record.data['country'])));
  const matched = billing.filter((name) => aliasByName.has(name));
  const manual = matched.filter((name) => /manual match/i.test(String(aliasByName.get(name)?.['source'])));
  return {
    invoices: invoices.length,
    invoiceTotal: sum(invoices.map((invoice) => asNumber(invoice.data['Total']))),
    billingCountries: billing,
    aliases: aliases.length,
    populationRecords: population.length,
    exact: matched.filter((name) => !manual.includes(name)),
    manual: manual.map((alias) => ({ alias, note: String(aliasByName.get(alias)?.['source']) })),
    unmatched: billing.filter((name) => !aliasByName.has(name)),
    withPopulation: matched.filter((name) => populated.has(String(aliasByName.get(name)?.['country']))),
    withoutPopulation: matched.filter((name) => !populated.has(String(aliasByName.get(name)?.['country']))),
  };
}

export async function runSavedPlan(input: InvestigationInput, deps: InvestigationDeps): Promise<InvestigationOutcome> {
  const { recorder, runner } = deps;
  const bundle = input.bundle ?? demoBundle;
  const reader = deps.reader ?? defaultCollectionReader;
  const clock = deps.clock ?? (() => performance.now());
  const query = savedQuery(HERO_QUERY_ID, bundle);
  const definition = queryDefinition(HERO_QUERY_ID, input.runtime, bundle);
  const planLabel = query.title;
  const commit = bundle.pin.commit.slice(0, 10);

  // 1. Which plan. Recognising the wording is a fixed alias match; a visitor who picked the scenario by
  // other wording is told their wording was not matched.
  recorder.add({
    kind: 'understand', status: 'ok',
    message: msg(input.recognised ? 'step.understand.recognised' : 'step.understand.scenario', { plan: planLabel }),
    decision: COUNTRY_STEP_DECISION('decision.plan', [HERO_QUERY_ID], 'declared', []),
    evidence: [{
      kind: 'prior-investigation', ref: `${bundle.pin.project}/queries/${HERO_QUERY_ID}.query.json`,
      label: msg('step.understand.plan', { id: query.id, project: bundle.pin.project, commit }),
      detail: { scenario: input.scenario.id, recognised: input.recognised },
    }],
  });

  // 2. Tables and fields: the plan's Chinook fields must exist in the project's Chinook schema.
  const chinookTables = query.federation.tables.filter((table) => table.database === 'chinook');
  const schema = bundle.schema.chinook;
  const missing = chinookTables.flatMap((table) => table.fields.filter((field) => !schema[table.name]?.includes(field)).map((field) => `${table.name}.${field}`));
  const fieldEvidence: TraceEvidence[] = chinookTables.flatMap((table) => table.fields.map((field): TraceEvidence => ({
    kind: 'schema-object', ref: `chinook:main.${table.name}.${field}`,
    label: msg('step.tables.field', { field: `${table.name}.${field}` }),
    detail: { found: !!schema[table.name]?.includes(field) },
  })));
  recorder.add({
    kind: 'select-tables', status: missing.length ? 'failed' : 'ok',
    message: missing.length ? msg('step.tables.failed', { missing: missing.join(', ') }) : msg('step.tables.ok'),
    decision: COUNTRY_STEP_DECISION('decision.relevantTables', chinookTables.flatMap((table) => table.fields.map((field) => `${table.name}.${field}`)), 'schema', ['schema']),
    evidence: fieldEvidence,
  });
  if (missing.length) return { state: 'failed', failure: 'failed', reason: `missing fields: ${missing.join(', ')}` };

  // 3. Meaning: the project's Country entity says what BillingCountry is. Read from files, not a service.
  const countryMappings = bundle.entities.Country.fields.flatMap((field) => field.mappings
    .filter((mapping) => mapping.source === 'chinook' && mapping.collection === 'Invoice' && mapping.column === 'BillingCountry')
    .map((mapping) => ({ field: field.id, mapping })));
  recorder.add({
    kind: 'resolve-meaning', status: countryMappings.length ? 'ok' : 'warning',
    message: countryMappings.length ? msg('step.meaning.ok') : msg('step.meaning.none'),
    decision: COUNTRY_STEP_DECISION('decision.meaning', countryMappings.length ? ['Country'] : [], 'declared', ['meaning']),
    evidence: countryMappings.map(({ field, mapping }): TraceEvidence => ({
      kind: 'mapping', ref: `Country.${field}`,
      label: msg('step.meaning.mapping', { source: mapping.source, collection: mapping.collection, column: mapping.column, field }),
    })),
    simulated: { reason: msg('step.meaning.simulated') },
  });

  // 4. Need a source: population is not in Chinook (checked against its schema).
  const populationFields = Object.entries(schema).flatMap(([table, columns]) => columns.filter((column) => /popul/i.test(column)).map((column) => `${table}.${column}`));
  const worldBank = bundle.attribution.find((entry) => entry.id === 'world-bank');
  recorder.add({
    kind: 'need-source', status: populationFields.length ? 'warning' : 'ok',
    message: populationFields.length
      ? msg('step.need.found', { fields: populationFields.join(', ') })
      : msg('step.need.ok', { tables: Object.keys(schema).length }),
    decision: COUNTRY_STEP_DECISION('decision.requiredData', ['population'], 'schema', ['schema']),
    evidence: [
      {
        kind: 'source', ref: 'geo.population_wb', label: msg('step.need.source', { license: worldBank?.license ?? '' }),
        detail: { url: worldBank?.url ?? '', origin: bundle.data.find((source) => source.id === 'geo.population_wb')?.origin ?? '' },
      },
      { kind: 'data-check', ref: 'chinook', label: msg('step.need.note'), detail: { tablesChecked: Object.keys(schema).length } },
    ],
  });

  // 5. Reconcile: read how each source names countries, compare, report counts computed from those rows.
  const checking = recorder.start({
    kind: 'reconcile-identifiers', status: 'running', message: msg('step.reconcile.running'),
    decision: COUNTRY_STEP_DECISION('decision.reconcile', ['Invoice.BillingCountry', 'country_aliases.alias'], 'observed', ['data']),
  });
  let facts: Reconciliation;
  try {
    const [invoices, aliases, population] = await Promise.all([
      reader(input.runtime, 'chinook', 'Invoice'), reader(input.runtime, 'geo', 'country_aliases'), reader(input.runtime, 'geo', 'population_wb'),
    ]);
    facts = reconcile(invoices, aliases, population);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recorder.finish(checking, { status: 'failed', message: msg('step.execute.failed', { reason }) });
    return { state: 'failed', failure: isSourceUnavailable(error) ? 'source-unavailable' : 'failed', reason };
  }
  const readEvidence: TraceEvidence[] = [
    { kind: 'data-check', ref: 'chinook.Invoice', label: msg('step.reconcile.read', { source: 'chinook.Invoice', rows: facts.invoices }), detail: { countries: facts.billingCountries.length } },
    { kind: 'data-check', ref: 'geo.country_aliases', label: msg('step.reconcile.read', { source: 'geo.country_aliases', rows: facts.aliases }) },
    { kind: 'data-check', ref: 'geo.population_wb', label: msg('step.reconcile.read', { source: 'geo.population_wb', rows: facts.populationRecords }) },
  ];
  const aliasEvidence: TraceEvidence[] = facts.manual.map((entry) => ({
    kind: 'mapping', ref: `geo.country_aliases:${entry.alias}`,
    label: msg('step.reconcile.alias', { alias: entry.alias, name: referenceName(entry.note) ?? '—' }),
    detail: { note: entry.note },
  }));
  const total = facts.billingCountries.length;
  recorder.finish(checking, {
    status: facts.manual.length ? 'warning' : 'ok',
    message: msg('step.reconcile.warn', { exact: facts.exact.length, total, manual: facts.manual.length }),
    evidence: [...readEvidence, ...aliasEvidence, { kind: 'data-check', ref: 'geo.country_aliases', label: msg('step.reconcile.note') }],
  });
  const matched = facts.withPopulation.length;
  recorder.add({
    kind: 'reconcile-identifiers', status: matched === total ? 'ok' : 'warning',
    message: matched === total
      ? msg('step.reconcile.ok', { matched, total })
      : msg('step.reconcile.gap', { matched, total, missing: [...facts.unmatched, ...facts.withoutPopulation].join(', ') }),
    decision: COUNTRY_STEP_DECISION('decision.mapping', ['Invoice.BillingCountry → country_aliases.alias → population_wb.country'], 'verified', ['data']),
    evidence: [{ kind: 'mapping', ref: 'geo.country_aliases', label: msg('step.reconcile.ok', { matched, total }), detail: { matched, total, exact: facts.exact.length, manual: facts.manual.length } }],
  });

  // 6. Execute: the join, the grouping and the arithmetic run in the browser engine.
  const sources: FederatedSourceLoaded[] = [];
  const running = recorder.start({
    kind: 'execute', status: 'running', message: msg('step.execute.running'),
    decision: COUNTRY_STEP_DECISION('decision.execute', ['chinook.Invoice', 'geo.country_aliases', 'geo.population_wb'], 'declared', ['dtql-parse']),
  });
  const began = clock();
  let result: FederatedQueryResult;
  try {
    result = await runner.run(definition, input.runtime, { onSourceLoaded: (event) => sources.push(event) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recorder.finish(running, { status: 'failed', message: msg('step.execute.failed', { reason }) });
    return { state: 'failed', failure: isSourceUnavailable(error) ? 'source-unavailable' : 'failed', reason };
  }
  const queryMs = Math.round(clock() - began);
  const columns = result.recordset.columns.map((column) => column.name);
  const rows = result.recordset.rows.map((row) => Object.fromEntries(columns.map((name, index) => [name, row[index]?.value ?? null])));
  const read = (database: string, name: string): number => sources.find((source) => source.database === database && source.name === name)?.rows ?? 0;
  const resultTotal = sum(rows.map((row) => asNumber(row['totalSales'])));
  const reconciled = Math.abs(resultTotal - facts.invoiceTotal) < 0.005;
  const sourceEvidence: TraceEvidence[] = sources.map((source) => ({
    kind: 'source', ref: `${source.database}.${source.name}`,
    label: msg('step.execute.source', { source: `${source.database}.${source.name}`, rows: source.rows, requests: source.requests }),
    detail: { ms: Math.round(source.elapsedMs) },
  }));
  recorder.finish(running, {
    status: rows.length ? (reconciled ? 'ok' : 'warning') : 'warning',
    message: rows.length
      ? msg('step.execute.done', { invoices: read('chinook', 'Invoice'), aliases: read('geo', 'country_aliases'), population: read('geo', 'population_wb'), rows: rows.length })
      : msg('step.execute.empty'),
    evidence: [
      { kind: 'query', ref: query.id, label: msg('step.execute.query', { id: query.id }), detail: { dtql: query.dtql.replace(/^#.*\n/gm, '').trim() } },
      { kind: 'source', ref: 'where', label: msg('step.execute.where', { where: input.runtime.label }) },
      ...sourceEvidence,
      {
        kind: 'data-check', ref: 'invoice-total',
        label: reconciled
          ? msg('step.execute.reconciled', { invoices: facts.invoices, total: formatFixed(resultTotal) })
          : msg('step.execute.mismatch', { result: formatFixed(resultTotal), invoices: formatFixed(facts.invoiceTotal) }),
        detail: { invoicesTotal: Math.round(facts.invoiceTotal * 100) / 100, resultTotal: Math.round(resultTotal * 100) / 100 },
      },
    ],
  });

  if (!rows.length) return { state: 'empty', definition, columns, rows, queryMs };

  // 7. The derived metric lives in the same query: check the column is really in the result.
  const hasMetric = columns.includes('salesPerMillion');
  recorder.add({
    kind: 'derive-metric', status: hasMetric ? 'ok' : 'failed', message: msg('step.metric.ok'),
    decision: COUNTRY_STEP_DECISION('decision.metric', ['salesPerMillion'], 'declared', ['dtql-parse']),
    evidence: [{ kind: 'query', ref: 'salesPerMillion', label: msg('step.metric.column', { column: 'salesPerMillion' }), detail: { present: hasMetric } }],
  });

  // 8. Presentation: a fixed layout chosen by the demo scenario.
  recorder.add({
    kind: 'present', status: 'ok', message: msg('step.present.ok'),
    decision: COUNTRY_STEP_DECISION('decision.presentation', ['grid', 'bar_chart'], 'declared', []),
    evidence: [{ kind: 'data-check', ref: 'layout', label: msg('step.present.layout'), detail: { rows: formatInteger(rows.length) } }],
  });

  const populationYear = asNumber(rows[0]?.['populationYear']);
  return { state: 'result', definition, columns, rows, queryMs, ...(Number.isFinite(populationYear) ? { populationYear } : {}) };
}

/** Steps recorded so far, for tests and for the page's "no AI" line. */
export function usedNoAi(steps: readonly TraceStep[]): boolean {
  return steps.every((step) => !step.tokens && step.decision?.mechanism !== 'jev' && step.decision?.mechanism !== 'llm');
}
