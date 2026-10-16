import { Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonCard,
  IonIcon,
  IonItemDivider,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular';
import { QueriesMenuComponent } from '../../../queries/queries-menu.component';
import { ProjectMenuTopComponent } from '../project-menu-top/project-menu-top.component';

@Component({
  selector: 'sneat-datatug-project-menu',
  templateUrl: './project-menu.component.html',
  imports: [
    IonCard,
    IonItemDivider,
    IonSegment,
    IonSegmentButton,
    IonIcon,
    ProjectMenuTopComponent,
    QueriesMenuComponent,
    FormsModule,
  ],
})
export class ProjectMenuComponent {
  readonly metadataOnly = input(false);
  public tab: 'project' | 'queries' = 'project';
}
