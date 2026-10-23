import type { ProjectRouterCommand } from '../nav/project-page-href';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, flaskOutline } from 'ionicons/icons';

addIcons({ addOutline, flaskOutline });

/** Presentational entry point shared by agent and private hosted Incident lists. */
@Component({
  selector: 'sneat-datatug-incident-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonButton, IonIcon],
  template: `
    <section class="incident-welcome" aria-labelledby="incident-welcome-title">
      <div class="welcome-copy">
        <p class="eyebrow">Your next investigation starts here</p>
        <h1 id="incident-welcome-title">
          Follow the evidence.<br /><span>Find the cause.</span>
        </h1>
        <p class="intro">
          Turn a reported problem into a clear investigation. Start with what
          you know, gather the evidence, and keep the story together.
        </p>
        @if (createLink(); as link) {
          <div class="actions">
            <ion-button
              [routerLink]="link"
              [queryParams]="testQueryParams()"
              [disabled]="!canCreate()"
            >
              <ion-icon slot="start" name="flask-outline" />Try a test incident
            </ion-button>
            <ion-button
              fill="outline"
              [routerLink]="link"
              [queryParams]="queryParams()"
              [disabled]="!canCreate()"
            >
              <ion-icon slot="start" name="add-outline" />Report an incident
            </ion-button>
          </div>
          <p class="reassurance">
            The test opens an editable example. Nothing is saved until you
            choose Create incident.
          </p>
        } @else {
          <p class="reassurance">
            Open a connected project or set up a private project to try a test
            incident or report a real problem.
          </p>
        }
      </div>
      <img
        class="harbor"
        src="/assets/illustrations/incidentius-harbor-800.webp"
        alt="" loading="eager" decoding="async"
        width="800"
        height="450"
      />
    </section>
    <ol class="investigation-steps" aria-label="How an investigation starts">
      <li>
        <span>01</span>
        <div>
          <strong>Describe the problem</strong>
          <p>Start with a report, even a rough one.</p>
        </div>
      </li>
      <li>
        <span>02</span>
        <div>
          <strong>Bring the context</strong>
          <p>Keep useful observations together.</p>
        </div>
      </li>
      <li>
        <span>03</span>
        <div>
          <strong>Follow the evidence</strong>
          <p>Build an investigation from the facts.</p>
        </div>
      </li>
    </ol>
    <ng-content />
  `,
  styleUrl: './incident-empty-state.component.scss',
})
export class IncidentEmptyStateComponent {
  readonly createLink = input<string | readonly ProjectRouterCommand[] | undefined>();
  readonly queryParams = input<Record<string, unknown> | undefined>();
  readonly canCreate = input(true);
  protected testQueryParams(): Record<string, unknown> {
    return { ...this.queryParams(), draft: 'test' };
  }
}
