import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonTitle } from '@ionic/angular';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';

/**
 * The standard project-sub-page header: "{Page title} @ {Project title}",
 * page title bold, project title normal weight (founder ruling 2026-09-10,
 * S152, checking build a7eaf10: "When showing project page it should show
 * in header "{Page title} @ {Project title}"" — example given for the
 * Boards page: "Boards @ DataTug Demo Project 1"). Renders its own
 * `<ion-title>`, so a page swaps its literal
 * `<ion-title>Boards</ion-title>` for
 * `<sneat-datatug-page-title pageTitle="Boards" />` directly inside
 * `<ion-toolbar>`.
 *
 * `projectTitle` is derived from `DatatugNavContextService.currentProject`
 * (the root-singleton nav-state service every project page already reads
 * for the same purpose — see that service's own doc comment) rather than
 * threaded through as an input, so every page shows the identical title
 * with no per-page copy of the lookup/fallback order:
 *   - `brief.title` (populated once the project summary has loaded, or
 *     carried over from an earlier navigation), else
 *   - `summary.title` (covers the gap before
 *     `populateProjectBriefFromSummaryIfMissing` back-fills `brief`), else
 *   - `ref.projectId` — the project id itself, shown while the summary is
 *     still loading rather than leaving the header blank.
 * With no project in context at all (`currentProject` emits `undefined` —
 * e.g. this component used outside a project route) only the bare page
 * title renders, no dangling " @ ".
 */
@Component({
  selector: 'sneat-datatug-page-title',
  templateUrl: './sneat-datatug-page-title.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonTitle],
})
export class SneatDatatugPageTitleComponent {
  private readonly navContext = inject(DatatugNavContextService);

  public readonly pageTitle = input.required<string>();

  private readonly currentProject = toSignal(this.navContext.currentProject, {
    initialValue: undefined,
  });

  protected readonly projectTitle = computed<string | undefined>(() => {
    const project = this.currentProject();
    return (
      project &&
      (project.brief?.title || project.summary?.title || project.ref?.projectId)
    );
  });
}
