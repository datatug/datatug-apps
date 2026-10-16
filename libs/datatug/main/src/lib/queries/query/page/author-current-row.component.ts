import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { IonButton, IonButtons, IonIcon, IonItem, IonLabel, IonList, IonNote } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { copyOutline, funnelOutline } from 'ionicons/icons';
import type { TypedValue } from '@sneat/datatug-semantic';

export interface AuthorCurrentRowColumn {
  readonly name: string;
  readonly type: string;
}

@Component({
  selector: 'sneat-author-current-row',
  templateUrl: './author-current-row.component.html',
  styleUrl: './author-current-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonButtons, IonIcon, IonItem, IonLabel, IonList, IonNote],
})
export class AuthorCurrentRowComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  public readonly columns = input<readonly AuthorCurrentRowColumn[]>([]);
  public readonly row = input<readonly TypedValue[] | undefined>();
  public readonly position = input<number | undefined>();
  public readonly totalRows = input(0);
  public readonly totalKnown = input(true);
  public readonly snapshotKey = input<unknown>();
  public readonly filterStatus = input('');
  /** Whether each field offers "Use as filter" (only where a query can take the filter). */
  public readonly showFilter = input(true);
  public readonly useAsFilter = output<{ index: number; row: readonly TypedValue[]; snapshotKey: unknown }>();
  public readonly copyRequested = output<void>();
  private feedbackGeneration = 0;
  private readonly copyFeedback = signal<{ row: readonly TypedValue[]; snapshotKey: unknown; text: string } | undefined>(undefined);
  public readonly copyStatus = () => {
    const feedback = this.copyFeedback();
    return feedback && feedback.row === this.row() && feedback.snapshotKey === this.snapshotKey() ? feedback.text : '';
  };

  public constructor() {
    addIcons({ copyOutline, funnelOutline });
    effect(() => {
      this.snapshotKey();
      this.row();
      this.host.nativeElement.scrollTop = 0;
    });
  }

  public duplicateColumnName(index: number): boolean {
    const name = this.columns()[index]?.name;
    return this.columns().filter((column) => column.name === name).length > 1;
  }

  public valueText(index: number): string {
    const value = this.row()?.[index];
    if (!value) return 'Missing value';
    if (value.type === 'null') return 'SQL NULL';
    if (value.type === 'string' && value.value.length === 0)
      return '(empty string)';
    return String(value.value);
  }

  public valueType(index: number): string {
    return this.row()?.[index]?.type ?? 'missing';
  }

  public requestFilter(index: number): void {
    const row = this.row();
    if (row) {
      this.feedbackGeneration += 1;
      this.copyFeedback.set(undefined);
      this.useAsFilter.emit({ index, row, snapshotKey: this.snapshotKey() });
    }
  }

  public copyValue(index: number): void {
    const row = this.row();
    const value = row?.[index];
    if (!row) return;
    this.copyRequested.emit();
    if (!value) {
      ++this.feedbackGeneration;
      this.copyFeedback.set({ row, snapshotKey: this.snapshotKey(), text: 'No value is available to copy for this column.' });
      return;
    }
    void this.copyText(value.type === 'null' ? 'null' : String(value.value), row, `Value copied`);
  }

  public copyRecord(): void {
    const row = this.row();
    if (!row) return;
    this.copyRequested.emit();
    const text = JSON.stringify(this.columns().map((column, index) => ({
      index,
      column: column.name,
      ...(row[index] ?? { type: 'missing' as const }),
    })), null, 2);
    void this.copyText(text, row, 'Record copied');
  }

  private async copyText(text: string, row: readonly TypedValue[], success: string): Promise<void> {
    const snapshotKey = this.snapshotKey();
    const generation = ++this.feedbackGeneration;
    this.copyFeedback.set(undefined);
    let write: Promise<void>;
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      write = clipboard.writeText(text);
    } catch {
      if (this.feedbackGeneration === generation)
        this.copyFeedback.set({ row, snapshotKey, text: "Couldn't copy. Try again." });
      return;
    }
    try {
      await write;
      if (this.feedbackGeneration === generation && this.row() === row && this.snapshotKey() === snapshotKey)
        this.copyFeedback.set({ row, snapshotKey, text: success });
    } catch {
      if (this.feedbackGeneration === generation && this.row() === row && this.snapshotKey() === snapshotKey)
        this.copyFeedback.set({ row, snapshotKey, text: "Couldn't copy. Try again." });
    }
  }
}
