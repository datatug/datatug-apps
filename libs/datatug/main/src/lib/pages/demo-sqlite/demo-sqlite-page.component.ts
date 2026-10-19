import { ProjectCopyOfferComponent } from '../../project/new-project/project-copy-offer.component';
// /demo/sqlite/:dataset — "Explore SQLite in DataTug" from a DemoDB.dev database page.
//
// Entry: the DemoDB site's link (https://datatug.app/demo/sqlite/<id>), the demo
// project's "Database connections" card, and this page's own dataset list. No
// sign-in, no project or connection to create: the page opens the local copy
// (LocalDemoDbService) and lands in its table list.
//
//   /demo/sqlite                      dataset list
//   /demo/sqlite/<unknown>            "no such dataset" + dataset list
//   /demo/sqlite/<id>                 states → table list (OvdbDatabaseBrowserComponent)
//   /demo/sqlite/<id>/table/<name>    rows + record view (edit / delete)
//
// Large-dataset confirmation: Continue → progress → tables; Cancel → /demo/sqlite.
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
  type ViewWillEnter,
} from '@ionic/angular';
import { map } from 'rxjs';
import { OvdbDatabaseBrowserComponent } from '../../ovdb/ovdb-database-browser.component';
import {
  demoSqliteCatalog,
  demoSqliteDatasetIds,
  demoSqliteStorageBytes,
  findDemoSqliteDataset,
  formatMegabytes,
  type DemoSqliteCatalogEntry,
} from '../../queries/demo-sqlite-catalog';
import type { DemoDbInstallStep } from '../../demo-sqlite/local-demodb-progress';
import { LocalDemoDbService, type LocalDemoDbSession, type LocalDemoDbState } from '../../demo-sqlite/local-demodb.service';

const persistenceNotice = 'Changes will not be saved in this browser: this window cannot keep a local copy (for example a private window), so edits are lost when you reload.';

const installLabels: Record<DemoDbInstallStep, string> = {
  verify: 'Verifying the download…',
  importPristine: 'Saving the original copy…',
  importWorking: 'Saving your editable copy…',
  open: 'Opening the local copy…',
};

