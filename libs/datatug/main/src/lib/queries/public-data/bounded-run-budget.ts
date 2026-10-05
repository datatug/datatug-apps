/** performance time origins differ across workers; their sum is a shared monotonic coordinate. */
export const monotonicTime = (): number =>
  performance.timeOrigin + performance.now();

/** Network admission failure leaves already accepted local data readable. */
export class NetworkBudgetExhaustedError extends Error {}

/** One run owns network accounting and cancellation across every stage and retry. */
export class BoundedRunBudget {
  readonly controller = new AbortController();
  readonly signal: AbortSignal;
  readonly deadline: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private network = 0;
  private output = 0;
  constructor(
    readonly maximumBytes: number,
    timeoutMs: number,
    signal?: AbortSignal,
    deadline?: number,
  ) {
    this.deadline = Math.min(deadline ?? Infinity, monotonicTime() + timeoutMs);
    this.signal = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal;
    this.timer = setTimeout(
      () =>
        this.controller.abort(
          new Error(
            'The bounded lookup exceeded its deadline. Run explicitly again.',
          ),
        ),
      Math.max(0, this.deadline - monotonicTime()),
    );
  }
  check(): void {
    if (monotonicTime() >= this.deadline)
      this.controller.abort(
        new Error(
          'The bounded lookup exceeded its deadline. Run explicitly again.',
        ),
      );
    this.signal.throwIfAborted();
  }
  get bytes(): number {
    return this.network;
  }
  get remaining(): number {
    this.check();
    return this.maximumBytes - this.network;
  }
  admitNetwork(): void {
    this.check();
    if (this.network >= this.maximumBytes)
      throw new NetworkBudgetExhaustedError(
        'The run exhausted its cumulative byte bound. Run explicitly again.',
      );
  }
  consumeNetwork(bytes: number): void {
    this.check();
    this.network += bytes;
    if (this.network > this.maximumBytes) {
      const error = new Error(
        'The public-data response exceeds the cumulative byte bound.',
      );
      this.controller.abort(error);
      throw error;
    }
  }
  beginOutput(): void {
    this.check();
    this.output = 0;
  }
  consumeOutput(value: unknown): void {
    this.check();
    this.output += new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (this.output > 5 * 1024 * 1024) {
      const error = new Error(
        'The joined output exceeds the materialized byte bound.',
      );
      this.controller.abort(error);
      throw error;
    }
  }
  close(): void {
    clearTimeout(this.timer);
  }
}
