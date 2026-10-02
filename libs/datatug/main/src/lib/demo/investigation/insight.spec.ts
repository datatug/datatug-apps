import { describe, expect, it } from 'vitest';
import type { TraceStep } from '../../chat/chat-trace.types';
import { TraceRecorder } from '../trace/trace-recorder';
import { recordInsight } from './insight';
import { usedNoAi } from './run-saved-plan';

const rows = [
  { country: 'Ireland', totalSales: 45.62, population: 5484367, salesPerMillion: 8.318 },
  { country: 'Czech Republic', totalSales: 90.24, population: 10886878, salesPerMillion: 8.289 },
  { country: 'USA', totalSales: 523.06, population: 341784857, salesPerMillion: 1.53 },
];

describe('the "What can you say about this data?" follow-up', () => {
  it('adds an insight step with claims tied to the rows they rest on, and no AI', () => {
    const steps: TraceStep[] = [];
    const recorder = new TraceRecorder({ sessionId: 's', turnId: 't', emit: (step) => steps.push(step) });
    recorder.resume(9);
    const { step, observations } = recordInsight(recorder, rows, 'en');
    expect(step).toMatchObject({ id: 't:9', kind: 'insight', status: 'ok' });
    expect(step.message).toEqual({ key: 'step.insight.ok', params: { count: observations.length, rows: 3 } });
    expect(step.claims?.map((claim) => claim.rowKeys)).toEqual(observations.map((observation) => observation.rowKeys));
    expect(step.decision).toMatchObject({ mechanism: 'deterministic', provenance: 'observed', validatedBy: ['data'] });
    expect(usedNoAi([step])).toBe(true);
  });

  it('warns when there is nothing to say', () => {
    const recorder = new TraceRecorder({ sessionId: 's', turnId: 't', emit: () => undefined });
    expect(recordInsight(recorder, rows.slice(0, 1), 'en').step.status).toBe('warning');
  });
});
