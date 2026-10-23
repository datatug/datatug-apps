/**
 * Scrolls a scrollable `ion-segment` so that one of its buttons is fully visible.
 *
 * Ionic centres the checked button with a smooth scroll, which a focus move or a reflow of the page can cut
 * short, leaving the selected tab clipped on a narrow screen. This settles it with an instant scroll by the
 * smallest distance; a button already in view, or a segment that does not scroll, is left alone.
 */
export function revealSegmentButton(
  segment: HTMLElement,
  button: HTMLElement,
): void {
  if (!segment.isConnected || segment.getBoundingClientRect().width === 0)
    return;
  if (segment.scrollWidth <= segment.clientWidth) return;
  const viewport = segment.getBoundingClientRect();
  const selected = button.getBoundingClientRect();
  const delta =
    selected.left < viewport.left
      ? selected.left - viewport.left
      : selected.right > viewport.right
        ? selected.right - viewport.right
        : 0;
  if (Math.abs(delta) > 1)
    segment.scrollTo({ left: segment.scrollLeft + delta, behavior: 'instant' });
}
