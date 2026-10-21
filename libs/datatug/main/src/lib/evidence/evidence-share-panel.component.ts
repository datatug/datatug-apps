import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonButton, IonSelect, IonSelectOption } from '@ionic/angular';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { DetectiveClientService } from '../detective/detective-client.service';
import { useDetectivePageContext } from '../detective/detective-page-context';
import { HostedIncidentView } from '../detective/hosted-linkage.models';
import { AppliedEvidenceChoice } from './applied-evidence';
import { AppliedEvidenceSelectorComponent } from './applied-evidence-selector.component';
export interface EvidenceShareSelection {
  readonly identity: string;
  readonly environment: string;
  readonly choice: AppliedEvidenceChoice;
}
@Component({
  selector: 'sneat-datatug-evidence-share-panel',
  imports: [
    IonButton,
    IonSelect,
    IonSelectOption,
    AppliedEvidenceSelectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (page.context()?.kind === 'cloud') {
    <section aria-label="Optional Incident evidence sharing">
      <h3>Retain and attach this run</h3>
      <p>
        Ordinary Run does not share with an Incident. Select an existing
        Incident and applied revision to explicitly retain the executed inputs
        and result for current project contacts.
      </p>
      <ion-button
        fill="outline"
        (click)="loadIncidents()"
        [disabled]="disabled() || loading() || !environment()"
        >Choose Incident for evidence</ion-button
      >
      <ion-select
        label="Evidence Incident"
        [value]="incidentRef()"
        (ionChange)="chooseIncident($event.detail.value)"
        [disabled]="disabled() || loading()"
      >
        <ion-select-option value="">Do not share</ion-select-option>
        @for (item of incidents(); track item.ref.incidentId) {
          <ion-select-option [value]="ref(item)"
            >{{ item.ref.incidentId }} · {{ item.title }}</ion-select-option
          >
        }
      </ion-select>
      @if (incidentRef()) {
        <sneat-datatug-applied-evidence-selector
          [projectRef]="page.ref()"
          [actor]="actor()"
          [environment]="environment()"
          [incidentRef]="incidentRef()"
          [caseId]="caseId()"
          [disabled]="disabled()"
          (selected)="chooseContext($event)"
        />
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
    </section>
  }`,
})
export class EvidenceSharePanelComponent {
  readonly environment = input('');
  readonly caseId = input<string>();
  readonly disabled = input(false);
  readonly selected = output<EvidenceShareSelection | undefined>();
  protected readonly page = useDetectivePageContext();
  protected readonly actor = computed(
    () => this.page.context()?.principal || '',
  );
  protected readonly incidents = signal<readonly HostedIncidentView[]>([]);
  protected readonly incidentRef = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private readonly api = inject(DetectiveClientService);
  private readonly destroy = inject(DestroyRef);
  private lifetime = new AbortController();
  constructor() {
    effect(() => {
      this.environment();
      this.caseId();
      this.clear();
    });
    this.page.scopeChanges$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.clear());
    this.destroy.onDestroy(() => this.lifetime.abort());
  }
  protected ref(item: HostedIncidentView) {
    return `${item.ref.storeId}/${item.ref.incidentId}`;
  }
  private clear() {
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.incidents.set([]);
    this.incidentRef.set('');
    this.selected.emit(undefined);
    this.loading.set(false);
    this.error.set('');
  }
  protected chooseIncident(value: string) {
    if (this.disabled()) return;
    this.incidentRef.set(
      this.incidents().some((item) => this.ref(item) === value) ? value : '',
    );
    this.selected.emit(undefined);
  }
  protected chooseContext(choice: AppliedEvidenceChoice | undefined) {
    const identity = this.page.identity();
    this.selected.emit(
      choice && identity
        ? { identity, environment: this.environment(), choice }
        : undefined,
    );
  }
  protected async loadIncidents() {
    const context = this.page.context(),
      environment = this.environment(),
      identity = this.page.identity();
    if (
      context?.kind !== 'cloud' ||
      !identity ||
      !environment ||
      this.disabled()
    )
      return;
    this.clear();
    const signal = this.lifetime.signal;
    this.loading.set(true);
    try {
      const response = await firstValueFrom(
        this.api
          .projectIncidents(context, environment)
          .pipe(takeUntil(fromEvent(signal, 'abort'))),
      );
      if (
        signal.aborted ||
        identity !== this.page.identity() ||
        environment !== this.environment()
      )
        return;
      this.incidents.set(response.incidents);
    } catch {
      if (!signal.aborted)
        this.error.set(
          'Current Incidents are unavailable. No sharing target was selected.',
        );
    } finally {
      if (!signal.aborted) this.loading.set(false);
    }
  }
}
