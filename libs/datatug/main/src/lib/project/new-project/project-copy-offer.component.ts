import { NavigationStart, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle } from '@ionic/angular';
import { ProjectCopyOfferSessionService } from './project-copy-offer-session.service';
import { NewProjectService } from './new-project.service';
import { resolveDemoProjectCopySource } from './github-project-copy-source';

@Component({
  selector: 'sneat-datatug-project-copy-offer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle],
  providers: [NewProjectService],
  styles: 'pre { white-space: pre-wrap; overflow-wrap: anywhere; user-select: all; }',
  template: `
    @if (expanded()) {
      <ion-card data-testid="project-copy-offer">
        <ion-card-header><ion-card-title>Make this DataTug project yours</ion-card-title></ion-card-header>
        <ion-card-content>
          <p>Your editable SQLite copy is ready. You can keep exploring, or copy the DataTug demo project in either of these two ways.</p>
          <ion-button data-testid="project-copy-github" [disabled]="resolving()" (click)="copyToGithub()">{{ resolving() ? 'Verifying source…' : 'Copy this demo project to GitHub' }}</ion-button>
          <ion-button data-testid="project-copy-local" fill="outline" (click)="local.set(!local())">Clone a local Git repository</ion-button>
          @if (error()) { <p role="alert">{{ error() }}</p> }
          @if (local()) {
            <div data-testid="project-copy-local-instructions">
              <p>With Git and the <a href="https://datatug.io/install/" target="_blank" rel="noopener noreferrer">DataTug CLI installed</a>, run:</p>
              <pre>{{ commands }}</pre>
              <ion-button data-testid="project-copy-commands" fill="outline" (click)="copyCommands()">Copy commands</ion-button>
              @if (clipboardMessage()) { <p role="status">{{ clipboardMessage() }}</p> }
              <p>The project files are cloned to disk. The SQLite database and your edits stay in this browser (in OPFS when persistent storage is available); these commands do not export them. The CLI opens the cloned project; some connections may need local files or network access.</p>
            </div>
          }
          <ion-button data-testid="project-copy-dismiss" fill="clear" (click)="dismiss()">Keep exploring</ion-button>
        </ion-card-content>
      </ion-card>
    } @else {
      <ion-button data-testid="project-copy-reopen" fill="clear" (click)="reopen()">Copy this DataTug project</ion-button>
    }
  `,
})
export class ProjectCopyOfferComponent {
  private readonly newProject = inject(NewProjectService);
  private readonly session = inject(ProjectCopyOfferSessionService);
  readonly dataset = input('demo');
  private readonly sourceGeneration = signal(0);
  constructor() {
    effect(() => {
      const dataset = this.dataset();
      this.invalidateSource();
      this.expanded.set(!this.session.dismissed(dataset));
      this.local.set(false);
    });
    inject(DestroyRef).onDestroy(() => { this.invalidateSource(); });
    // Ionic may cache a page rather than destroy it when leaving.
    inject(Router).events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) this.invalidateSource();
    });
  }
  readonly expanded = signal(true);
  readonly local = signal(false);
  readonly resolving = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly clipboardMessage = signal<string | undefined>(undefined);
  readonly commands = 'git clone https://github.com/datatug/datatug-demo-project.git my-datatug-project\ndatatug serve --project ./my-datatug-project/demo-project-1 --as local --role admin --allow-writes --open-browser';

  dismiss(): void {
    this.invalidateSource();
    this.session.setDismissed(this.dataset(), true);
    this.expanded.set(false);
  }

  reopen(): void {
    this.session.setDismissed(this.dataset(), false);
    this.expanded.set(true);
  }

  private invalidateSource(): void {
    this.sourceGeneration.update((value) => value + 1);
    this.resolving.set(false);
    this.error.set(undefined);
  }

  async copyCommands(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.commands);
      this.clipboardMessage.set('Commands copied.');
    } catch {
      this.clipboardMessage.set('Copy was unavailable. Select the commands above and copy them.');
    }
  }

  async copyToGithub(): Promise<void> {
    if (this.resolving()) return;
    const generation = this.sourceGeneration() + 1;
    this.sourceGeneration.set(generation);
    this.resolving.set(true);
    this.error.set(undefined);
    try {
      const source = await resolveDemoProjectCopySource();
      if (generation === this.sourceGeneration() && this.expanded()) this.newProject.navigateToNewProjectPage('github', undefined, undefined, source);
    } catch {
      if (generation === this.sourceGeneration() && this.expanded()) {
        this.error.set('The source project revision could not be verified. Please try again.');
      }
    } finally {
      if (generation === this.sourceGeneration()) this.resolving.set(false);
    }
  }
}