@Component({
  selector: 'sneat-datatug-demo-sqlite-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ProjectCopyOfferComponent,
    NgTemplateOutlet,
    RouterLink,
    IonBackButton,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonList,
    IonMenuButton,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
    OvdbDatabaseBrowserComponent,
  ],
  styles: `
    .demo-sqlite-progress { width: 100%; height: 8px; accent-color: var(--ion-color-primary); }
  `,
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-menu-button />
          <ion-back-button [defaultHref]="backHref()" />
        </ion-buttons>
        <ion-title>{{ entry() ? entry()!.title + ' · local SQLite' : 'DemoDB in DataTug' }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content color="light">
      @if (!entry()) {
        <ion-card data-testid="demo-sqlite-datasets">
          <ion-card-header>
            <ion-card-title>{{ datasetParam() ? 'There is no DemoDB dataset “' + datasetParam() + '”' : 'Explore a DemoDB dataset' }}</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <p>Open a sample database as an editable SQLite copy in this browser. No sign-in needed.</p>
          </ion-card-content>
          <ng-container *ngTemplateOutlet="datasetList; context: { $implicit: allDatasets }" />
        </ion-card>
      } @else {
        @switch (state().kind) {
          @case ('checking') {
            <ion-card><ion-item><ion-spinner slot="start" /><ion-label>Checking the local copy…</ion-label></ion-item></ion-card>
          }
          @case ('confirm-large') {
            <ion-card data-testid="demo-sqlite-confirm-large">
              <ion-card-header><ion-card-title>Download {{ entry()!.title }}?</ion-card-title></ion-card-header>
              <ion-card-content>
                <p data-testid="demo-sqlite-confirm-figures">
                  This dataset downloads ~{{ mb(entry()!.transferBytes) }} (compressed in transit; {{ mb(entry()!.bytes) }} once unpacked)
                  and uses ~{{ mb(storageBytes()) }} of browser storage
                  @if (singleCopy()) {
                    (one working copy). Reset Database downloads it again, so resetting needs a network connection.
                  } @else {
                    (working copy + pristine copy).
                  }
                  Continue?
                </p>
                <ion-button data-testid="demo-sqlite-continue" (click)="continueDownload()">Continue</ion-button>
                <ion-button data-testid="demo-sqlite-cancel" fill="clear" routerLink="/demo/sqlite">Cancel</ion-button>
              </ion-card-content>
            </ion-card>
          }
          @case ('insufficient-storage') {
            <ion-card data-testid="demo-sqlite-no-storage">
              <ion-card-header><ion-card-title>Not enough browser storage for this dataset</ion-card-title></ion-card-header>
              <ion-card-content>
                <p>{{ entry()!.title }} needs ~{{ mb(storageBytes()) }}; this browser has ~{{ mb(availableBytes()) }} available for this site. Free space or try a smaller dataset:</p>
              </ion-card-content>
              <ng-container *ngTemplateOutlet="datasetList; context: { $implicit: otherDatasets() }" />
            </ion-card>
          }
          @case ('unsupported-browser') {
            <ion-card data-testid="demo-sqlite-unsupported">
              <ion-card-header><ion-card-title>{{ entry()!.title }} cannot open here</ion-card-title></ion-card-header>
              <ion-card-content><p role="alert">{{ stateMessage() }}</p></ion-card-content>
              <ng-container *ngTemplateOutlet="datasetList; context: { $implicit: otherDatasets() }" />
            </ion-card>
          }
          @case ('loading') {
            @if (progress(); as p) {
              <ion-card data-testid="demo-sqlite-progress">
                <ion-card-header><ion-card-title>Preparing local copy ({{ mb(entry()!.bytes) }})</ion-card-title></ion-card-header>
                <ion-card-content>
                  <p role="status">{{ p.label }}</p>
                  <!-- A native progress bar: no value means indeterminate. -->
                  @if (p.value !== undefined) {
                    <progress class="demo-sqlite-progress" max="1" [value]="p.value"></progress>
                  } @else {
                    <progress class="demo-sqlite-progress"></progress>
                  }
                </ion-card-content>
              </ion-card>
            }
          }
          @case ('locked-retry') {
            <ion-card data-testid="demo-sqlite-locked">
              <ion-card-content>
                <p role="alert">{{ stateMessage() }}</p>
                <ion-button data-testid="demo-sqlite-retry" (click)="retry()">Try again</ion-button>
              </ion-card-content>
            </ion-card>
          }
          @case ('failed') {
            <ion-card data-testid="demo-sqlite-failed">
              <ion-card-content>
                <p role="alert">{{ stateMessage() }}</p>
                <ion-button data-testid="demo-sqlite-retry" (click)="retry()">Try again</ion-button>
              </ion-card-content>
              @if (storageFailure()) {
                <ng-container *ngTemplateOutlet="datasetList; context: { $implicit: otherDatasets() }" />
              }
            </ion-card>
          }
          @case ('ready') {
            @if (replacedNotice()) {
              <ion-card color="warning" data-testid="demo-sqlite-replaced">
                <ion-item lines="none" color="warning">
                  <ion-label class="ion-text-wrap">Demo DB updated; your local edits were reset.</ion-label>
                  <ion-button slot="end" fill="clear" (click)="replacedNotice.set(false)">Dismiss</ion-button>
                </ion-item>
              </ion-card>
            }
            @if (!persistent()) {
              <ion-card color="warning" data-testid="demo-sqlite-not-persistent">
                <ion-card-content role="status">{{ persistenceNotice }}</ion-card-content>
              </ion-card>
            }
            <sneat-datatug-project-copy-offer [dataset]="datasetParam()" [table]="tableParam() || undefined" />
            @if (session()?.connection(); as connection) {
              <ion-button data-testid="demo-sqlite-close" fill="clear" (click)="closeCopy()">Close local runtime</ion-button>
              <sneat-datatug-ovdb-database-browser
                [connection]="connection"
                [basePath]="basePath()"
                [table]="tableParam()"
                [statusText]="persistent() ? 'Local copy ready' : 'Local copy (memory only)'"
                [resetNote]="resetNote()"
              />
            }
          }
        }
      }

      <ng-template #datasetList let-datasets>
        <ion-list lines="full">
          @for (dataset of datasets; track dataset.dataset) {
            <ion-item [routerLink]="['/demo', 'sqlite', dataset.dataset]" [attr.data-testid]="'dataset-' + dataset.dataset">
              <ion-label>{{ dataset.title }}</ion-label>
              <ion-note slot="end">{{ mb(dataset.bytes) }}</ion-note>
            </ion-item>
          }
        </ion-list>
      </ng-template>
    </ion-content>
  `,
})
export class DemoSqlitePageComponent implements ViewWillEnter {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(LocalDemoDbService);

  protected readonly persistenceNotice = persistenceNotice;
  private readonly browser = viewChild(OvdbDatabaseBrowserComponent);
  #entered = false;
  protected readonly allDatasets = demoSqliteDatasetIds.map((id) => demoSqliteCatalog[id]);
  protected readonly datasetParam = toSignal(this.route.paramMap.pipe(map((params) => params.get('dataset') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('dataset') ?? '',
  });
  protected readonly tableParam = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('table') ?? undefined)),
    { initialValue: this.route.snapshot.paramMap.get('table') ?? undefined },
  );
  protected readonly entry = computed<DemoSqliteCatalogEntry | undefined>(() => findDemoSqliteDataset(this.datasetParam()));
  protected readonly session = signal<LocalDemoDbSession | undefined>(undefined);
  protected readonly state = computed<LocalDemoDbState>(() => this.session()?.state() ?? { kind: 'checking' });
  protected readonly basePath = computed(() => ['/demo', 'sqlite', this.entry()?.dataset ?? '']);
  protected readonly backHref = computed(() => {
    const entry = this.entry();
    return entry && this.tableParam() ? `/demo/sqlite/${entry.dataset}` : '/demo/sqlite';
  });
  protected readonly otherDatasets = computed(() => this.allDatasets.filter((d) => d.dataset !== this.entry()?.dataset));
  protected readonly storageBytes = computed(() => {
    const entry = this.entry();
    return entry ? demoSqliteStorageBytes(entry) : 0;
  });
  protected readonly singleCopy = computed(() => this.entry()?.storagePolicy === 'single-copy');
  /** Added to the Reset confirmation: a single-copy dataset has no stored original, so reset downloads it. */
  protected readonly resetNote = computed(() => {
    const entry = this.entry();
    return entry && this.singleCopy()
      ? `Resetting downloads the original data again (~${formatMegabytes(entry.transferBytes)}), so it needs a network connection.`
      : '';
  });
  protected readonly availableBytes = computed(() => {
    const state = this.state();
    return state.kind === 'insufficient-storage' ? state.availableBytes : 0;
  });
  protected readonly stateMessage = computed(() => {
    const state = this.state();
    return 'message' in state ? state.message : '';
  });
  protected readonly storageFailure = computed(() => {
    const state = this.state();
    return state.kind === 'failed' && state.storage;
  });
  protected readonly persistent = computed(() => {
    const state = this.state();
    return state.kind !== 'ready' || state.persistent;
  });
  protected readonly replacedNotice = signal(false);
  protected readonly progress = computed<{ label: string; value?: number } | undefined>(() => {
    const state = this.state();
    if (state.kind !== 'loading' || !state.showProgress) return undefined;
    switch (state.phase) {
      case 'opening':
        return { label: 'Opening the local copy…' };
      case 'download':
        // A file dataset counts decoded (unpacked) bytes, so it differs from the compressed transfer size
        // shown in the confirmation; a chunked dataset counts the compressed parts.
        return {
          label: `Downloading ${(state.loaded / 1_000_000).toFixed(1)} of ${this.mb(state.total)}${
            this.entry()?.source === 'chunked' ? '' : ' (unpacked size)'}`,
          value: state.total ? Math.min(1, state.loaded / state.total) : undefined,
        };
      case 'install':
        return { label: installLabels[state.step ?? 'verify'] };
    }
  });

  constructor() {
    // One session per dataset; changing only the table keeps it.
    effect(() => {
      const entry = this.entry();
      untracked(() => {
        const current = this.session();
        if (current?.entry.dataset === entry?.dataset) return;
        if (current) this.service.close(current.entry.dataset);
        const next = entry ? this.service.open(entry.dataset) : undefined;
        this.session.set(next);
        void next?.start();
      });
    });
    effect(() => {
      const state = this.state();
      if (state.kind === 'ready' && state.replacedPreviousVersion) untracked(() => this.replacedNotice.set(true));
    });
  }

  /**
   * Ionic keeps a page of the navigation stack alive and goes back to it when its address is visited again
   * (list → table). Its rows may be old by then (another tab may have edited them), so they are read again.
   */
  ionViewWillEnter(): void {
    if (!this.#entered) {
      this.#entered = true;
      return;
    }
    void this.browser()?.reload();
  }

  protected mb(bytes: number): string {
    return formatMegabytes(bytes);
  }

  continueDownload(): Promise<void> {
    return this.session()?.confirmDownload() ?? Promise.resolve();
  }

  retry(): Promise<void> {
    return this.session()?.retry() ?? Promise.resolve();
  }

  closeCopy(): void {
    const current = this.session();
    if (!current) return;
    this.service.close(current.entry.dataset);
    this.session.set(undefined);
    void this.router.navigateByUrl('/demo/sqlite');
  }
}
