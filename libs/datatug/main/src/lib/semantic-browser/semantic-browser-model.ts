import type { Signal, WritableSignal } from '@angular/core';
import type { TypedValue } from '@sneat/datatug-semantic';
import type { EvidenceShareSelection } from '../evidence/evidence-share-panel.component';
import type {
  NativeSchema,
  NativeRows,
  NativeSelection,
  NativeResolution,
  NativeLookup,
  NativeRelated,
  EntitySnapshot,
} from './semantic-browser-data';

/** Source-neutral presentation port. Signals describe admitted observations, never authority. */
export interface SemanticBrowserModel {
  readonly sourceId: string;
  readonly labels: {
    readonly title: string;
    readonly rowsDescription: string;
    readonly emptyRowsMessage: string;
    readonly relatedDescription: string;
  };
  readonly refreshIcon: string;
  readonly findChecksIcon: string;
  readonly checkLabels: Readonly<
    Record<string, { readonly label: string; readonly detail: string }>
  >;
  readonly environments: Signal<readonly string[]>;
  readonly canWrite: Signal<boolean>;
  readonly environment: Signal<string>;
  readonly selection: Signal<EvidenceShareSelection | undefined>;
  readonly schema: Signal<NativeSchema | undefined>;
  readonly collection: Signal<string>;
  readonly rows: Signal<NativeRows | undefined>;
  readonly selected: Signal<NativeSelection | undefined>;
  readonly resolution: Signal<NativeResolution | undefined>;
  readonly related: Signal<NativeRelated | undefined>;
  readonly relatedRows: Signal<NativeRows | undefined>;
  readonly entity: Signal<EntitySnapshot | undefined>;
  readonly entities: Signal<readonly { id: string; title?: string }[]>;
  readonly fieldId: WritableSignal<string>;
  readonly picker: Signal<boolean>;
  readonly busy: Signal<boolean>;
  readonly workStatus: Signal<string>;
  readonly selectedValue: Signal<TypedValue | undefined>;
  readonly error: Signal<string>;
  readonly notice: Signal<string>;
  readonly pending: Signal<
    | {
        readonly entityId: string;
        readonly fieldId: string;
        readonly selection: NativeSelection;
      }
    | undefined
  >;
  readonly blocked: Signal<boolean>;
  readonly restoring: Signal<boolean>;
  readonly reviewed: Signal<boolean>;
  readonly conflict: Signal<boolean>;
  readonly caseId: Signal<string | undefined>;
  readonly mappingChoiceAvailable: Signal<boolean>;
  readonly saveAllowed: Signal<boolean>;
  readonly checksPending: Signal<boolean>;
  readonly checksError: Signal<string>;
  readonly applicable: Signal<
    | {
        readonly checks: readonly {
          readonly id: string;
          readonly title: string;
          readonly revision: string;
          readonly definitionDigest: string;
          readonly preflight: {
            readonly state: string;
            readonly checkId: string;
            readonly stepId?: string;
          };
        }[];
      }
    | undefined
  >;
  changeEnvironment(value: string): void;
  chooseContext(value: EvidenceShareSelection | undefined): Promise<void>;
  inspect(name: string): Promise<void>;
  refresh(): Promise<void>;
  selectCell(row: number, column: number, event?: Event): Promise<void>;
  retryResolution(): Promise<void>;
  checkHref(id: string): string;
  findChecks(): Promise<void>;
  openRelated(lookup: NativeLookup): Promise<void>;
  openPicker(): Promise<void>;
  chooseEntity(id: string): Promise<void>;
  cancel(): void;
  save(): Promise<void>;
  retry(): Promise<void>;
  reviewPending(): Promise<void>;
  abandon(): void;
  cellText(row: number, column: number): string;
}
