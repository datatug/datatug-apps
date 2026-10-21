import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { PublicDemoInvestigationPreviewComponent } from '../../detective/public-demo-investigation-preview.component';
import { isCanonicalPublicDemo } from '../../detective/public-scenario-catalog';
import { incidentProjectRefFromUrl } from '../../incidents/incident-navigation';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { IncidentListPageComponent } from './list/incident-list-page.component';

/** Selects the curated public preview only for its canonical demo project. */
@Component({
  selector: 'sneat-datatug-project-incidents',
  imports: [IncidentListPageComponent, PublicDemoInvestigationPreviewComponent],
  template: `
    @if (publicDemo()) {
      <sneat-public-demo-investigation-preview section="incidents" />
    } @else {
      <sneat-datatug-incident-list />
    }
  `,
})
export class ProjectIncidentsPageComponent {
  private readonly router = inject(Router);
  private readonly navContext = inject(DatatugNavContextService);
  private readonly project = toSignal(this.navContext.currentProject, {
    initialValue: undefined,
  });

  protected readonly publicDemo = computed(() =>
    isCanonicalPublicDemo(
      this.project()?.ref ?? incidentProjectRefFromUrl(this.router.url),
    ),
  );
}
