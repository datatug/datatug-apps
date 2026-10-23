import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonSelect,
  IonSelectOption,
  IonToolbar,
  IonIcon,
} from '@ionic/angular';
import { EvidenceSharePanelComponent } from '../evidence/evidence-share-panel.component';
import type { SemanticBrowserModel } from './semantic-browser-model';
/** Presentation only. Source adapters own reads, writes, identity and recovery. */
@Component({
  selector: 'sneat-semantic-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonButton,
    IonButtons,
    IonSelect,
    IonSelectOption,
    IonToolbar,
    IonIcon,
    EvidenceSharePanelComponent,
  ],
  templateUrl: './semantic-browser.component.html',
  styles: [
    `
      :host {
        display: block;
        margin-block: 1.5rem;
      }
      .tables-toolbar {
        --background: var(--ion-color-light);
      }
      .content {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
        gap: 1rem;
      }
      .scroll {
        overflow-x: auto;
        max-width: 100%;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th,
      td {
        padding: 0.4rem;
        text-align: start;
        border-bottom: 1px solid var(--ion-color-light-shade);
      }
      td button {
        background: transparent;
        color: inherit;
        padding: 0.35rem;
        white-space: nowrap;
        cursor: pointer;
        border: 2px solid transparent;
      }
      td button[aria-pressed='true'] {
        border-color: var(--ion-color-primary);
      }
      td button:focus-visible {
        outline: 2px solid var(--ion-color-primary);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }
      .checks-toolbar {
        --min-height: 2.5rem;
      }
      .checks-toolbar h4 {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
      }
      .checks-intro {
        margin: 0.35rem 0 0.5rem;
        font-size: 0.85rem;
        line-height: 1.45;
      }
      .check-list {
        container-type: inline-size;
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .check-list li {
        padding-block: 0.5rem;
        border-bottom: 1px solid var(--ion-color-light-shade);
        overflow-wrap: anywhere;
      }
      .check-heading {
        display: grid;
        grid-template-columns: minmax(0, 1fr) max-content max-content;
        align-items: center;
        gap: 0.25rem 0.5rem;
      }
      .check-title {
        min-width: 0;
        font-size: 0.9rem;
        line-height: 1.4;
        font-weight: 600;
      }
      .check-state {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        color: var(--ion-text-color);
        font-size: 0.85rem;
        font-weight: 500;
        line-height: 1.4;
      }
      .check-state::before {
        content: '';
        width: 0.4rem;
        height: 0.4rem;
        border: 1px solid currentColor;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .check-heading ion-buttons {
        margin: 0;
        justify-self: end;
      }
      .check-heading ion-button {
        --color: var(--ion-text-color);
        --padding-start: 0.35rem;
        --padding-end: 0.35rem;
        margin: 0;
        min-height: 1.75rem;
        font-size: 0.85rem;
      }
      .check-heading ion-button::part(native) {
        text-decoration: underline;
        text-underline-offset: 0.18em;
      }
      .check-meta {
        margin: 0.1rem 0 0.2rem;
        color: var(--ion-text-color-step-350, var(--ion-text-color));
        font-size: 0.78rem;
        line-height: 1.4;
      }
      .check-details {
        font-size: 0.78rem;
        line-height: 1.4;
      }
      .check-details summary {
        cursor: pointer;
      }
      .check-details p {
        margin: 0.25rem 0;
      }
      @container (max-width: 24rem) {
        .check-heading {
          grid-template-columns: minmax(0, 1fr) max-content;
        }
        .check-title {
          grid-column: 1 / -1;
        }
      }
      details {
        overflow-wrap: anywhere;
      }
      @media (max-width: 400px) {
        .refresh-label {
          display: none;
        }
      }
      @media (max-width: 700px) {
        .content {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
})
export class SemanticBrowserComponent {
  readonly model = input.required<SemanticBrowserModel>();
}
