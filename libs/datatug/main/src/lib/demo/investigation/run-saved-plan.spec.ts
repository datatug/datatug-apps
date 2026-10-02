import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { TraceStep } from '../../chat/chat-trace.types';
import { demoBundle, type DemoBundle } from '../demo-project';
import { scenarioById } from '../demo-scenarios';
import { staticReader, staticRunner, staticRuntime } from '../testing/disk-static-source';
import { must } from '../testing/must';
import { renderTraceMessage } from '../trace/demo-messages';
import { TraceRecorder } from '../trace/trace-recorder';
import { isSourceUnavailable, reconcile, referenceName, runSavedPlan, usedNoAi, type DemoCollectionReader, type DemoQueryRunner } from './run-saved-plan';

const scenario = must(scenarioById('countries-music-per-capita'));

function run(overrides: { runner?: DemoQueryRunner; reader?: DemoCollectionReader; bundle?: DemoBundle; recognised?: boolean } = {}) {
  const events: { step: TraceStep; change: string }[] = [];
  const recorder = new TraceRecorder({ sessionId: 's', turnId: 't', emit: (step, change) => events.push({ step, change }) });
  const outcome = runSavedPlan(
    { scenario, recognised: overrides.recognised ?? true, question: scenario.question.en, runtime: staticRuntime(), ...(overrides.bundle ? { bundle: overrides.bundle } : {}) },
    { runner: overrides.runner ?? staticRunner(), reader: overrides.reader ?? staticReader(), recorder },
  );
  /** The final state of each step, by id, in order. */
  const steps = (): TraceStep[] => {
    const byId = new Map<string, TraceStep>();
    for (const { step } of events) byId.set(step.id, step);
    return [...byId.values()];
  };
  return { outcome, events, steps };
}

const text = (step: TraceStep): string => renderTraceMessage('en', step.message);

