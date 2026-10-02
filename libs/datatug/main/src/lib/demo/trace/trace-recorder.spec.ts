import { describe, expect, it } from 'vitest';
import type { TraceStep } from '../../chat/chat-trace.types';
import { msg, TraceRecorder } from './trace-recorder';

function recorder(start = 0) {
  const events: { step: TraceStep; change: string }[] = [];
  let tick = 0;
  const trace = new TraceRecorder({ sessionId: 's', turnId: 't', emit: (step, change) => events.push({ step, change }) }, () => (tick += 40), () => new Date('2026-10-02T10:00:00Z'));
  trace.resume(start);
  return { trace, events };
}

describe('TraceRecorder', () => {
  it('numbers steps `${turnId}:${index}` in order and emits a quick step once, final', () => {
    const { trace, events } = recorder();
    trace.add({ kind: 'understand', status: 'ok', message: msg('step.understand.recognised', { plan: 'p' }) });
    trace.add({ kind: 'select-tables', status: 'ok', message: msg('step.tables.ok') });
    expect(events.map((event) => [event.step.id, event.change, event.step.status])).toEqual([['t:0', 'append', 'ok'], ['t:1', 'append', 'ok']]);
    expect(events[0].step).toMatchObject({ sessionId: 's', turnId: 't', index: 0, startedAt: '2026-10-02T10:00:00.000Z', evidence: [] });
  });

  it('emits a running step when its work starts and the final form, with a measured duration, when it ends', () => {
    const { trace, events } = recorder();
    const running = trace.start({ kind: 'execute', status: 'running', message: msg('step.execute.running') });
    expect(events.at(-1)).toMatchObject({ change: 'append', step: { status: 'running' } });
    expect(events.at(-1)?.step.durationMs).toBeUndefined();
    const done = trace.finish(running, { status: 'ok', message: msg('step.execute.done', { rows: 24 }), evidence: [{ kind: 'query', ref: 'q', label: msg('step.execute.query', { id: 'q' }) }] });
    expect(done).toMatchObject({ id: 't:0', status: 'ok', durationMs: 40, message: { params: { rows: 24 } } });
    expect(events.at(-1)).toMatchObject({ change: 'update' });
    expect(done.evidence).toHaveLength(1);
  });

  it('keeps the step id when it gains evidence, and continues numbering after stored steps', () => {
    const { trace, events } = recorder(9);
    const step = trace.add({ kind: 'insight', status: 'ok', message: msg('step.insight.ok', { count: 3, rows: 24 }) });
    expect(step.id).toBe('t:9');
    expect(events).toHaveLength(1);
  });

  it('never carries tokens: a step that spends none has no `tokens` field', () => {
    const { trace } = recorder();
    expect(trace.add({ kind: 'present', status: 'ok', message: msg('step.present.ok') })).not.toHaveProperty('tokens');
  });
});
