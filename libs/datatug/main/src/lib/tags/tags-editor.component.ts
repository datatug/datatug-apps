import { RouterLink } from '@angular/router';
import { IProjectRef } from '../core/project-context';
import { projectTagLink } from './tag-navigation';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import {
  IonCard,
  IonItemDivider,
  IonButtons,
  IonButton,
  IonChip,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
} from '@ionic/angular';
import { newTagError } from './tags';
@Component({
  selector: 'sneat-datatug-tags-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonCard,
    IonItemDivider,
    IonButtons,
    IonButton,
    IonChip,
    IonInput,
    IonItem,
    IonLabel,
    IonNote,
  ],
  template: ` <ion-card aria-label="Tags">
    <ion-item-divider color="light"
      ><ion-label
        ><h2>
          <strong>Tags</strong>
          @if (readOnlyDescription()) {
            <span class="readonly-description">
              {{ readOnlyDescription() }}</span
            >
          }
        </h2></ion-label
      ><ion-buttons slot="end"
        ><ng-content select="[tag-actions]" /></ion-buttons
    ></ion-item-divider>
    <div class="tag-list">
      @for (tag of tags(); track tag) {
        <ion-chip [outline]="!readonly()">
          @if (projectRef()) {
            <a
              [routerLink]="tagLink(projectRef(), tag)"
              (click)="$event.stopPropagation()"
              >{{ tag }}</a
            >
          } @else {
            {{ tag }}
          }
          @if (!readonly()) {
            <button
              type="button"
              [disabled]="disabled()"
              [attr.aria-label]="'Remove tag ' + tag"
              (click)="remove(tag)"
            >
              ×
            </button>
          }
        </ion-chip>
      } @empty {
        <ion-note>No tags yet.</ion-note>
      }
    </div>
    @if (!readonly()) {
      <ion-item lines="none">
        <ion-input
          aria-label="New tag"
          placeholder="Add a tag"
          [value]="draft()"
          [disabled]="disabled()"
          (ionInput)="draft.set($event.detail.value || ''); error.set('')"
          (keydown.enter)="$event.preventDefault(); add()"
        />
        <ion-button
          slot="end"
          [disabled]="disabled() || !draft().trim()"
          (click)="add()"
          >Add tag</ion-button
        >
      </ion-item>
      @if (error()) {
        <p class="ion-padding-horizontal" role="alert">{{ error() }}</p>
      }
      <p class="ion-padding-horizontal">
        <ion-note>Save changes to keep tags.</ion-note>
      </p>
    }
    <ng-content select="[tag-status]" />
  </ion-card>`,
  styles: [
    `
      .readonly-description {
        font-weight: normal;
      }
      .tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        padding: 0.75rem 1rem;
      }
      .tag-list a { color: inherit; }
      button {
        background: transparent;
        padding: 0;
        min-width: 1.75rem;
        min-height: 1.75rem;
        margin-inline-start: .35rem;
        cursor: pointer;
        border: 0;
        color: inherit;
      }
    `,
  ],
})
export class TagsEditorComponent {
  readonly projectRef = input<IProjectRef>();
  readonly tagLink = projectTagLink;
  readonly tags = input<readonly string[]>([]);
  readonly readOnlyDescription = input('');
  readonly disabled = input(false);
  readonly readonly = input(false);
  readonly tagsChange = output<string[]>();
  readonly draft = signal('');
  readonly error = signal('');
  add(): void {
    if (this.disabled() || this.readonly()) return;
    this.error.set(newTagError(this.draft(), this.tags()));
    if (this.error()) return;
    this.tagsChange.emit([...this.tags(), this.draft().trim()]);
    this.draft.set('');
  }
  remove(tag: string): void {
    if (!this.disabled() && !this.readonly())
      this.tagsChange.emit(this.tags().filter((value) => value !== tag));
  }
}
