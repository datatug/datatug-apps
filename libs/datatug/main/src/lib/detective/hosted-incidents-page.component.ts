import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { firstValueFrom, Observable } from 'rxjs';
import { projectPageHref } from '../nav/project-page-href';
import {
  DetectiveClientService,
  detectiveErrorMessage,
  detectiveOperationId,
} from './detective-client.service';
import { useDetectivePageContext } from './detective-page-context';
import {
  HostedIncidentView,
  HostedIncidentAction,
  HostedProjectIncident,
  HostedProjectIncidents,
} from './hosted-linkage.models';
import { DetectiveCase, DetectiveState } from './models';

/** A private, hosted Incident workflow. Agent incident pages keep their own route family. */
@Component({
  selector: 'sneat-datatug-hosted-incidents-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonMenuButton,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-menu-button />
          <ion-back-button [defaultHref]="listHref()" />
        </ion-buttons>
        <ion-title>Incidents</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content color="light">
      <main class="detective-page">
        @if (scope.unsupported() || scope.context()?.kind === 'agent') {
          <p role="status">Hosted Incidents need a private Space project.</p>
        } @else if (!scope.context()) {
          <p role="status">Connecting to your project…</p>
        } @else {
          @if (scopeError()) {
            <p role="alert">{{ scopeError() }}</p>
            <ion-button (click)="reloadScope()">Retry</ion-button>
            <ion-button fill="clear" [routerLink]="listHref()">Open Incidents list</ion-button>
          } @else if (scopeLoading()) {
            <p role="status"><ion-spinner name="dots" /> Loading project environments…</p>
          } @else {
            <ion-item>
              <ion-label>Environment</ion-label>
              <ion-select aria-label="Incident environment" [value]="environment()" [disabled]="busy()"
                (ionChange)="selectEnvironment($event.detail.value)">
                @for (name of environments(); track name) {
                  <ion-select-option [value]="name">{{ name }}</ion-select-option>
                }
              </ion-select>
            </ion-item>
            @if (mode() === 'list') {
              <h1>Incidents</h1>
              <p>Saved incidents in this private project and environment.</p>
              @if (canWrite()) {
                <ion-button [routerLink]="newHref()" [queryParams]="environmentQuery()">
                  Create Incident
                </ion-button>
              } @else {
                <p role="status">You can view Incidents in this project, but cannot create them.</p>
              }
              @if (loading()) {
                <p role="status"><ion-spinner name="dots" /> Loading Incidents…</p>
              } @else if (loadError()) {
                <p role="alert">{{ loadError() }}</p>
                <ion-button (click)="retryLoad()">Retry</ion-button>
              } @else if (incidents(); as items) {
                @if (items.length) {
                  <ion-list aria-label="Project Incidents">
                    @for (item of items; track item.ref.storeId + '/' + item.ref.incidentId) {
                      <ion-item button detail [routerLink]="detailHref(item)"
                        [queryParams]="environmentQuery()">
                        <ion-label><h2>{{ item.title }}</h2><p>{{ item.status }}</p></ion-label>
                      </ion-item>
                    }
                  </ion-list>
                } @else {
                  <p role="status">No Incidents yet. Create one to record the problem first.</p>
                }
              }
            } @else if (mode() === 'new') {
              <h1>New Incident</h1>
              <p>Record the problem now. A Detective Case can be started later.</p>
              <ion-item>
                <ion-label position="stacked">Title</ion-label>
                <ion-input aria-label="Incident title" [value]="title()"
                  (ionInput)="title.set($event.detail.value || '')" />
              </ion-item>
              <ion-item>
                <ion-label position="stacked">Description</ion-label>
                <ion-textarea aria-label="Incident description" [value]="description()"
                  (ionInput)="description.set($event.detail.value || '')" />
              </ion-item>
              <ion-item>
                <ion-label position="stacked">Order ID (number, optional)</ion-label>
                <ion-input aria-label="Order ID" type="number" inputmode="numeric"
                  [value]="orderId()" (ionInput)="orderId.set($event.detail.value || '')" />
              </ion-item>
              <p>Order ID is saved as structured context. Other details remain in the description.</p>
              @if (!canWrite()) {
                <p role="status">You can view Incidents in this project, but cannot create them.</p>
              }
              @if (saveError()) { <p role="alert">{{ saveError() }}</p> }
              @if (savedIncident(); as saved) {
                <p role="status">Incident saved. Open its detail to continue.</p>
                <ion-button (click)="openSavedIncident()">Open saved Incident</ion-button>
              } @else {
              <ion-button (click)="create()" [disabled]="!canWrite() || busy() || !title().trim() || !environment()">
                @if (busy()) { <ion-spinner slot="start" name="dots" /> }
                Save Incident
              </ion-button>
              }
              <ion-button fill="clear" [routerLink]="listHref()"
                [queryParams]="environmentQuery()">Cancel</ion-button>
            } @else {
              @if (loading()) {
                <p role="status"><ion-spinner name="dots" /> Loading Incident…</p>
              } @else if (loadError()) {
                <p role="alert">{{ loadError() }}</p>
                <ion-button (click)="retryLoad()">Retry</ion-button>
              } @else if (incident(); as item) {
                <h1>{{ item.title }}</h1>
                <p>Incident {{ item.ref.storeId }}/{{ item.ref.incidentId }} · {{ item.status }}</p>
                @if (item.description) { <p>{{ item.description }}</p> }
                <h2>Investigation</h2>
                @if (linkedCases().length) {
                  <ion-list aria-label="Linked Detective Cases">
                    @for (linked of linkedCases(); track linked.id) {
                      <ion-item button detail [routerLink]="caseHref(linked.id)">
                        <ion-label><h3>{{ linked.title }}</h3><p>Detective Case {{ linked.id }}</p></ion-label>
                      </ion-item>
                    }
                  </ion-list>
                } @else {
                  <p>No Detective Case has been started for this Incident.</p>
                }
                @if (saveError()) { <p role="alert">{{ saveError() }}</p> }
                @if (!canWrite()) {
                  <p role="status">You can view this Incident, but cannot start a Detective Case in this project.</p>
                }
                @if (savedCase(); as saved) {
                  <p role="status">Detective Case {{ saved.id }} saved for this Incident.</p>
                  <ion-button (click)="openSavedCase()">Open saved Detective Case</ion-button>
                } @else {
                <ion-button (click)="startCase()" [disabled]="!canWrite() || busy()">
                  @if (busy()) { <ion-spinner slot="start" name="dots" /> }
                  Investigate in a Detective Case
                </ion-button>
                }
                <ion-button fill="clear" [routerLink]="listHref()"
                  [queryParams]="environmentQuery()">Back to Incidents</ion-button>
              }
            }
          }
        }
      </main>
    </ion-content>
  `,
  styleUrl: './detective-pages.scss',
})
export class HostedIncidentsPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly client = inject(DetectiveClientService);
  protected readonly scope = useDetectivePageContext();
  private readonly routeData = toSignal(this.route.data, { initialValue: this.route.snapshot.data });
  private readonly routeParams = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  private readonly routeQuery = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected readonly mode = computed(() => this.routeData()['incidentMode'] as 'list' | 'new' | 'detail');
  protected readonly environments = signal<string[]>([]);
  protected readonly environment = signal('');
  protected readonly scopeLoading = signal(false);
  protected readonly scopeError = signal('');
  protected readonly loading = signal(false);
  protected readonly loadError = signal('');
  protected readonly incidents = signal<HostedIncidentView[] | undefined>(undefined);
  protected readonly incident = signal<HostedIncidentView | undefined>(undefined);
  protected readonly state = signal<DetectiveState | undefined>(undefined);
  protected readonly canWrite = computed(() => this.state()?.capabilities?.canWrite === true);
  protected readonly linkedCases = computed(() => {
    const item = this.incident();
    const ref = item && `${item.ref.storeId}/${item.ref.incidentId}`;
    return ref ? (this.state()?.cases || []).filter((entry) => entry.incidentRefs.includes(ref)) : [];
  });
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly orderId = signal('');
  protected readonly busy = signal(false);
  protected readonly saveError = signal('');
  protected readonly savedIncident = signal<{ href: string; environment: string } | undefined>(undefined);
  protected readonly savedCase = signal<{ id: string; href: string } | undefined>(undefined);
  private readonly reloadKey = signal(0);
  private readonly scopeKey = signal(0);
  private pendingCreate?: { key: string; operationId: string };
  private pendingCaseDraft?: { key: string; draft: { id: string; title: string; operationId: string } };
  private activeRecordIdentity?: string;

  private readonly loadScope = effect((onCleanup) => {
    this.scopeKey();
    const context = this.scope.context();
    const identity = this.scope.identity();
    const requested = this.routeQuery().get('environment');
    if (!context || context.kind !== 'cloud' || !identity) return;
    let cancelled = false;
    this.environment.set('');
    this.state.set(undefined);
    this.environments.set([]);
    this.scopeLoading.set(true);
    this.scopeError.set('');
    firstValueFrom(this.client.state(context)).then((state) => {
      if (cancelled) return;
      this.state.set(state);
      const environments = state.environments || [];
      this.environments.set(environments);
      if (requested && !environments.includes(requested)) {
        this.scopeError.set(`Environment ${requested} is unavailable in this project. Open the Incidents list and choose an available environment.`);
      } else {
        this.environment.set(requested || environments[0] || '');
      }
      if (!environments.length) this.scopeError.set('This project has no Incident environment.');
    }).catch((error) => {
      if (!cancelled) this.scopeError.set(detectiveErrorMessage(error, true));
    }).finally(() => { if (!cancelled) this.scopeLoading.set(false); });
    onCleanup(() => { cancelled = true; });
  });

  private readonly loadRecord = effect((onCleanup) => {
    this.reloadKey();
    const context = this.scope.context();
    const environment = this.environment();
    const mode = this.mode();
    const incidentId = this.routeParams().get('incidentId');
    const incidentStoreId = this.routeParams().get('incidentStoreId');
    const recordIdentity = JSON.stringify([this.scope.identity(), mode, environment, incidentStoreId, incidentId]);
    if (recordIdentity !== this.activeRecordIdentity) {
      this.activeRecordIdentity = recordIdentity;
      this.incident.set(undefined);
      this.incidents.set(undefined);
      this.savedCase.set(undefined);
      this.savedIncident.set(undefined);
      this.pendingCreate = undefined;
      this.pendingCaseDraft = undefined;
    }
    if (!context || context.kind !== 'cloud' || !environment || mode === 'new') return;
    let cancelled = false;
    this.loading.set(true);
    this.loadError.set('');
    const request: Observable<HostedProjectIncidents | HostedProjectIncident> = mode === 'list'
      ? this.client.projectIncidents(context, environment)
      : this.client.projectIncident(context, environment, `${incidentStoreId || ''}/${incidentId || ''}`);
    firstValueFrom(request).then((response) => {
      if (cancelled) return;
      if ('incidents' in response) this.incidents.set(response.incidents);
      else this.incident.set(response.incident);
    }).catch((error) => {
      if (!cancelled) this.loadError.set(detectiveErrorMessage(error, true));
    }).finally(() => { if (!cancelled) this.loading.set(false); });
    onCleanup(() => { cancelled = true; });
  });

  protected listHref(): string { return projectPageHref(this.scope.ref(), 'incidents'); }
  protected newHref(): string { return projectPageHref(this.scope.ref(), 'incidents/new'); }
  protected detailHref(item: HostedIncidentView): string {
    return projectPageHref(this.scope.ref(), ['incidents', item.ref.storeId, item.ref.incidentId]);
  }
  protected caseHref(id: string): string {
    return projectPageHref(this.scope.ref(), ['detective', id]);
  }
  protected environmentQuery() { return { environment: this.environment() }; }
  protected selectEnvironment(value: string): void {
    if (this.busy() || !this.environments().includes(value)) return;
    this.environment.set(value);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { environment: value },
      replaceUrl: true,
    });
  }
  protected retryLoad(): void { this.reloadKey.update((key) => key + 1); }
  protected reloadScope(): void { this.scopeKey.update((key) => key + 1); }
  ionViewWillEnter(): void { this.reloadScope(); }

  protected async create(): Promise<void> {
    const context = this.scope.context();
    const title = this.title().trim();
    const environment = this.environment();
    if (!context || context.kind !== 'cloud' || !this.canWrite() || !title || !environment || this.busy() || this.savedIncident()) return;
    const identity = this.scope.identity();
    const projectRef = this.scope.ref();
    const rawOrder = this.orderId().trim();
    if (rawOrder && (!/^\d+$/.test(rawOrder) || !Number.isSafeInteger(Number(rawOrder)))) {
      this.saveError.set('Order ID must be a whole number.');
      return;
    }
    this.busy.set(true);
    this.saveError.set('');
    try {
      const action: HostedIncidentAction = {
        type: 'create', title, description: this.description().trim(), environment,
        ...(rawOrder ? { context: { OrderID: { type: 'number', value: Number(rawOrder) } } } : {}),
      };
      // Keep an ambiguous create's server operation ID across a page reload. The key is a
      // digest of the exact request and authenticated scope; no Incident text is stored.
      const retryKey = await this.retryKey('incident-create', identity, action);
      let operationId = this.pendingCreate?.key === retryKey
        ? this.pendingCreate.operationId : detectiveOperationId();
      try {
        const pending = sessionStorage.getItem(retryKey);
        if (pending?.startsWith('operation-')) operationId = pending;
        else sessionStorage.setItem(retryKey, operationId);
      } catch { /* Session storage can be disabled; in-memory retries still work. */ }
      this.pendingCreate = { key: retryKey, operationId };
      if (this.destroyRef.destroyed || this.scope.identity() !== identity || this.environment() !== environment) return;
      const result = await firstValueFrom(this.client.incidentAction(context, action, operationId));
      const item = result.incident;
      if (!item?.ref?.incidentId || !item.ref.storeId)
        throw new Error('The server did not return a hosted Incident reference.');
      try {
        if (sessionStorage.getItem(retryKey) === operationId) sessionStorage.removeItem(retryKey);
      } catch { /* Storage availability does not change a confirmed server response. */ }
      if (this.pendingCreate?.key === retryKey) this.pendingCreate = undefined;
      if (this.destroyRef.destroyed) return;
      const href = projectPageHref(projectRef, ['incidents', item.ref.storeId, item.ref.incidentId]);
      this.savedIncident.set({ href, environment });
      if (this.scope.identity() !== identity || this.environment() !== environment) {
        this.saveError.set('Incident saved in the earlier project or environment. Open the saved Incident to continue.');
        return;
      }
      await this.openSavedIncident();
    } catch (error) {
      if (!this.destroyRef.destroyed) this.saveError.set(detectiveErrorMessage(error, true));
    } finally { this.busy.set(false); }
  }

  protected async openSavedIncident(): Promise<void> {
    const saved = this.savedIncident();
    if (!saved) return;
    try {
      if (!await this.router.navigate([saved.href], {
        queryParams: { environment: saved.environment }, replaceUrl: true,
      })) this.saveError.set('Incident saved, but navigation did not complete. Open the saved Incident to retry.');
    } catch {
      this.saveError.set('Incident saved, but navigation did not complete. Open the saved Incident to retry.');
    }
  }

  protected async startCase(): Promise<void> {
    const context = this.scope.context();
    const item = this.incident();
    const environment = this.environment();
    if (!context || context.kind !== 'cloud' || !this.canWrite() || !item || !environment || this.busy() || this.loading() || this.loadError() || this.savedCase()) return;
    if (`${item.ref.storeId}/${item.ref.incidentId}` !== `${this.routeParams().get('incidentStoreId')}/${this.routeParams().get('incidentId')}`) return;
    const identity = this.scope.identity();
    const projectRef = this.scope.ref();
    const incidentRef = `${item.ref.storeId}/${item.ref.incidentId}`;
    this.busy.set(true);
    this.saveError.set('');
    try {
      const retryKey = await this.retryKey('incident-start-case', identity, [environment, incidentRef]);
      let draft: { id: string; title: string; operationId: string } | undefined;
      try {
        const stored = sessionStorage.getItem(retryKey);
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (this.isCaseRetryDraft(parsed)) draft = parsed;
        }
      } catch { /* Session storage can be disabled or contain an invalid prior value. */ }
      draft ??= this.pendingCaseDraft?.key === retryKey ? this.pendingCaseDraft.draft : undefined;
      draft ??= {
        id: `incident-${crypto.randomUUID()}`,
        title: `Investigate ${item.title}`,
        operationId: detectiveOperationId(),
      };
      this.pendingCaseDraft = { key: retryKey, draft };
      try { sessionStorage.setItem(retryKey, JSON.stringify(draft)); } catch { /* In-memory retries remain available. */ }
      if (this.destroyRef.destroyed || this.scope.identity() !== identity || this.environment() !== environment) return;
      const newCase: DetectiveCase = {
        id: draft.id, title: draft.title, status: 'active', version: 0,
        context: {}, incidentRefs: [], scenarioRefs: [], runRefs: [],
        evidence: [], findings: [], timeline: [],
      };
      const response = await firstValueFrom(this.client.incidentAction(context, {
        type: 'start-case', incidentRef,
        environment, case: newCase, ifMatch: 0,
      }, draft.operationId));
      if (!response.case?.id) throw new Error('The server did not return the new Detective Case.');
      try {
        if (sessionStorage.getItem(retryKey) === JSON.stringify(draft)) sessionStorage.removeItem(retryKey);
      } catch { /* Storage availability does not change a confirmed server response. */ }
      if (this.pendingCaseDraft?.key === retryKey) this.pendingCaseDraft = undefined;
      if (this.destroyRef.destroyed) return;
      this.savedCase.set({ id: response.case.id, href: projectPageHref(projectRef, ['detective', response.case.id]) });
      if (this.scope.identity() !== identity || this.environment() !== environment) {
        this.saveError.set('Detective Case saved in the earlier project or environment. Open the saved Case to continue.');
        return;
      }
      await this.openSavedCase();
    } catch (error) {
      if (!this.destroyRef.destroyed) this.saveError.set(detectiveErrorMessage(error, true));
    } finally { this.busy.set(false); }
  }

  protected async openSavedCase(): Promise<void> {
    const saved = this.savedCase();
    if (!saved) return;
    try {
      if (!await this.router.navigateByUrl(saved.href))
        this.saveError.set('Detective Case saved, but navigation did not complete. Open the saved Case to retry.');
    } catch {
      this.saveError.set('Detective Case saved, but navigation did not complete. Open the saved Case to retry.');
    }
  }

  private async retryKey(kind: string, identity: string | undefined, payload: unknown): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([identity, payload])));
    return `datatug:${kind}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  private isCaseRetryDraft(value: unknown): value is { id: string; title: string; operationId: string } {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Record<string, unknown>;
    return typeof draft['id'] === 'string' && draft['id'].startsWith('incident-')
      && typeof draft['title'] === 'string' && draft['title'].startsWith('Investigate ')
      && typeof draft['operationId'] === 'string' && draft['operationId'].startsWith('operation-');
  }
}
