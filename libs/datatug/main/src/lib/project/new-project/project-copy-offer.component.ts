import { NavigationStart, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonInput } from '@ionic/angular';
import { LocalDemoDbService } from '../../demo-sqlite/local-demodb.service';
import { DemoProjectContinuationService } from './demo-project-continuation.service';
import { demoCopySlug, demoExportError, localCopyCommands } from './demo-local-copy';
import { ProjectCopyOfferSessionService } from './project-copy-offer-session.service';
import { NewProjectService } from './new-project.service';
import { resolveDemoProjectCopySource } from './github-project-copy-source';

@Component({
  selector: 'sneat-datatug-project-copy-offer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonInput],
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
              <ion-button data-testid="project-copy-download" [disabled]="exporting()" (click)="download()">{{ exporting() ? 'Preparing download…' : 'Download edited SQLite' }}</ion-button>
              @if (downloadMessage()) { <p role="status">{{ downloadMessage() }}</p> }
              @if (downloadError()) { <p role="alert">{{ downloadError() }}</p> }
              <p>The browser cannot tell us where you saved the file. Enter its full path after the download.</p>
              <ion-input data-testid="project-copy-file-path" label="Downloaded SQLite file path" labelPlacement="stacked" [value]="filePath()" (ionInput)="filePath.set($event.detail.value ?? '')" />
              <details><summary>Advanced: project folder and ID</summary>
                <ion-input label="Clone folder" [value]="folder()" (ionInput)="folder.set($event.detail.value ?? '')" />
                <ion-input label="Registered project ID" [value]="projectID()" (ionInput)="projectID.set($event.detail.value ?? '')" />
              </details>
              @if (commands(); as generated) { <pre>{{ generated }}</pre> }
              <ion-button data-testid="project-copy-commands" fill="outline" [disabled]="!commands()" (click)="copyCommands()">Copy commands</ion-button>
              @if (clipboardMessage()) { <p role="status">{{ clipboardMessage() }}</p> }
              <p>The project files are cloned to disk. The SQLite database and your edits stay in this browser (in OPFS when persistent storage is available); Download edited SQLite exports the current edited database; cloning alone does not. The CLI opens the cloned project; some connections may need local files or network access.</p>
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
  private readonly localDb = inject(LocalDemoDbService);
  private readonly continuations = inject(DemoProjectContinuationService);
  readonly table = input<string>();
  private readonly session = inject(ProjectCopyOfferSessionService);
  readonly dataset = input('demo');
  private readonly sourceGeneration = signal(0);
  constructor() {
    effect(() => {
      const dataset = this.dataset();
      this.invalidateSource();
      this.expanded.set(!this.session.dismissed(dataset));
      this.local.set(false);
      this.folder.set(demoCopySlug(dataset));
      this.projectID.set(demoCopySlug(dataset));
      this.filePath.set('');
      this.downloadMessage.set(undefined);
      this.downloadError.set(undefined);
      this.clipboardMessage.set(undefined);
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
  readonly filePath = signal('');
  readonly folder = signal('');
  readonly projectID = signal('');
  readonly exporting = signal(false);
  readonly downloadMessage = signal<string | undefined>(undefined);
  readonly downloadError = signal<string | undefined>(undefined);
  readonly commands = computed(() => localCopyCommands(this.dataset().trim().toLowerCase(), this.filePath(), this.folder(), this.projectID()));

  async download(): Promise<void> {
    if (this.exporting()) return;
    const session = this.localDb.peek(this.dataset());
    if (!session) { this.downloadError.set('The edited browser database is unavailable. Return to the demo to reopen it explicitly.'); return; }
    const generation = this.sourceGeneration();
    this.exporting.set(true);
    this.downloadError.set(undefined);
    this.downloadMessage.set(undefined);
    try {
      const bytes = await session.export();
      if (generation !== this.sourceGeneration() || this.localDb.peek(this.dataset()) !== session || !this.expanded()) return;
      if (!(bytes.buffer instanceof ArrayBuffer)) throw new Error('The database export did not return a supported download buffer. Keep this page open and retry.');
      const filename = `${session.entry.dataset}-edited.sqlite`;
      const exported = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const url = URL.createObjectURL(new Blob([exported], { type: 'application/vnd.sqlite3' }));
      try {
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      this.downloadMessage.set(`Downloaded ${filename}. Your edits remain in this browser too.`);
    } catch (error) {
      if (generation === this.sourceGeneration()) this.downloadError.set(demoExportError(error));
    } finally { this.exporting.set(false); }
  }

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
      const commands = this.commands();
      if (!commands) return;
      await navigator.clipboard.writeText(commands);
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
      if (generation === this.sourceGeneration() && this.expanded()) {
        const session = this.localDb.peek(this.dataset());
        if (!session || session.state().kind !== 'ready') { this.error.set('The edited browser database is no longer active. Return to the demo and reopen it explicitly before copying the project.'); return; }
        const token = this.continuations.create({ dataset: session.entry.dataset, canonicalSha256: session.entry.sha256, table: this.table(), source });
        this.newProject.navigateToNewProjectPage('github', undefined, undefined, source, token);
      }
    } catch {
      if (generation === this.sourceGeneration() && this.expanded()) {
        this.error.set('The source project revision could not be verified. Please try again.');
      }
    } finally {
      if (generation === this.sourceGeneration()) this.resolving.set(false);
    }
  }
}
