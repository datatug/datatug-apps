import { RouterLink } from '@angular/router';
import { nativeRecoveryHref } from './session-detective-recovery-link';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonInput,
} from '@ionic/angular';
import { IProjectRef } from '../core/project-context';
import { CheckDefinition, DetectiveInputValue } from '../detective/models';
import {
  displayInputValue,
  parseInputValue,
} from '../detective/detective-forms';
import {
  ContextEntryRef,
  contextScopeKey,
  sameContextScope,
} from './session-context-contract';
import { SessionWorkspaceService } from './session-workspace.service';
import { SessionDetectiveOperationService } from './session-detective-operation.service';

@Component({
  selector: 'sneat-session-detective-run',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    IonButton,
    IonItem,
    IonLabel,
    IonSelect,
    IonSelectOption,
    IonInput,
  ],
  providers: [SessionDetectiveOperationService],
  template: `
    <h2>Run Check with session inputs</h2>
    <p>
      Map each input explicitly to an applied or attached revision. Case
      defaults are resolved by the server; conflicting values are rejected.
    </p>
    @if (workspace.capabilities()?.nativeDetective !== true) {
      <ion-item
        ><ion-label
          >Native session Checks are not enabled by this server.</ion-label
        ></ion-item
      >
    }
    @if (!operation.draft()) {
      <ion-item
        ><ion-select
          label="Logical environment"
          aria-label="Native Check environment"
          [value]="environmentChoice() || environment()"
          (ionChange)="
            environmentChoice.set($event.detail.value);
            scopeKey.set('');
            mappings.set({})
          "
        >
          <ion-select-option value="">Choose environment</ion-select-option>
          @for (environment of environments(); track environment) {
            <ion-select-option [value]="environment">{{
              environment
            }}</ion-select-option>
          }
        </ion-select></ion-item
      >
      <ion-item
        ><ion-select
          label="Source identity domain"
          aria-label="Source identity domain"
          [value]="scopeKey()"
          (ionChange)="scopeKey.set($event.detail.value); mappings.set({})"
        >
          <ion-select-option value=""
            >Choose the actual Check source</ion-select-option
          >
          @for (scope of scopes(); track key(scope)) {
            <ion-select-option [value]="key(scope)"
              >{{ scope.title || scope.environmentId }} ·
              {{ scope.identityDomain }}</ion-select-option
            >
          }
        </ion-select></ion-item
      >
      @for (item of check().inputs; track item.name) {
        <ion-item
          ><ion-select
            [label]="item.name + ' · ' + item.type + ' · ' + item.cardinality"
            [attr.aria-label]="'Context binding ' + item.name"
            [value]="mappings()[item.name] || ''"
            (ionChange)="mapInput(item.name, $event.detail.value)"
          >
            <ion-select-option value="">{{
              caseId() ? 'Authoritative Case default / omitted' : 'Omitted'
            }}</ion-select-option>
            <ion-select-option value="manual">Manual value</ion-select-option>
            @for (entry of entries(); track entry.ref.revisionId) {
              <ion-select-option [value]="entry.ref.revisionId"
                >{{ entry.label }} · {{ entry.value }} ·
                {{ entry.ref.revisionId }}</ion-select-option
              >
            }
          </ion-select></ion-item
        >
        @if (mappings()[item.name] === 'manual') {
          <ion-item
            ><ion-input
              [label]="item.name"
              [value]="manual()[item.name] || ''"
              (ionInput)="setManual(item.name, $event.detail.value || '')"
          /></ion-item>
          @if (item.cardinality === 'range') {
            <ion-item
              ><ion-input
                [label]="item.name + ' end'"
                [value]="manual()[item.name + ':end'] || ''"
                (ionInput)="
                  setManual(item.name + ':end', $event.detail.value || '')
                "
            /></ion-item>
          }
        }
      }
      <p>Preview: {{ preview() || 'No context inputs selected.' }}</p>
      <ion-button
        (click)="run()"
        [disabled]="
          operation.busy() ||
          !selectedScope() ||
          !workspace.canExecuteFor(sessionId()) ||
          workspace.capabilities()?.nativeDetective !== true
        "
        >Run native Check</ion-button
      >
    } @else {
      <ion-item role="status"
        ><ion-label>
          <h3>Operation {{ operation.draft()?.operationId }}</h3>
          <p><a [routerLink]="recoveryHref()">Saved status and reconnect</a></p>
          @if (operation.draft()?.response?.status; as status) {
            <p>
              Saved run {{ status.runId }} · {{ status.state }} · produced
              {{ status.produced }} · finalized {{ status.done }}
            </p>
            @if (status.evidenceState) {
              <p>Case evidence: {{ status.evidenceState }}</p>
            }
            @if (status.fenceReason) {
              <p>Fenced: {{ status.fenceReason }}</p>
            }
          } @else {
            <p>Acceptance is unconfirmed. Refresh status before retrying.</p>
          }
          <p>Reload and refresh status never dispatch a Check.</p>
        </ion-label></ion-item
      >
      <ion-button
        fill="outline"
        (click)="operation.observe()"
        [disabled]="operation.busy()"
        >Refresh saved status</ion-button
      >
      @if (operation.draft()?.response?.status?.done) {
        <ion-button
          fill="outline"
          (click)="operation.newRun()"
          [disabled]="operation.busy()"
          >Prepare another run</ion-button
        >
      } @else if (
        operation.draft()?.request &&
        !operation.draft()?.response?.status?.fenceReason
      ) {
        <ion-button
          fill="outline"
          (click)="retry()"
          [disabled]="
            operation.busy() ||
            workspace.capabilities()?.nativeDetective !== true
          "
          >Retry identical request</ion-button
        >
      }
    }
    @if (operation.error() || error()) {
      <ion-item color="warning" role="alert"
        ><ion-label class="ion-text-wrap">{{
          operation.error() || error()
        }}</ion-label></ion-item
      >
    }
  `,
})
export class SessionDetectiveRunComponent {
  readonly check = input.required<CheckDefinition>();
  readonly project = input.required<IProjectRef>();
  readonly sessionId = input.required<string>();
  readonly environment = input.required<string>();
  readonly caseId = input<string | undefined>();
  protected readonly workspace = inject(SessionWorkspaceService);
  protected readonly operation = inject(SessionDetectiveOperationService);
  protected readonly scopeKey = signal('');
  protected readonly environmentChoice = signal('');
  protected readonly environments = computed(() => [
    ...new Set(
      this.workspace
        .capabilities()
        ?.environments.map((scope) => scope.environmentId) || [],
    ),
  ]);
  protected readonly mappings = signal<Record<string, string>>({});
  protected readonly manual = signal<Record<string, string>>({});
  protected readonly error = signal('');
  protected readonly key = contextScopeKey;
  protected readonly recoveryHref = computed(() => {
    const draft = this.operation.draft();
    return draft ? nativeRecoveryHref(draft.project, draft.recoveryId) : '';
  });
  protected readonly scopes = computed(
    () =>
      this.workspace
        .capabilities()
        ?.environments.filter(
          (scope) =>
            scope.environmentId ===
            (this.environmentChoice() || this.environment()),
        ) || [],
  );
  protected readonly selectedScope = computed(() =>
    this.scopes().find((scope) => contextScopeKey(scope) === this.scopeKey()),
  );
  protected readonly entries = computed(() => {
    const snapshot = this.workspace.snapshotFor(this.sessionId()),
      scope = this.selectedScope();
    if (!snapshot || !scope) return [];
    const slot = snapshot.contextSet.enabled
      ? snapshot.contextSet.slots.find((slot) =>
          sameContextScope(slot.scope, scope),
        )
      : undefined;
    const refs = [
      ...(slot?.entries || []),
      ...(this.workspace.draft()?.attachments || []),
    ];
    return refs
      .filter(
        (ref, index) =>
          refs.findIndex(
            (candidate) => candidate.revisionId === ref.revisionId,
          ) === index,
      )
      .flatMap((ref) => {
        const revision = snapshot.revisions.find(
          (revision) =>
            revision.id === ref.revisionId && revision.entryId === ref.entryId,
        );
        const bag = snapshot.bags.find((bag) => bag.id === revision?.bagId);
        if (!revision || !bag || !sameContextScope(bag.scope, scope)) return [];
        const entry = snapshot.entries.find(
          (entry) => entry.id === ref.entryId,
        );
        const value =
          revision.value.kind === 'scalar'
            ? String(revision.value.scalar?.value ?? 'null')
            : `${revision.value.values?.length || 0} values`;
        return [
          {
            ref,
            revision,
            label:
              entry?.alias ||
              revision.subject.record ||
              revision.subject.conceptId,
            value,
          },
        ];
      });
  });
  protected readonly preview = computed(() =>
    this.check()
      .inputs.map((item) => {
        const mapping = this.mappings()[item.name];
        const shape = `${item.type} · ${item.cardinality}${item.required ? ' · required' : ''}`;
        const entry = this.entries().find(
          (entry) => entry.ref.revisionId === mapping,
        );
        if (entry)
          return `${item.name} ← ${entry.label} (${entry.value}), ${shape}, revision ${entry.ref.revisionId}`;
        if (mapping === 'manual') {
          const value = this.manual()[item.name] || '',
            end = this.manual()[item.name + ':end'] || '';
          try {
            return `${item.name} ← manual ${shape}: ${displayInputValue(parseInputValue(value, item.type, item.cardinality, end))}`;
          } catch {
            return `${item.name} ← invalid manual ${shape}: ${value}${item.cardinality === 'range' ? ' … ' + end : ''}`;
          }
        }
        return `${item.name} ← ${this.caseId() ? 'server Case default pending resolution (or omitted if absent)' : item.required ? 'required value omitted' : 'omitted'} · ${shape}`;
      })
      .join('; '),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.operation.invalidate());
    effect(() => {
      const caps = this.workspace.capabilities(),
        project = this.project(),
        sessionId = this.sessionId(),
        check = this.check();
      this.scopeKey.set('');
      this.mappings.set({});
      this.manual.set({});
      this.error.set('');
      if (caps && sessionId && check.id)
        void this.operation.open(
          project,
          caps,
          sessionId,
          check.id,
          this.caseId(),
        );
      else this.operation.invalidate();
    });
  }
  protected mapInput(name: string, value: string): void {
    this.mappings.update((old) => ({ ...old, [name]: value || '' }));
  }
  protected setManual(name: string, value: string): void {
    this.manual.update((old) => ({ ...old, [name]: value }));
  }
  protected retry(): void {
    const caps = this.workspace.capabilities();
    if (caps) void this.operation.retry(caps);
  }
  protected async run(): Promise<void> {
    const snapshot = this.workspace.snapshotFor(this.sessionId()),
      caps = this.workspace.capabilities(),
      scope = this.selectedScope();
    if (!snapshot || !caps || !scope) return;
    this.error.set('');
    try {
      const bindings: {
        inputName: string;
        entryId: string;
        revisionId: string;
      }[] = [];
      const inputs: Record<string, DetectiveInputValue> = {};
      const attachments: ContextEntryRef[] = [];
      for (const item of this.check().inputs) {
        const mapping = this.mappings()[item.name];
        if (mapping === 'manual') {
          inputs[item.name] = parseInputValue(
            this.manual()[item.name] || '',
            item.type,
            item.cardinality,
            this.manual()[item.name + ':end'],
          );
        } else if (mapping) {
          const entry = this.entries().find(
            (entry) => entry.ref.revisionId === mapping,
          );
          if (!entry)
            throw new Error(
              'The selected revision is no longer applied or attached. Review the context.',
            );
          const value = entry.revision.value;
          if (
            item.cardinality === 'range' ||
            value.kind !== item.cardinality ||
            (value.kind === 'scalar'
              ? value.scalar?.type !== item.type
              : !value.values?.length ||
                value.values.some((value) => value.type !== item.type))
          )
            throw new Error(
              `${item.name} needs a matching ${item.type} ${item.cardinality}.`,
            );
          bindings.push({ inputName: item.name, ...entry.ref });
          attachments.push(entry.ref);
        } else if (item.required && !this.caseId())
          throw new Error(`Select a value for ${item.name}.`);
      }
      await this.operation.start(this.project(), caps, {
        operationId: 'op_' + crypto.randomUUID().replaceAll('-', ''),
        sessionId: snapshot.session.id,
        expectedVersion: snapshot.session.version,
        expectedContextSetId: snapshot.contextSet.id,
        scope: {
          environmentId: scope.environmentId,
          identityDomain: scope.identityDomain,
        },
        checkId: this.check().id,
        ...(this.caseId() ? { caseId: this.caseId() } : {}),
        ...(bindings.length
          ? {
              bindings,
              attachments: attachments.filter(
                (ref, index) =>
                  attachments.findIndex(
                    (item) => item.revisionId === ref.revisionId,
                  ) === index,
              ),
            }
          : {}),
        ...(Object.keys(inputs).length ? { inputs } : {}),
      });
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Review the input mapping before running.',
      );
    }
  }
}
