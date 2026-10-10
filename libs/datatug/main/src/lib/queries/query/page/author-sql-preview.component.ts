import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PublicSqliteQueryPreview } from '../../public-sqlite-tugql';

@Component({
  selector: 'sneat-author-sql-preview',
  templateUrl: './author-sql-preview.component.html',
  styleUrl: './author-sql-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthorSqlPreviewComponent {
  public readonly plan = input.required<PublicSqliteQueryPreview>();
  public readonly customerId = input('');
  public readonly customerIdValid = input(false);
  public readonly customerIdMissing = input(true);
}
