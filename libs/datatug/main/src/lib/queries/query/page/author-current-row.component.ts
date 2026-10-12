import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
} from '@angular/core';
import { IonItem, IonLabel, IonList, IonNote } from '@ionic/angular';
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
  imports: [IonItem, IonLabel, IonList, IonNote],
})
export class AuthorCurrentRowComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  public readonly columns = input<readonly AuthorCurrentRowColumn[]>([]);
  public readonly row = input<readonly TypedValue[] | undefined>();
  public readonly position = input<number | undefined>();
  public readonly totalRows = input(0);
  public readonly snapshotKey = input<unknown>();

  public constructor() {
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
}
