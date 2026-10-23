import {
  DestroyRef,
  Signal,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

export interface DebouncedSignal<T> {
  /** The source value once it has been still for the delay. */
  readonly value: Signal<T>;
  /** True between a change of the source and the end of its delay. */
  readonly pending: Signal<boolean>;
  /** Takes the current source value now, without waiting. */
  flush(): void;
}

/**
 * Follows `source` after it has been still for `ms` (typing pauses). Must be created in an injection context.
 * Used by the Quick Search box for the search text and by the results page for the tag filter.
 */
export function debouncedSignal<T>(
  source: Signal<T>,
  ms: number,
): DebouncedSignal<T> {
  const value = signal(untracked(source));
  const pending = signal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (next: T) => {
    clearTimeout(timer);
    timer = undefined;
    pending.set(false);
    value.set(next);
  };
  effect((onCleanup) => {
    const next = source();
    if (Object.is(next, untracked(value))) {
      // Typed back to the settled value: the cleanup already cancelled the pending timer.
      timer = undefined;
      pending.set(false);
      return;
    }
    pending.set(true);
    const handle = setTimeout(() => settle(next), ms);
    timer = handle;
    onCleanup(() => clearTimeout(handle));
  });
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  return {
    value: value.asReadonly(),
    pending: pending.asReadonly(),
    flush: () => settle(untracked(source)),
  };
}
