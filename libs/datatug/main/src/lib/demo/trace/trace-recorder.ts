import type {
  InsightClaim, TraceDecision, TraceEvidence, TraceMessage, TraceStatus, TraceStep, TraceStepKind,
} from '../../chat/chat-trace.types';

export interface TraceStepInput {
  readonly kind: TraceStepKind;
  readonly status: TraceStatus;
  readonly message: TraceMessage;
  readonly decision?: TraceDecision;
  readonly evidence?: readonly TraceEvidence[];
  readonly outputs?: TraceStep['outputs'];
  readonly simulated?: TraceStep['simulated'];
  readonly claims?: readonly InsightClaim[];
}

export type TraceEmit = (step: TraceStep, change: 'append' | 'update') => void;

export const msg = (key: string, params: Readonly<Record<string, string | number>> = {}): TraceMessage => ({ key, params });

/**
 * Builds the steps of one turn's trace. A step is emitted when its work starts (status `running`) or
 * finishes; nothing is emitted ahead of the check or query it describes. Each step has a real start time
 * and a measured duration.
 */
export class TraceRecorder {
  private index = 0;
  private readonly started = new Map<string, number>();

  constructor(
    private readonly context: { readonly sessionId: string; readonly turnId: string; readonly emit: TraceEmit },
    private readonly clock: () => number = () => performance.now(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Continue numbering after steps that were stored earlier (a restored investigation gaining a follow-up). */
  resume(startIndex: number): void { this.index = startIndex; }

  private build(input: TraceStepInput, durationMs?: number): TraceStep {
    const index = this.index++;
    return {
      id: `${this.context.turnId}:${index}`, sessionId: this.context.sessionId, turnId: this.context.turnId, index,
      kind: input.kind, status: input.status, message: input.message, evidence: input.evidence ?? [],
      startedAt: this.now().toISOString(),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.outputs ? { outputs: input.outputs } : {}),
      ...(input.simulated ? { simulated: input.simulated } : {}),
      ...(input.claims ? { claims: input.claims } : {}),
    };
  }

  /** Start a step. Finish it with `finish`, or leave it `running` if the run is cut off. */
  start(input: TraceStepInput): TraceStep {
    const step = this.build(input);
    this.started.set(step.id, this.clock());
    this.context.emit(step, 'append');
    return step;
  }

  /** Replace a started step with its final form, measuring how long it took. */
  finish(step: TraceStep, update: Partial<TraceStepInput>): TraceStep {
    const begun = this.started.get(step.id);
    const done: TraceStep = {
      ...step,
      ...(update.status ? { status: update.status } : {}),
      ...(update.message ? { message: update.message } : {}),
      ...(update.decision ? { decision: update.decision } : {}),
      ...(update.evidence ? { evidence: update.evidence } : {}),
      ...(update.outputs ? { outputs: update.outputs } : {}),
      ...(update.simulated ? { simulated: update.simulated } : {}),
      ...(update.claims ? { claims: update.claims } : {}),
      durationMs: begun === undefined ? 0 : Math.max(0, Math.round(this.clock() - begun)),
    };
    this.started.delete(step.id);
    this.context.emit(done, 'update');
    return done;
  }

  /** A step whose work is a quick check the caller has already done: emitted once, in its final form. */
  add(input: TraceStepInput, durationMs = 0): TraceStep {
    const step = this.build(input, durationMs);
    this.context.emit(step, 'append');
    return step;
  }
}
