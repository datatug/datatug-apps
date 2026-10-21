import { computed } from '@angular/core';
import { projectItemLink } from '../../../tags/tag-navigation';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { Component, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  IonBackButton,
  IonItem,
  IonLabel,
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
    RouterLink,
    IonItem,
    IonLabel,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonBackButton,
    IonMenuButton,
    ProjectTagsCloudComponent,
    DatatugServicesProjectModule,
  ],
})
export class TagsPageComponent {
  private readonly cloud = viewChild(ProjectTagsCloudComponent);
  readonly tag = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => params.get('tag') ?? undefined),
    ),
  );
  readonly projectRef = toSignal(inject(ProjectContextService).current$);
  readonly allTagsLink = computed(() =>
    projectItemLink(this.projectRef(), 'tags'),
  );
  ionViewWillEnter(): void {
    this.cloud()?.reload();
  }
}
