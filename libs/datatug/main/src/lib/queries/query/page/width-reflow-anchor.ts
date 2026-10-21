/** Preserve an already-visible result when a width breakpoint shrinks the content above it. */
export interface WidthReflowPlatform {
  width(): number;
  frame(callback: () => void): number;
  cancelFrame(id: number): void;
  observe(callback: (visible: boolean) => void): () => void;
  resize(callback: () => void): () => void;
}

export interface WidthReflowAnchor {
  clear(): void;
  destroy(): void;
}

const sameContext = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function keepVisibleOnWidthReflow(
  element: HTMLElement,
  root: HTMLElement,
  context: () => readonly unknown[],
  active: () => boolean,
  platform?: WidthReflowPlatform,
): WidthReflowAnchor {
  if (!platform) {
    if (
      typeof window === 'undefined' ||
      typeof IntersectionObserver === 'undefined'
    )
      return { clear: () => undefined, destroy: () => undefined };
    platform = {
      width: () => window.innerWidth,
      frame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      observe: (callback) => {
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              if (entry.target === element)
                callback(entry.isIntersecting && entry.intersectionRatio > 0);
          },
          { root },
        );
        observer.observe(element);
        return () => observer.disconnect();
      },
      resize: (callback) => {
        window.addEventListener('resize', callback);
        return () => window.removeEventListener('resize', callback);
      },
    };
  }
  const browser = platform;
  let settledWidth = browser.width();
  let visible = false;
  let observedContext: readonly unknown[] = [];
  let transition:
    | { width: number; restore: boolean; context: readonly unknown[] }
    | undefined;
  let firstFrame: number | undefined;
  let secondFrame: number | undefined;
  let generation = 0;
  let destroyed = false;
  const cancel = () => {
    ++generation;
    if (firstFrame !== undefined) browser.cancelFrame(firstFrame);
    if (secondFrame !== undefined) browser.cancelFrame(secondFrame);
    firstFrame = secondFrame = undefined;
  };
  const intersects = () => {
    const target = element.getBoundingClientRect(),
      viewport = root.getBoundingClientRect();
    return (
      target.width > 0 &&
      target.height > 0 &&
      target.bottom > viewport.top &&
      target.top < viewport.bottom &&
      target.right > viewport.left &&
      target.left < viewport.right
    );
  };
  const unobserve = browser.observe((intersecting) => {
    // A post-layout IO delivery can precede window.resize. Keep the old width's sample until repair.
    if (destroyed || transition || browser.width() !== settledWidth) return;
    visible = intersecting && active();
    observedContext = context();
  });
  const unresize = browser.resize(() => {
    if (destroyed) return;
    const width = browser.width();
    if (transition?.width === width || (!transition && width === settledWidth))
      return;
    const previous = transition;
    cancel();
    const currentContext = context();
    transition = {
      width,
      restore:
        previous?.restore ??
        (visible && active() && sameContext(observedContext, currentContext)),
      context: previous?.context ?? currentContext,
    };
    const pending = transition,
      revision = generation;
    firstFrame = browser.frame(() => {
      firstFrame = undefined;
      secondFrame = browser.frame(() => {
        secondFrame = undefined;
        if (
          destroyed ||
          revision !== generation ||
          browser.width() !== pending.width
        )
          return;
        settledWidth = pending.width;
        transition = undefined;
        if (
          pending.restore &&
          element.isConnected &&
          root.isConnected &&
          active() &&
          sameContext(pending.context, context()) &&
          !intersects()
        )
          element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        visible = element.isConnected && active() && intersects();
        observedContext = context();
      });
    });
  });
  const clear = () => {
    cancel();
    transition = undefined;
    visible = false;
    observedContext = [];
    settledWidth = browser.width();
  };
  return {
    clear,
    destroy: () => {
      destroyed = true;
      clear();
      unobserve();
      unresize();
    },
  };
}
