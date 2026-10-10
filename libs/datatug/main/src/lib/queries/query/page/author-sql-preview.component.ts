import { Component, Input } from '@angular/core';
import type { PublicSqliteQueryPreview } from '../../public-sqlite-tugql';

@Component({
  selector: 'sneat-author-sql-preview',
  templateUrl: './author-sql-preview.component.html',
  styleUrl: './author-sql-preview.component.scss',
})
export class AuthorSqlPreviewComponent {
  @Input({ required: true }) public plan!: PublicSqliteQueryPreview;
  @Input() public customerId = '';
  @Input() public customerIdValid = false;
  @Input() public customerIdMissing = true;
}
