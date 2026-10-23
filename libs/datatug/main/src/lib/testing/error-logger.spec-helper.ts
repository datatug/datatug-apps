import { Provider } from '@angular/core';
import { ErrorLogger } from '@sneat/core';

/** An ErrorLogger stand-in whose calls a spec can assert on. */
export function mockErrorLogger() {
  return {
    logError: vi.fn(),
    logErrorHandler: vi.fn(() => vi.fn()),
  };
}

/** Provides {@link mockErrorLogger} (or the given instance) as the ErrorLogger. */
export function provideMockErrorLogger(
  logger: ReturnType<typeof mockErrorLogger> = mockErrorLogger(),
): Provider {
  return { provide: ErrorLogger, useValue: logger };
}
