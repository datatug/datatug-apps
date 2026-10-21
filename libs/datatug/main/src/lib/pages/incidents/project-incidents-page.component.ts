import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { PublicDemoInvestigationPreviewComponent } from '../../detective/public-demo-investigation-preview.component';
import { isCanonicalPublicDemo } from '../../detective/public-scenario-catalog';
import { incidentProjectRefFromUrl } from '../../incidents/incident-navigation';
import { IncidentListPageComponent } from './list/incident-list-page.component';

/** Selects the curated public preview only for its canonical demo project. */
@Component({
  selector: 'sneat-datatug-project-incidents',
  imports: [IncidentListPageComponent, PublicDemoInvestigationPreviewComponent],
  styles: `
    :host > sneat-datatug-incident-list,
    :host > sneat-public-demo-investigation-preview {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-height: 0;
    }
  `,
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
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(
        this.router.currentNavigation?.()?.finalUrl?.toString() ??
          this.router.url,
      ),
    ),
    { requireSync: true },
  );

  protected readonly publicDemo = computed(() =>
    isCanonicalPublicDemo(incidentProjectRefFromUrl(this.currentUrl())),
  );
}
