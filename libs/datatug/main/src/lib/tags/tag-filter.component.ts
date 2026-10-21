import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  IonButton,
  IonChip,
  IonItemDivider,
  IonLabel,
  IonNote,
} from '@ionic/angular';
import { TaggedItem, tagCounts } from './tags';
@Component({
  selector: 'sneat-datatug-tag-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonChip, IonItemDivider, IonLabel, IonNote],
  template: ` <section aria-label="Filter by tags">
    <ion-item-divider color="light"
      ><ion-label
        ><h2>Tags</h2>
        <p>Match all selected tags (AND).</p></ion-label
      >
      @if (selected().length) {
        <ion-button slot="end" fill="clear" (click)="selectedChange.emit([])"
          >Clear tags</ion-button
        >
      }
    </ion-item-divider>
    <div class="tag-filters">
      @for (item of counts(); track item.tag) {
        <button
          type="button"
          [attr.aria-pressed]="selected().includes(item.tag)"
          (click)="toggle(item.tag)"
        >
          <ion-chip
            [outline]="!selected().includes(item.tag)"
            [color]="selected().includes(item.tag) ? 'primary' : undefined"
            >{{ item.tag }} ({{ item.count }})</ion-chip
          >
        </button>
      } @empty {
        <ion-note>No tags yet. Add tags from an item's details.</ion-note>
      }
    </div>
  </section>`,
  styles: [
    `
      .tag-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        padding: 0 1rem 0.75rem;
      }
      button {
        background: transparent;
        padding: 0;
        border: 0;
        color: inherit;
      }
    `,
  ],
})
export class TagFilterComponent {
  readonly items = input<readonly TaggedItem[]>([]);
  readonly selected = input<readonly string[]>([]);
  readonly selectedChange = output<string[]>();
  readonly counts = computed(() => {
    const counts = tagCounts(this.items());
    for (const tag of this.selected())
      if (!counts.some((item) => item.tag === tag))
        counts.push({ tag, count: 0 });
    return counts;
  });
  toggle(tag: string): void {
    this.selectedChange.emit(
      this.selected().includes(tag)
        ? this.selected().filter((value) => value !== tag)
        : [...this.selected(), tag],
    );
  }
}
