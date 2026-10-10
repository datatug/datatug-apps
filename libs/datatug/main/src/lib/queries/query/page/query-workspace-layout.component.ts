import {
  ChangeDetectionStrategy,
  Component,
  signal,
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
  public readonly mobilePane = signal<'editor' | 'results'>('editor');
}
