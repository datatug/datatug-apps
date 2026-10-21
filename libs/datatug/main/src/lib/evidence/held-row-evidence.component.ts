import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import { IonSelect, IonSelectOption } from '@ionic/angular';
import {
  decodeResult,
  verifyRowEvidence,
  type HeldEvidenceIdentity,
  type Result,
  type RowEvidenceSelector,
} from '@sneat/datatug-semantic';
import { IProjectRef } from '../core/project-context';
import { RetainedEvidenceViewerComponent } from './retained-evidence-viewer.component';
/** Selection only; authenticated provider identity is supplied with the exact held Result.
 * Sidecar metadata is never promoted to an independent source authority. */
export async function heldRowSelectors(
  raw: unknown,
  identity: HeldEvidenceIdentity,
): Promise<readonly { label: string; selector: RowEvidenceSelector }[]> {
  const result = decodeResult(raw);
  const sidecar = result.rowEvidence;
  if (!sidecar) return [];
  if (
    !identity.complete ||
    identity.hasMore ||
    result.truncated ||
    !identity.execution ||
    identity.execution.storeId !== sidecar.execution.storeId ||
    identity.execution.projectId !== sidecar.execution.projectId ||
    identity.execution.executionId !== sidecar.execution.executionId ||
    identity.scope.storeId !== sidecar.scope.storeId ||
    identity.scope.spaceID !== sidecar.scope.spaceID ||
    identity.scope.projectId !== sidecar.scope.projectId ||
    identity.scope.environment !== sidecar.scope.environment ||
    identity.source.id !== sidecar.source.id ||
    identity.source.generation !== sidecar.source.generation
  )
    throw new Error(
      'Current authenticated held identity does not match this row evidence.',
    );
  await verifyRowEvidence(sidecar, result);
  return sidecar.rows.flatMap((row) =>
    Object.entries(row.slots)
      .filter(([, slot]) => slot.state === 'available')
      .map(([slotColumn]) => ({
        label: `${String(row.rowKey.value)} · ${slotColumn}`,
        selector: {
          execution: sidecar.execution,
          recordsetFingerprint: sidecar.recordsetFingerprint,
          scope: sidecar.scope,
          source: sidecar.source,
          rowKeyColumn: sidecar.rowKeyColumn,
          rowKey: row.rowKey,
          slotColumn,
        },
      })),
  );
}
@Component({
  selector: 'sneat-datatug-held-row-evidence',
  imports: [IonSelect, IonSelectOption, RetainedEvidenceViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (held()?.choices?.length) {
      <ion-select
        label="Open retained row evidence"
        aria-label="Open retained row evidence"
        [value]="selected()"
        (ionChange)="selected.set($event.detail.value || '')"
        ><ion-select-option value=""
          >Choose held row and evidence slot</ion-select-option
        >
        @for (choice of held()!.choices; track $index) {
          <ion-select-option [value]="String($index)">{{
            choice.label
          }}</ion-select-option>
        }
      </ion-select>
    }
    @if (error()) {
      <p role="status">{{ error() }}</p>
    }
    @if (selection(); as value) {
      <sneat-datatug-retained-evidence-viewer
        [projectRef]="projectRef()"
        [environment]="environment()"
        [selector]="value"
        [heldResult]="held()?.result"
      />
    }`,
})
export class HeldRowEvidenceComponent {
  readonly projectRef = input<IProjectRef>();
  readonly environment = input('');
  readonly result = input<unknown>();
  readonly identity = input<HeldEvidenceIdentity>();
  protected readonly String = String;
  protected readonly selected = signal('');
  protected readonly error = signal('');
  private readonly prepared = signal<
    | {
        raw: unknown;
        result: Result;
        identity: HeldEvidenceIdentity;
        choices: readonly { label: string; selector: RowEvidenceSelector }[];
      }
    | undefined
  >(undefined);
  protected readonly held = computed(() => {
    const value = this.prepared();
    return value?.raw === this.result() && value?.identity === this.identity()
      ? value
      : undefined;
  });
  protected readonly selection = computed(() =>
    /^\d+$/.test(this.selected())
      ? this.held()?.choices[Number(this.selected())]?.selector
      : undefined,
  );
  constructor() {
    effect((cleanup) => {
      const result = this.result(),
        identity = this.identity();
      this.prepared.set(undefined);
      this.selected.set('');
      this.error.set('');
      let cancelled = false;
      cleanup(() => {
        cancelled = true;
      });
      if (
        !result ||
        typeof result !== 'object' ||
        !('rowEvidence' in result) ||
        !result.rowEvidence
      )
        return;
      if (!identity) {
        this.error.set(
          'Retained row opening is unavailable without authenticated provider identity.',
        );
        return;
      }
      void heldRowSelectors(result, identity)
        .then((choices) => {
          if (!cancelled)
            this.prepared.set({
              raw: result,
              result: decodeResult(result),
              identity,
              choices,
            });
        })
        .catch((error) => {
          if (!cancelled)
            this.error.set(
              error instanceof Error
                ? error.message
                : 'Held row evidence is unavailable.',
            );
        });
    });
  }
}
