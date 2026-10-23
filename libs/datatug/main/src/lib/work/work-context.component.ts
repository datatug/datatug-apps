import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonCheckbox,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  IonTextarea,
} from '@ionic/angular';
import {
  decodeTypedValue,
  TypedValue,
  TypedValueKind,
} from '@sneat/datatug-semantic';
import {
  ContextCommand,
  ContextEntry,
  ContextEntryRef,
  ContextSnapshot,
  ContextValue,
  sameContextScope,
} from '../session-context/session-context-contract';
import { WorkEnvironment, workId } from './work.models';

/** Presentation adapter for the existing Session Context Bag command contract. */
@Component({
  selector: 'sneat-work-context',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonButton,
    IonButtons,
    IonCheckbox,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonSelect,
    IonSelectOption,
    IonTextarea,
  ],
  templateUrl: './work-context.component.html',
})
export class WorkContextComponent {
  readonly snapshot = input.required<ContextSnapshot>();
  readonly environments = input<WorkEnvironment[]>([]);
  readonly editable = input(false);
  readonly busy = input(false);
  readonly contextCommand = output<ContextCommand>();
  readonly selectionChange = output<ContextEntryRef[]>();
  readonly bagId = signal('');
  readonly selected = signal<ContextEntryRef[]>([]);
  readonly subjectId = signal('');
  readonly text = signal('');
  readonly alias = signal('');
  readonly shape = signal<'scalar' | 'set'>('scalar');
  readonly editing = signal<ContextEntry | undefined>(undefined);
  readonly editorOpen = signal(false);
  readonly error = signal('');
  readonly bagTitle = signal('');
  readonly bagMode = signal<'create' | 'rename' | undefined>(undefined);
  readonly bag = computed(
    () =>
      this.snapshot().bags.find((b) => b.id === this.bagId()) ??
      this.snapshot().bags[0],
  );
  readonly entries = computed(() =>
    this.snapshot().entries.filter((e) => e.bagId === this.bag()?.id),
  );
  readonly subjects = computed(() => {
    const bag = this.bag();
    return bag
      ? (this.environments().find((e) => sameContextScope(e, bag.scope))
          ?.subjects ?? [])
      : [];
  });
  constructor() {
    effect(() => {
      const snapshot = this.snapshot();
      const bag = this.bag();
      this.selected.set(
        snapshot.contextSet.slots
          .find((slot) => slot.bagId === bag?.id)
          ?.entries.slice() ?? [],
      );
      this.editing.set(undefined);
      this.editorOpen.set(false);
    });
    effect(() => this.selectionChange.emit(this.selected()));
  }
  chooseBag(id: string): void {
    this.bagId.set(id);
    this.error.set('');
  }
  checked(entry: ContextEntry): boolean {
    return this.selected().some((ref) => ref.entryId === entry.id);
  }
  check(entry: ContextEntry, on: boolean): void {
    this.selected.update((refs) => [
      ...refs.filter((ref) => ref.entryId !== entry.id),
      ...(on
        ? [{ entryId: entry.id, revisionId: entry.currentRevisionId }]
        : []),
    ]);
  }
  value(entry: ContextEntry): string {
    const value = this.snapshot().revisions.find(
      (r) => r.id === entry.currentRevisionId,
    )?.value;
    return value?.kind === 'scalar'
      ? String(value.scalar?.value ?? 'null')
      : (value?.values?.map((v) => String(v.value)).join(', ') ??
          `${value?.keys?.length ?? 0} composite values`);
  }
  entryText(entry: ContextEntry): string {
    const value = this.snapshot().revisions.find(
      (r) => r.id === entry.currentRevisionId,
    )?.value;
    return value?.kind === 'set'
      ? (value.values?.map((v) => String(v.value)).join('\n') ?? '')
      : this.value(entry);
  }
  inherited(entry: ContextEntry): boolean {
    return !!this.snapshot().revisions.find(
      (revision) => revision.id === entry.currentRevisionId,
    )?.source;
  }
  canEdit(entry: ContextEntry): boolean {
    return !this.snapshot().revisions.find(
      (r) => r.id === entry.currentRevisionId,
    )?.value.keys?.length;
  }
  edit(entry?: ContextEntry): void {
    if (entry && !this.canEdit(entry)) return;
    this.editing.set(entry);
    this.alias.set(entry?.alias ?? '');
    this.text.set(entry ? this.entryText(entry) : '');
    this.subjectId.set(
      entry
        ? (this.subjects().find(
            (s) =>
              s.subject.fieldMappingRef === entry.subject.fieldMappingRef &&
              s.subject.fieldId === entry.subject.fieldId,
          )?.id ?? '')
        : (this.subjects()[0]?.id ?? ''),
    );
    this.shape.set(
      entry
        ? (this.snapshot().revisions.find(
            (r) => r.id === entry.currentRevisionId,
          )?.value.kind ?? 'scalar')
        : 'scalar',
    );
    this.error.set('');
    this.editorOpen.set(true);
  }
  base(action: ContextCommand['action']): ContextCommand {
    const s = this.snapshot();
    return {
      opId: workId(),
      action,
      sessionId: s.session.id,
      expectedVersion: s.session.version,
    };
  }
  saveEntry(): void {
    const bag = this.bag(),
      subject = this.subjects().find((s) => s.id === this.subjectId());
    if (!bag || !subject || !this.editable() || this.busy()) return;
    try {
      const parse = (text: string): TypedValue => {
        const type = subject.type as TypedValueKind;
        return decodeTypedValue({
          type,
          value:
            type === 'null'
              ? null
              : type === 'number'
                ? Number(text)
                : type === 'boolean'
                  ? text === 'true'
                    ? true
                    : text === 'false'
                      ? false
                      : text
                  : text,
        });
      };
      const value: ContextValue =
        this.shape() === 'set'
          ? {
              schemaVersion: 1,
              kind: 'set',
              values: this.text()
                .split('\n')
                .map((t) => t.trim())
                .filter(Boolean)
                .map(parse),
            }
          : { schemaVersion: 1, kind: 'scalar', scalar: parse(this.text()) };
      const entry = this.editing();
      this.contextCommand.emit({
        ...this.base('putEntry'),
        bagId: bag.id,
        expectedBagVersion: bag.version,
        entryId: entry?.id ?? workId(),
        expectedEntryVersion: entry?.version ?? 0,
        revisionId: workId(),
        subject: subject.subject,
        value,
        ...(this.alias().trim() ? { alias: this.alias().trim() } : {}),
      });
    } catch {
      this.error.set('Enter a valid typed value. Sets use one value per line.');
    }
  }
  apply(): void {
    const bag = this.bag(),
      s = this.snapshot();
    if (!bag) return;
    const slot = s.contextSet.slots.find((slot) =>
      sameContextScope(slot.scope, bag.scope),
    );
    this.contextCommand.emit({
      ...this.base('applyContext'),
      bagId: bag.id,
      expectedBagVersion: bag.version,
      expectedSlotVersion: slot?.version ?? 0,
      expectedContextSetId: s.contextSet.id,
      selection: this.selected(),
      enabled: true,
    });
  }
  saveBag(): void {
    const bag = this.bag();
    if (!bag || !this.bagTitle().trim()) return;
    const create = this.bagMode() === 'create';
    this.contextCommand.emit({
      ...this.base(create ? 'createBag' : 'renameBag'),
      bagId: create ? workId() : bag.id,
      ...(create ? { scope: bag.scope } : { expectedBagVersion: bag.version }),
      title: this.bagTitle().trim(),
    });
    this.bagMode.set(undefined);
  }
}
