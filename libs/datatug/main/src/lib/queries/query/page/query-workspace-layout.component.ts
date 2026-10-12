import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  input,
} from '@angular/core';
import { IonButton, IonButtons } from '@ionic/angular';

@Component({
  selector: 'sneat-query-workspace-layout',
  templateUrl: './query-workspace-layout.component.html',
  styleUrl: './query-workspace-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonButtons],
})
export class QueryWorkspaceLayoutComponent {
  public readonly showResultsJump = input(true);
  @ViewChild('editorRegion') private editorRegion?: ElementRef<HTMLElement>;
  @ViewChild('resultsRegion') private resultsRegion?: ElementRef<HTMLElement>;

  public showEditor(): void {
    this.focusRegion(this.editorRegion);
  }

  public scrollToEditor(): void {
    this.scrollRegion(this.editorRegion);
  }

  public showResults(): void {
    this.focusRegion(this.resultsRegion);
  }

  private focusRegion(region?: ElementRef<HTMLElement>): void {
    const element = region?.nativeElement;
    if (!element) return;
    this.scrollRegion(region);
    const focusTarget = element.querySelector<HTMLElement>(
      '[data-workspace-heading], h2[tabindex="-1"]',
    );
    (focusTarget ?? element).focus({ preventScroll: true });
  }

  private scrollRegion(region?: ElementRef<HTMLElement>): void {
    const behavior = globalThis.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches
      ? 'auto'
      : 'smooth';
    region?.nativeElement.scrollIntoView?.({
      block: 'start',
      behavior,
    });
  }
}