describe('running the saved plan for "Which countries buy the most music relative to their population?"', () => {
  it('records the real checks in order and answers with the 24 rows, with no AI', async () => {
    const { outcome, steps } = run();
    const result = await outcome;
    expect(result.state).toBe('result');
    if (result.state !== 'result') return;
    expect(result.rows).toHaveLength(24);
    expect(result.rows[0]).toMatchObject({ country: 'Ireland', populationYear: 2025 });
    expect(result.rows[0]['salesPerMillion']).toBeCloseTo(8.3182, 4);
    expect(result.populationYear).toBe(2025);
    expect(result.columns).toEqual(['country', 'totalSales', 'population', 'populationYear', 'salesPerMillion']);

    expect(steps().map((step) => step.kind)).toEqual(['understand', 'select-tables', 'resolve-meaning', 'need-source', 'reconcile-identifiers', 'reconcile-identifiers', 'execute', 'derive-metric', 'present']);
    expect(usedNoAi(steps())).toBe(true);
    expect(steps().every((step) => step.decision?.mechanism === 'deterministic' && !step.tokens)).toBe(true);
  });

  it('computes the reconciliation counts from the rows it read: 21 exact, 3 by hand, 24 of 24', async () => {
    const { outcome, steps } = run();
    await outcome;
    const [warn, ok] = steps().filter((step) => step.kind === 'reconcile-identifiers');
    expect(warn.status).toBe('warning');
    expect(text(warn)).toBe('The sources name countries differently: 21 of 24 Chinook countries match the reference names exactly; 3 needed the project’s alias table.');
    expect(ok.status).toBe('ok');
    expect(text(ok)).toBe('Mapping resolved: 24 of 24 billing countries have a population record.');
    const manual = warn.evidence.filter((evidence) => evidence.kind === 'mapping').map((evidence) => renderTraceMessage('en', evidence.label));
    expect(manual).toEqual([
      '“Czech Republic” is written “Czechia” in the reference data (matched by hand)',
      '“Netherlands” is written “The Netherlands” in the reference data (matched by hand)',
      '“USA” is written “United States” in the reference data (matched by hand)',
    ]);
    expect(warn.evidence.filter((evidence) => evidence.label.key === 'step.reconcile.read').map((evidence) => renderTraceMessage('en', evidence.label)))
      .toEqual(['Read 412 chinook.Invoice records', 'Read 24 geo.country_aliases records', 'Read 216 geo.population_wb records']);
  });

  it('shows what the query really read in this run, and that all 412 invoices are accounted for', async () => {
    const { outcome, steps } = run();
    await outcome;
    const execute = must(steps().find((step) => step.kind === 'execute'));
    expect(execute.status).toBe('ok');
    expect(text(execute)).toBe('Joined three sources in your browser: 412 invoices, 24 aliases and 216 population records became 24 rows.');
    const sources = execute.evidence.filter((evidence) => evidence.kind === 'source' && evidence.ref !== 'where');
    expect(sources.map((evidence) => renderTraceMessage('en', evidence.label))).toEqual(expect.arrayContaining([
      'chinook.Invoice: 412 rows read in 1 request', 'geo.country_aliases: 24 rows read in 1 request', 'geo.population_wb: 216 rows read in 1 request',
    ]));
    expect(execute.evidence.find((evidence) => evidence.kind === 'query')?.detail?.['dtql']).toContain('from:');
    const total = must(execute.evidence.find((evidence) => evidence.ref === 'invoice-total'));
    expect(renderTraceMessage('en', total.label)).toBe('All 412 invoices are accounted for: the result adds up to 2,328.60.');
    expect(execute.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('is honest about what is not connected: the meaning step is a Preview, there is no directory or model step', async () => {
    const { outcome, steps } = run();
    await outcome;
    const meaning = must(steps().find((step) => step.kind === 'resolve-meaning'));
    expect(meaning.simulated).toBeDefined();
    expect(renderTraceMessage('en', must(meaning.simulated).reason)).toContain('MeaningGraph service is not connected yet');
    expect(steps().some((step) => step.kind === 'discover-source')).toBe(false);
    expect(steps().filter((step) => step.simulated)).toHaveLength(1);
    const need = must(steps().find((step) => step.kind === 'need-source'));
    expect(need.evidence.map((evidence) => renderTraceMessage('en', evidence.label)).join(' ')).toContain('Searching a directory of sources is not built yet');
  });

  it('says when the visitor\'s wording was not matched', async () => {
    const { outcome, steps } = run({ recognised: false });
    await outcome;
    expect(text(steps()[0])).toContain('Your wording was not matched against it');
  });

  it('emits a step when its work starts and again when it ends, so the page can show it running', async () => {
    const { outcome, events } = run();
    await outcome;
    const execute = events.filter((event) => event.step.kind === 'execute');
    expect(execute.map((event) => [event.change, event.step.status])).toEqual([['append', 'running'], ['update', 'ok']]);
  });

  describe('when something is wrong', () => {
    it('reports an unreachable source in the trace and as a retryable failure, before inventing anything', async () => {
      const { outcome, steps } = run({ reader: async () => { throw new TypeError('Failed to fetch'); } });
      expect(await outcome).toMatchObject({ state: 'failed', failure: 'source-unavailable' });
      expect(steps().at(-1)).toMatchObject({ kind: 'reconcile-identifiers', status: 'failed' });
      expect(steps().some((step) => step.kind === 'execute')).toBe(false);
    });

    it('reports a failing query', async () => {
      const { outcome, steps } = run({ runner: { run: async () => { throw new Error('OVDB geo query failed (503).'); } } });
      expect(await outcome).toMatchObject({ state: 'failed', failure: 'source-unavailable', reason: 'OVDB geo query failed (503).' });
      expect(steps().at(-1)).toMatchObject({ kind: 'execute', status: 'failed' });
      const other = run({ runner: { run: async () => { throw new Error('join_aggregate exploded'); } } });
      expect(await other.outcome).toMatchObject({ failure: 'failed' });
    });

    it('stops when the plan names a field the Chinook schema does not have', async () => {
      const broken: DemoBundle = { ...demoBundle, schema: { chinook: { ...demoBundle.schema.chinook, Invoice: ['InvoiceId'] } } };
      const { outcome, steps } = run({ bundle: broken });
      expect(await outcome).toMatchObject({ state: 'failed', failure: 'failed' });
      expect(steps().at(-1)).toMatchObject({ kind: 'select-tables', status: 'failed' });
      expect(text(must(steps().at(-1)))).toContain('Invoice.BillingCountry, Invoice.Total');
    });

    it('warns, and lists the gap, when a billing country has no population record', async () => {
      const reader: DemoCollectionReader = async (runtime, database, name) => {
        const records = await staticReader()(runtime, database, name);
        return name === 'population_wb' ? records.filter((record) => record.key !== 'ie') : records;
      };
      const { outcome, steps } = run({ reader });
      await outcome;
      const gap = steps().filter((step) => step.kind === 'reconcile-identifiers')[1];
      expect(gap.status).toBe('warning');
      expect(text(gap)).toBe('Mapping incomplete: 23 of 24 billing countries have a population record. Missing: Ireland.');
    });

    it('warns when the result does not add up to the invoices', async () => {
      const runner: DemoQueryRunner = { run: async (definition, runtime, hooks) => {
        const result = await staticRunner().run(definition, runtime, hooks);
        return { ...result, recordset: { ...result.recordset, rows: result.recordset.rows.slice(1) } };
      } };
      const { outcome, steps } = run({ runner });
      await outcome;
      const execute = must(steps().find((step) => step.kind === 'execute'));
      expect(execute.status).toBe('warning');
      expect(execute.evidence.some((evidence) => renderTraceMessage('en', evidence.label).includes('adds up to'))).toBe(true);
    });

    it('returns an empty outcome when the join has no rows', async () => {
      const runner: DemoQueryRunner = { run: async (definition, runtime, hooks) => {
        const result = await staticRunner().run(definition, runtime, hooks);
        return { ...result, recordset: { ...result.recordset, rows: [] } };
      } };
      const { outcome, steps } = run({ runner });
      expect(await outcome).toMatchObject({ state: 'empty', rows: [] });
      expect(text(must(steps().find((step) => step.kind === 'execute')))).toBe('The joined result has no rows.');
    });
  });
});

describe('reconcile', () => {
  it('separates exact from manual alias matches using each alias record\'s own note', () => {
    const invoices = [{ key: '1', data: { BillingCountry: 'USA', Total: 1 } }, { key: '2', data: { BillingCountry: 'Ireland', Total: 2 } }, { key: '3', data: { BillingCountry: 'Atlantis', Total: 3 } }];
    const aliases = [
      { key: 'usa', data: { alias: 'USA', country: 'us', source: 'x; manual match: countries.names.en is \'United States\'' } },
      { key: 'ireland', data: { alias: 'Ireland', country: 'ie', source: 'x; exact match on countries.names.en' } },
    ];
    const population = [{ key: 'us', data: { country: 'us' } }];
    const facts = reconcile(invoices, aliases, population);
    expect(facts).toMatchObject({ invoices: 3, invoiceTotal: 6, exact: ['Ireland'], unmatched: ['Atlantis'], withPopulation: ['USA'], withoutPopulation: ['Ireland'] });
    expect(facts.manual.map((entry) => entry.alias)).toEqual(['USA']);
  });

  it('extracts the reference name from a note', () => {
    expect(referenceName("manual match: countries.names.en is 'Czechia'")).toBe('Czechia');
    expect(referenceName('exact match on countries.names.en')).toBeUndefined();
  });

  it('tells an unreachable source from an engine error', () => {
    expect(isSourceUnavailable(new TypeError('x'))).toBe(true);
    expect(isSourceUnavailable(new Error('OVDB geo query failed (503).'))).toBe(true);
    expect(isSourceUnavailable(new Error('static source geo/x.json failed (404)'))).toBe(true);
    expect(isSourceUnavailable(new Error('join_aggregate at orderBy[0]'))).toBe(false);
  });
});
