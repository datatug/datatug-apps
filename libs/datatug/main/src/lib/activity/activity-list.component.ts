import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { IonButton, IonButtons, IonIcon } from '@ionic/angular';
import { timeOutline } from 'ionicons/icons';
import { type ActivityListItem } from './activity-list-item';

/** A neutral view: the owner supplies labels/data and handles every action. */
@Component({
  selector: 'sneat-activity-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonButtons, IonIcon],
  styles: `
    :host {
      display: block;
      color: var(--ion-text-color);
    }
    header,
    .item-heading {
      display: flex;
      align-items: center;
      gap: 0.25rem 0.5rem;
    }
    header {
      flex-wrap: wrap;
      justify-content: space-between;
    }
    h2 {
      font-size: 1rem;
      margin: 0;
      overflow-wrap: anywhere;
      min-width: 0;
    }
    ion-button {
      --color: var(--ion-text-color);
      font-size: 0.85rem;
    }
    ul {
      padding: 0;
      margin: 0.25rem 0;
      list-style: none;
    }
    li {
      padding-block: 0.5rem;
      border-bottom: 1px solid var(--ion-color-light-shade);
      overflow-wrap: anywhere;
    }
    .item-heading {
      flex-wrap: wrap;
    }
    .item-heading ion-button {
      margin-inline-start: auto;
    }
    .item-meta {
      margin: 0.1rem 0;
      font-size: 0.8rem;
      color: var(--ion-text-color-step-350, var(--ion-text-color));
    }
    p {
      font-size: 0.85rem;
      line-height: 1.45;
    }
  `,
  template: `<section [attr.aria-label]="heading()">
    <header>
      <h2>{{ heading() }}</h2>
      <ion-buttons slot="end"
        ><ion-button
          fill="clear"
          (click)="reload.emit()"
          [disabled]="loading() || disabled()"
          [attr.aria-label]="actionLabel()"
        >
          <ion-icon [icon]="activityIcon" slot="start" aria-hidden="true" />{{
            actionLabel()
          }}
        </ion-button></ion-buttons
      >
    </header>
    <ng-content />
    @if (loading()) {
      <p role="status">{{ loadingMessage() }}</p>
    } @else if (error()) {
      <p role="alert">{{ error() }}</p>
    } @else if (notice()) {
      <p role="status">{{ notice() }}</p>
    }
    @if (items(); as entries) {
      <ul [attr.aria-label]="listLabel()">
        @for (item of entries; track item.id) {
          <li>
            <div class="item-heading">
              <strong>{{ item.title }}</strong
              ><span>{{ item.outcome }}</span>
              <ion-button
                size="small"
                fill="clear"
                (click)="openItem.emit(item.id)"
                [disabled]="loading() || disabled()"
                >{{ item.openLabel }}</ion-button
              >
            </div>
            <p class="item-meta">
              <time [attr.datetime]="item.acceptedAt">{{
                item.acceptedAt
              }}</time>
              @if (item.metadata) {
                · {{ item.metadata }}
              }
            </p>
            @if (item.detail; as detail) {
              <details>
                <summary>{{ detail.label }}</summary>
                <p class="item-meta">{{ detail.text }}</p>
              </details>
            }
          </li>
        } @empty {
          <li>{{ emptyMessage() }}</li>
        }
      </ul>
    }
  </section>`,
})
export class ActivityListComponent {
  readonly heading = input.required<string>();
  readonly actionLabel = input.required<string>();
  readonly listLabel = input.required<string>();
  readonly loadingMessage = input.required<string>();
  readonly emptyMessage = input.required<string>();
  readonly items = input<readonly ActivityListItem[]>();
  readonly loading = input(false);
  readonly disabled = input(false);
  readonly error = input('');
  readonly notice = input('');
  readonly reload = output<void>();
  readonly openItem = output<string>();
  readonly activityIcon = timeOutline;
}
