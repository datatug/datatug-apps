import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PublicSqliteQueryPreview } from '../../public-sqlite-tugql';

@Component({
  selector: 'sneat-author-source-inspector',
  templateUrl: './author-source-inspector.component.html',
  styleUrl: './author-source-inspector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthorSourceInspectorComponent {
  public readonly plan = input.required<PublicSqliteQueryPreview>();
}
