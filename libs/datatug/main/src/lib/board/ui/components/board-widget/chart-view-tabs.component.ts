import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { IonSegment, IonSegmentButton, IonLabel } from '@ionic/angular';
export type ChartResultView = 'chart' | 'trend' | 'grid';
@Component({
  selector: 'sneat-datatug-chart-view-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSegment, IonSegmentButton, IonLabel],
  template: `<ion-segment
    aria-label="Chart result view"
    [value]="view()"
    [selectOnFocus]="true"
    (ionChange)="select($event.detail.value)"
  >
    <ion-segment-button value="chart"
      ><ion-label>Chart</ion-label></ion-segment-button
    >
    @if (hasTrend()) {
      <ion-segment-button value="trend"
        ><ion-label>Monthly trends</ion-label></ion-segment-button
      >
    }
    <ion-segment-button value="grid"
      ><ion-label>Source rows</ion-label></ion-segment-button
    >
  </ion-segment>`,
  styles: [
    `
      :host {
        display: block;
        width: min(32rem, 60vw);
        flex: 0 1 auto;
        background: var(--ion-color-light);
      }
      ion-segment {
        margin: 0;
      }
      ion-segment-button {
        min-width: 0;
        --padding-start: 0.5rem;
        --padding-end: 0.5rem;
      }
      ion-label {
        white-space: normal;
        text-transform: none;
      }
    `,
  ],
})
export class ChartViewTabsComponent {
  readonly view = input<ChartResultView>('chart');
  readonly hasTrend = input(false);
  readonly viewChange = output<ChartResultView>();
  select(value: string | number | undefined): void {
    if (
      value === 'chart' ||
      value === 'grid' ||
      (value === 'trend' && this.hasTrend())
    )
      this.viewChange.emit(value);
  }
}
