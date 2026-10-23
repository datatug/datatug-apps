import { computed } from '@angular/core';
import { projectItemLink } from '../../../tags/tag-navigation';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map, combineLatest } from 'rxjs';
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
  private readonly route = inject(ActivatedRoute);
  readonly tag = toSignal(
    combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
      map(
        ([params, query]) =>
          params.get('tag') ??
          (this.route.snapshot?.routeConfig?.path === 'tag'
            ? query.get('tag')
            : null) ??
          undefined,
      ),
    ),
  );
  readonly tagError = computed(() => {
    const tag = this.tag();
    return tag !== undefined &&
      (!tag.length || new TextEncoder().encode(tag).length > 50)
      ? 'A tag must contain 1 to 50 UTF-8 bytes.'
      : '';
  });
  readonly projectRef = toSignal(inject(ProjectContextService).current$);
  readonly allTagsLink = computed(() =>
    projectItemLink(this.projectRef(), 'tags'),
  );
  ionViewWillEnter(): void {
    this.cloud()?.reload();
  }
}
