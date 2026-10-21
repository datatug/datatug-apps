import { Component, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { ProjectContextService } from '../../../services/project/project-context.service';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { ProjectTagsCloudComponent } from '../../../tags/project-tags-cloud.component';

@Component({
  selector: 'sneat-datatug-tags',
  templateUrl: './tags-page.component.html',
  imports: [
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons,
    IonBackButton,
    IonMenuButton,
    ProjectTagsCloudComponent,
    DatatugServicesProjectModule,
  ],
})
export class TagsPageComponent {
  private readonly cloud = viewChild(ProjectTagsCloudComponent);
  readonly projectRef = toSignal(inject(ProjectContextService).current$);
  ionViewWillEnter(): void {
    this.cloud()?.reload();
  }
}
