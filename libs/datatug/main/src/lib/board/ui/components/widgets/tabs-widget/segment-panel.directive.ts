import { DestroyRef, Directive, ElementRef, effect, inject, input } from '@angular/core';

type SegmentHost = HTMLElement & { componentOnReady?: () => Promise<unknown> };

/** Ionic exposes role=tab on its documented native part, not the outer host.
 * Host IDREF attributes cannot associate that shadow button with a light-DOM
 * panel. Element-reference ARIA crosses this boundary without private Ionic APIs.
 */
@Directive({ selector: 'ion-segment-button[sneatSegmentPanel]' })
export class SegmentPanelDirective {
  readonly sneatSegmentPanel = input<HTMLElement>();
  readonly panelSelected = input(false);
  private readonly host = inject<ElementRef<SegmentHost>>(ElementRef).nativeElement;
  private generation = 0;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.generation++; });
    effect((onCleanup) => {
      const panel = this.sneatSegmentPanel();
      const selected = this.panelSelected();
      const generation = ++this.generation;
      let cancelled = false;
      onCleanup(() => { cancelled = true; });
      const associate = async () => {
        await this.host.componentOnReady?.();
        if (cancelled || this.destroyed || generation !== this.generation || selected !== this.panelSelected() ||
          panel !== this.sneatSegmentPanel() || !this.host.isConnected || !panel?.isConnected) return;
        const button = this.host.shadowRoot?.querySelector<HTMLButtonElement>('button[part~="native"]');
        // Older engines keep Ionic's existing focus/keyboard behavior; never
        // throw or claim an IDREF connection they cannot actually represent.
        if (button && 'ariaControlsElements' in button) button.ariaControlsElements = [panel];
      };
      void associate().catch(() => undefined);
    });
  }
}
