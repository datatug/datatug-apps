import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SneatUserService } from '@sneat/auth-core';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';
import { firstValueFrom } from 'rxjs';
import { LocalDemoDbService, type LocalDemoDbSession } from '../../demo-sqlite/local-demodb.service';
import { OvdbDatabaseBrowserComponent } from '../../ovdb/ovdb-database-browser.component';
import { ovdbCollections } from '../../ovdb/ovdb-connection';
import { DemoProjectContinuationService, matchingDemoConnection } from '../../project/new-project/demo-project-continuation.service';
import { ProjectQueryApiService } from '../../services/project/project-query-api.service';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { projectPageHref } from '../../nav/project-page-href';
import { equalProjectRef } from '../../core/project-context';
import type { QueryConnectionDescriptor } from '../../queries/query-dispatch';
import { QueryRuntimeRegistry } from '../../queries/query-runtime-registry.service';
import { DemoTableDraftService } from '../../queries/demo-table-draft.service';

addIcons({ arrowBackOutline });

@Component({
  selector: 'sneat-datatug-project-browser-db',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, RouterLink, OvdbDatabaseBrowserComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        @if (table()) {
          <ion-buttons slot="start">
            <ion-button class="page-back-link" data-testid="back-to-tables" aria-label="All tables" [routerLink]="basePath()" [queryParams]="navigationQuery()" routerDirection="back">
              <ion-icon slot="start" name="arrow-back-outline" />
              All tables
            </ion-button>
          </ion-buttons>
        }
        <ion-title>My browser database</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <p data-testid="project-browser-ownership">Project files in GitHub; database and edits in this browser</p>
      @if (loading()) { <p role="status">Checking this project's database connection…</p> }
      @if (error() || (!loading() && !connection())) {
        <p role="alert" data-testid="project-browser-recovery">{{ error() || 'The edited browser database is no longer active. Return to the demo and explicitly reopen your local copy; a new memory-only copy cannot recover lost edits.' }}</p>
        <ion-button (click)="load()" fill="outline">Retry connection check</ion-button>
        <ion-button [routerLink]="['/demo', 'sqlite', dataset()]">Return to demo</ion-button>
      }
      @if (connection(); as connection) {
        @if (table()) { <ion-button data-testid="project-browser-query" (click)="queryTable()">Query this table</ion-button> }
        <sneat-datatug-ovdb-database-browser [connection]="connection" [basePath]="basePath()" [table]="table()" [navigationQuery]="navigationQuery()" statusText="Edited browser copy" />
      }
    </ion-content>
  `,
})
export class ProjectBrowserDbComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly db = inject(LocalDemoDbService);
  private readonly continuation = inject(DemoProjectContinuationService);
  private readonly api = inject(ProjectQueryApiService);
  private readonly runtimes = inject(QueryRuntimeRegistry);
  private readonly drafts = inject(DemoTableDraftService);
  private readonly project = toSignal(inject(DatatugNavContextService).currentProject);
  private readonly user = toSignal(inject(SneatUserService).userState);
  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly session = signal<LocalDemoDbSession | undefined>(undefined);
  private readonly declaration = signal<QueryConnectionDescriptor | undefined>(undefined);
  private generation = 0;
  readonly loading = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly dataset = signal('');
  readonly table = computed(() => this.params().get('table') ?? undefined);
  readonly connection = computed(() => {
    const session = this.session();
    if (this.loading() || this.error() || session?.state().kind !== 'ready') return undefined;
    const connection = session.connection();
    return connection?.descriptor.canonical?.sha256 === this.declaration()?.fixtureSha256 ? connection : undefined;
  });
  readonly basePath = computed(() => {
    const ref = this.project()?.ref;
    if (!ref) return [];
    // RouterLink receives the helper's exact project path as its first command.
    return [projectPageHref(ref, ['browser-db', this.declaration()?.id ?? 'demo']).split('?')[0]];
  });
  readonly navigationQuery = computed(() => ({ projectApi: this.project()?.ref.projectApi, branch: this.project()?.ref.branch, demoContinuation: this.query().get('demoContinuation') }));
  constructor() {
    effect(() => { this.project(); this.user(); this.query(); this.params(); void this.load(); });
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    const ref = this.project()?.ref;
    const actor = this.user()?.user?.uid;
    const token = this.query().get('demoContinuation') ?? undefined;
    const intent = this.continuation.read(token);
    this.session.set(undefined); this.declaration.set(undefined); this.error.set(undefined);
    if (!ref || !actor) { this.loading.set(false); return; }
    this.dataset.set(intent?.dataset ?? '');
    this.loading.set(true);
    try {
      if (!intent || intent.actorID !== actor || !equalProjectRef(intent.destination, ref)) throw new Error('This browser continuation is missing or belongs to another account or project. Return to the demo to keep exploring.');
      const catalog = await firstValueFrom(this.api.connectionCatalog<{ connections: readonly QueryConnectionDescriptor[] }>(ref));
      const declaration = matchingDemoConnection(intent, catalog.connections ?? []);
      const requested = this.params().get('connectionId');
      if (requested !== 'demo' && requested !== declaration.id) throw new Error('The database link and copied project connection disagree. Return to the demo.');
      const session = this.db.peek(intent.dataset);
      if (!session || session.state().kind !== 'ready') throw new Error('The edited browser database is no longer active. Return to the demo to reopen your local copy explicitly. Memory-only edits cannot survive a browser reload.');
      const connection = session.connection();
      if (connection?.descriptor.canonical?.sha256 !== intent.canonicalSha256) throw new Error('The browser database version changed. Your copied project cannot use a different version silently. Return to the demo to inspect it.');
      const table = this.table() ?? intent.table;
      if (table && !ovdbCollections(connection.descriptor).includes(table)) throw new Error('The selected table is absent from this edited database. Return to the demo to select another table.');
      if (generation !== this.generation) return;
      this.session.set(session); this.declaration.set(declaration);
      if (requested === 'demo') {
        const path = projectPageHref(ref, ['browser-db', declaration.id as string, ...(table ? ['table', table] : [])]);
        const tree = this.router.parseUrl(path); tree.queryParams = { projectApi: ref.projectApi, branch: ref.branch, demoContinuation: token };
        void this.router.navigateByUrl(tree, { replaceUrl: true });
      }
    } catch (error) {
      if (generation === this.generation) this.error.set(error instanceof Error ? error.message : 'The copied project connection could not be checked. Retry when access is available.');
    } finally { if (generation === this.generation) this.loading.set(false); }
  }
  queryTable(): void {
    const ref = this.project()?.ref, declaration = this.declaration(), connection = this.connection(), table = this.table();
    if (!ref || !declaration || !connection || !table) return;
    const runtime = this.runtimes.candidates(declaration).find(r => r.connection.fetch === connection.fetch);
    const environments = declaration.environment ? [declaration.environment] : declaration.environments ?? [];
    if (!runtime || environments.length !== 1) { this.error.set('This database needs one declared environment and an active browser runtime before Query can open.'); return; }
    const token = this.drafts.create({ actorID: this.user()?.user?.uid ?? '', projectRef: ref, connection: declaration, table, runtimeSelectionId: runtime.selectionId, environment: environments[0] });
    const tree = this.router.parseUrl(projectPageHref(ref, 'query'));
    tree.queryParams = { projectApi: ref.projectApi, branch: ref.branch, demoDraft: token, runtime: runtime.selectionId, env: environments[0] };
    void this.router.navigateByUrl(tree);
  }
}
