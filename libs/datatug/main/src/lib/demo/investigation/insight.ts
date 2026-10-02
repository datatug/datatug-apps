import type { TraceStep } from '../../chat/chat-trace.types';
import type { DemoLang } from '../demo-scenarios';
import { msg, type TraceRecorder } from '../trace/trace-recorder';
import { computeObservations, toPerCapitaRows, type Observation } from './observations';

/**
 * The "What can you say about this data?" follow-up. The observations are computed from the result rows
 * and worded from fixed templates, so this step spends no AI tokens and says so.
 */
export function recordInsight(recorder: TraceRecorder, rows: readonly Record<string, unknown>[], lang: DemoLang): { step: TraceStep; observations: readonly Observation[] } {
  const observations = computeObservations(toPerCapitaRows(rows), lang);
  const step = recorder.add({
    kind: 'insight', status: observations.length ? 'ok' : 'warning',
    message: msg('step.insight.ok', { count: observations.length, rows: rows.length }),
    decision: { question: 'decision.observations', selected: observations.map((observation) => observation.id), mechanism: 'deterministic', provenance: 'observed', validatedBy: ['data'] },
    evidence: observations.map((observation) => ({
      kind: 'data-check' as const, ref: observation.id, label: observation.message,
      detail: { rows: observation.rowKeys.join(', ') },
    })),
    claims: observations.map((observation) => ({ id: observation.id, message: observation.message, rowKeys: observation.rowKeys })),
  });
  return { step, observations };
}
