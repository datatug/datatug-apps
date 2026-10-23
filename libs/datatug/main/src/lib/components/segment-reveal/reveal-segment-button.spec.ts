import { revealSegmentButton } from './reveal-segment-button';

function rect(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 40,
    height: 40,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function strip(options: {
  scrollWidth?: number;
  clientWidth?: number;
  width?: number;
  button: [number, number];
}) {
  const segment = document.createElement('div');
  const button = document.createElement('div');
  segment.append(button);
  document.body.append(segment);
  Object.defineProperty(segment, 'scrollWidth', {
    value: options.scrollWidth ?? 974,
  });
  Object.defineProperty(segment, 'clientWidth', {
    value: options.clientWidth ?? 355,
  });
  segment.scrollLeft = 0;
  segment.getBoundingClientRect = () => rect(10, options.width ?? 355);
  button.getBoundingClientRect = () => rect(...options.button);
  const scrollTo = vi.fn();
  segment.scrollTo = scrollTo as typeof segment.scrollTo;
  return { segment, button, scrollTo };
}

describe('revealSegmentButton', () => {
  it('scrolls a button clipped on the right by the smallest distance, instantly', () => {
    const { segment, button, scrollTo } = strip({ button: [318, 311] });
    revealSegmentButton(segment, button);
    expect(scrollTo).toHaveBeenCalledWith({ left: 264, behavior: 'instant' });
  });

  it('scrolls a button clipped on the left to the start of the strip', () => {
    const { segment, button, scrollTo } = strip({ button: [-10, 311] });
    revealSegmentButton(segment, button);
    expect(scrollTo).toHaveBeenCalledWith({ left: -20, behavior: 'instant' });
  });

  it('leaves a visible button, a strip that does not scroll and a hidden strip alone', () => {
    const visible = strip({ button: [20, 300] });
    revealSegmentButton(visible.segment, visible.button);
    const fits = strip({ scrollWidth: 355, button: [318, 311] });
    revealSegmentButton(fits.segment, fits.button);
    const hidden = strip({ width: 0, button: [318, 311] });
    revealSegmentButton(hidden.segment, hidden.button);
    const detached = strip({ button: [318, 311] });
    detached.segment.remove();
    revealSegmentButton(detached.segment, detached.button);
    for (const { scrollTo } of [visible, fits, hidden, detached])
      expect(scrollTo).not.toHaveBeenCalled();
  });
});
