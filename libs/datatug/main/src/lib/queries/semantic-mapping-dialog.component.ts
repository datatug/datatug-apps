import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonNote,
  IonSpinner,
  IonCheckbox,
} from '@ionic/angular';
import {
  validateSemanticModel,
  conceptId,
  rebuildMeaningBindings,
  type SemanticModel,
} from './semantic-mapping';
@Component({
  selector: 'sneat-datatug-semantic-mapping-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonTextarea,
    IonNote,
    IonSpinner,
    IonCheckbox,
  ],
  styles: [
    ':host ion-modal { --width: 560px; --height: min(740px, 95vh); } .form { padding: 20px; display: grid; gap: 16px; } .actions { display: flex; flex-wrap: wrap; gap: 8px; } .error { color: var(--ion-color-danger); } .summary { background: var(--ion-color-light); padding: 12px; border-radius: 8px; }',
  ],
  template: ` <ion-modal
    style="--width: min(560px, 100vw); --height: min(740px, 95vh)"
    [isOpen]="!!bundle()"
    [backdropDismiss]="!saving()"
    [canDismiss]="canDismiss"
    (didDismiss)="dismissed.emit()"
  >
    <ng-template>
      <ion-header
        ><ion-toolbar
          ><ion-title>Meaning of {{ columnName() }}</ion-title
          ><ion-buttons slot="end"
            ><ion-button (click)="dismissed.emit()" [disabled]="saving()"
              >Cancel</ion-button
            ></ion-buttons
          ></ion-toolbar
        ></ion-header
      >
      <ion-content
        ><div class="form">
          <div class="summary">
            Give this column a meaning. Reuse a property or create one below.
            <strong>{{ storageLabel() }}</strong>
          </div>
          <ion-select
            label="Property"
            labelPlacement="stacked"
            [ngModel]="property()"
            (ngModelChange)="chooseProperty($event)"
            interface="popover"
          >
            <ion-select-option value="new"
              >Create a property…</ion-select-option
            >
            @for (concept of properties(); track concept.id) {
              <ion-select-option [value]="concept.id">{{
                propertyLabel(concept.id)
              }}</ion-select-option>
            }
          </ion-select>
          @if (property() === 'new') {
            <ion-input
              label="Property name"
              labelPlacement="stacked"
              placeholder="e.g. Email address"
              [ngModel]="propertyName()"
              (ngModelChange)="propertyName.set($event)"
            />
            <ion-select
              label="Entity"
              labelPlacement="stacked"
              [ngModel]="entity()"
              (ngModelChange)="chooseEntity($event)"
              interface="popover"
            >
              <ion-select-option value="new"
                >Create an entity…</ion-select-option
              >
              @for (concept of entities(); track concept.id) {
                <ion-select-option [value]="concept.id">{{
                  concept.labels.en
                }}</ion-select-option>
              }
            </ion-select>
            @if (entity() === 'new') {
              <ion-input
                label="Entity name"
                labelPlacement="stacked"
                placeholder="e.g. Customer"
                [ngModel]="entityName()"
                (ngModelChange)="entityName.set($event)"
              />
            }
            <ion-textarea
              label="Description (optional)"
              labelPlacement="stacked"
              [ngModel]="description()"
              (ngModelChange)="description.set($event)"
            />
          } @else {
            <ion-input
              label="Property name"
              labelPlacement="stacked"
              [ngModel]="propertyName()"
              (ngModelChange)="propertyName.set($event)"
            />
            <ion-input
              label="Entity name"
              labelPlacement="stacked"
              [ngModel]="entityName()"
              (ngModelChange)="entityName.set($event)"
            />
            <ion-textarea
              label="Description"
              labelPlacement="stacked"
              [ngModel]="description()"
              (ngModelChange)="description.set($event)"
            />
            <ion-note
              >Changes to these definitions update every use in this
              query.</ion-note
            >
          }
          <details>
            <summary>Entity description (optional)</summary>
            <ion-textarea
              label="Entity description"
              labelPlacement="stacked"
              [ngModel]="entityDescription()"
              (ngModelChange)="entityDescription.set($event)"
            />
          </details>
          <ion-input
            label="Context role (optional)"
            labelPlacement="stacked"
            placeholder="e.g. Billing"
            [ngModel]="role()"
            (ngModelChange)="role.set($event)"
          />
          <ion-note
            >The role labels this mapping. It does not assert a key or
            relationship.</ion-note
          >
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          @if (needsReview()) {
            <div class="summary">
              <strong>Review all mappings</strong>
              <p>
                The query or columns changed. Positions alone do not identify
                meanings.
              </p>
              @for (
                binding of draft()?.bindings ?? [];
                track binding.columnIndex
              ) {
                <p>
                  {{ draft()?.basis?.columns?.[binding.columnIndex]?.name }} →
                  {{ propertyLabel(binding.concept) }}
                </p>
              }
            </div>
            <ion-checkbox
              [ngModel]="reviewed()"
              (ngModelChange)="reviewed.set($event)"
              >I reviewed every mapping below for the current query and
              columns.</ion-checkbox
            >
          }
          @if (importError()) {
            <p class="error" role="alert">{{ importError() }}</p>
          }
          <div class="actions">
            <ion-button (click)="submit()" [disabled]="saving() || !valid()">
              @if (saving()) {
                <ion-spinner name="dots" />
              }
              {{ saveLabel() }}</ion-button
            >
            @if (existing()) {
              <ion-button
                fill="outline"
                color="danger"
                [disabled]="saving() || (needsReview() && !reviewed())"
                (click)="remove()"
                >Remove mapping</ion-button
              >
            }
          </div>
          <details>
            <summary>Reuse and export meanings</summary>
            <p>
              Import definitions from another exported query. Current mappings
              stay intact.
            </p>
            <input
              type="file"
              accept="application/json,.json"
              aria-label="Import meanings"
              (change)="importMeanings($event)"
            />
            <div class="actions">
              <ion-button fill="clear" (click)="exportDocument('meaning')"
                >Export MeaningGraph</ion-button
              ><ion-button fill="clear" (click)="exportDocument('model')"
                >Export ModelSpec</ion-button
              >
            </div>
          </details>
        </div></ion-content
      >
    </ng-template>
  </ion-modal>`,
})
export class SemanticMappingDialogComponent {
  readonly canDismiss = (): Promise<boolean> => Promise.resolve(!this.saving());
  readonly bundle = input<SemanticModel>();
  readonly needsReview = input(false);
  readonly reviewed = signal(false);
  readonly columnIndex = input(0);
  readonly columnName = input('');
  readonly saving = input(false);
  readonly error = input('');
  readonly saveLabel = input('Save meaning');
  readonly storageLabel = input('');
  readonly save = output<SemanticModel>();
  readonly dismissed = output<void>();
  readonly draft = signal<SemanticModel | undefined>(undefined);
  readonly property = signal('new');
  readonly entity = signal('new');
  readonly propertyName = signal('');
  readonly entityName = signal('');
  readonly description = signal('');
  readonly entityDescription = signal('');
  readonly role = signal('');
  readonly importError = signal('');
  readonly properties = computed(
    () =>
      this.draft()?.meaning.concepts.filter((c) => c.kind === 'property') ?? [],
  );
  readonly entities = computed(
    () =>
      this.draft()?.meaning.concepts.filter((c) => c.kind === 'entity') ?? [],
  );
  readonly existing = computed(() =>
    this.bundle()?.bindings.find((b) => b.columnIndex === this.columnIndex()),
  );
  readonly selectedProperty = computed(() =>
    this.properties().find((c) => c.id === this.property()),
  );
  readonly selectedEntityLabel = computed(
    () =>
      this.entities().find((c) => c.id === this.selectedProperty()?.of)?.labels
        .en ?? '',
  );
  readonly valid = computed(
    () =>
      (!this.needsReview() || this.reviewed()) &&
      !!this.propertyName().trim() &&
      !!this.entityName().trim() &&
      this.propertyName().length <= 512 &&
      this.entityName().length <= 512 &&
      this.description().length <= 4096 &&
      this.entityDescription().length <= 4096 &&
      this.role().length <= 512,
  );
  constructor() {
    effect(() => {
      const bundle = this.bundle();
      untracked(() => {
        this.draft.set(bundle ? structuredClone(bundle) : undefined);
        this.role.set(this.existing()?.role ?? '');
        this.chooseProperty(this.existing()?.concept ?? 'new');
        this.reviewed.set(false);
        this.importError.set('');
      });
    });
  }
  chooseProperty(value: string): void {
    this.property.set(value);
    const concept = this.draft()?.meaning.concepts.find((c) => c.id === value);
    const entity = this.draft()?.meaning.concepts.find(
      (c) => c.id === concept?.of,
    );
    this.propertyName.set(
      concept?.labels.en ??
        this.columnName()
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/\bId\b/g, 'ID'),
    );
    this.description.set(concept?.description ?? '');
    this.chooseEntity(
      entity?.id ??
        (this.entities().length === 1 ? this.entities()[0].id : 'new'),
    );
  }
  chooseEntity(id: string): void {
    this.entity.set(id);
    const entity = this.entities().find((concept) => concept.id === id);
    this.entityName.set(entity?.labels.en ?? '');
    this.entityDescription.set(entity?.description ?? '');
  }
  propertyLabel(id: string): string {
    const concept = this.draft()?.meaning.concepts.find((c) => c.id === id);
    const entity = this.draft()?.meaning.concepts.find(
      (c) => c.id === concept?.of,
    );
    return [entity?.labels.en, concept?.labels.en].filter(Boolean).join(' · ');
  }
  submit(): void {
    if (this.saving()) return;
    const original = this.draft();
    if (!original || !this.valid()) return;
    const bundle = structuredClone(original);
    let property = this.property();
    if (property === 'new') {
      let entity = this.entity();
      if (entity === 'new') {
        const match = bundle.meaning.concepts.find(
          (c) =>
            c.kind === 'entity' &&
            c.labels.en.toLowerCase() ===
              this.entityName().trim().toLowerCase(),
        );
        if (match) entity = match.id;
      }
      if (entity === 'new') {
        entity = conceptId(this.entityName(), bundle.meaning.concepts);
        bundle.meaning.concepts.push({
          id: entity,
          kind: 'entity',
          labels: { en: this.entityName().trim() },
          description:
            this.entityDescription().trim() || this.entityName().trim(),
        });
      }
      const match = bundle.meaning.concepts.find(
        (c) =>
          c.kind === 'property' &&
          c.of === entity &&
          c.labels.en.toLowerCase() ===
            this.propertyName().trim().toLowerCase(),
      );
      property =
        match?.id ?? conceptId(this.propertyName(), bundle.meaning.concepts);
      if (!match)
        bundle.meaning.concepts.push({
          id: property,
          kind: 'property',
          labels: { en: this.propertyName().trim() },
          description: this.description().trim() || this.propertyName().trim(),
          of: entity,
        });
    }
    if (this.property() !== 'new') {
      bundle.meaning.concepts = bundle.meaning.concepts.map((concept) =>
        concept.id === property
          ? {
              ...concept,
              labels: { en: this.propertyName().trim() },
              description:
                this.description().trim() || this.propertyName().trim(),
            }
          : concept.id === this.entity()
            ? {
                ...concept,
                labels: { en: this.entityName().trim() },
                description:
                  this.entityDescription().trim() || this.entityName().trim(),
              }
            : concept,
      );
    }
    bundle.bindings = [
      ...bundle.bindings.filter((b) => b.columnIndex !== this.columnIndex()),
      {
        columnIndex: this.columnIndex(),
        field: `column${this.columnIndex() + 1}`,
        concept: property,
        ...(this.role().trim() ? { role: this.role().trim() } : {}),
      },
    ];
    this.save.emit(rebuildMeaningBindings(bundle));
  }
  remove(): void {
    if (this.saving() || (this.needsReview() && !this.reviewed())) return;
    const bundle = this.draft();
    if (bundle)
      this.save.emit(
        rebuildMeaningBindings({
          ...bundle,
          bindings: bundle.bindings.filter(
            (b) => b.columnIndex !== this.columnIndex(),
          ),
        }),
      );
  }
  async importMeanings(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0],
      bundle = this.draft();
    if (!file || !bundle) return;
    try {
      if (file.size > 100000) throw new Error('Meaning file is too large.');
      const document = JSON.parse(await file.text());
      if (
        document.format !== 'meaning/draft-2' ||
        !Array.isArray(document.concepts)
      )
        throw new Error('Choose a supported MeaningGraph JSON export.');
      for (const concept of document.concepts) {
        if (
          concept.bindings !== undefined &&
          (!Array.isArray(concept.bindings) ||
            concept.bindings.some(
              (binding: Record<string, unknown>) =>
                !binding ||
                Object.keys(binding).some(
                  (key) => !['model', 'field', 'role'].includes(key),
                ) ||
                binding['model'] !== 'modelspec:///query.QueryResult' ||
                binding['role'] !== 'value' ||
                typeof binding['field'] !== 'string' ||
                !/^column[1-9][0-9]*$/.test(binding['field']),
            ))
        )
          throw new Error(
            'This meaning file contains unsupported bindings. Export supported query meanings to reuse them.',
          );
      }
      const imported = {
        ...structuredClone(bundle),
        meaning: document,
        bindings: [],
      };
      imported.meaning.concepts = document.concepts.map(
        (c: Record<string, unknown>) => ({
          ...c,
          ...(c['bindings'] ? { bindings: [] } : {}),
        }),
      );
      validateSemanticModel(imported);
      const concepts = document.concepts;
      if (
        concepts.some(
          (c: {
            id?: string;
            kind?: string;
            labels?: { en?: string };
            description?: string;
            of?: string;
          }) =>
            !c.id ||
            !/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/.test(c.id) ||
            !['entity', 'property'].includes(c.kind ?? '') ||
            !c.labels?.en ||
            !c.description ||
            (c.kind === 'property' &&
              !concepts.some(
                (e: { id: string; kind: string }) =>
                  e.id === c.of && e.kind === 'entity',
              )),
        )
      )
        throw new Error(
          'This import needs entity/property definitions with valid names and ownership.',
        );
      const merged = structuredClone(bundle);
      for (const concept of concepts) {
        const existing = merged.meaning.concepts.find(
          (c) => c.id === concept.id,
        );
        const definition = {
          id: concept.id,
          kind: concept.kind,
          labels: { en: concept.labels.en },
          description: concept.description,
          ...(concept.of ? { of: concept.of } : {}),
        };
        if (
          existing &&
          JSON.stringify({ ...existing, bindings: undefined }) !==
            JSON.stringify(definition)
        )
          throw new Error(
            `Meaning ${concept.id} already exists with a different definition.`,
          );
        if (!existing) merged.meaning.concepts.push(definition);
      }
      this.draft.set(merged);
      this.importError.set('');
    } catch (error) {
      this.importError.set(
        error instanceof Error ? error.message : 'Import failed.',
      );
    }
  }
  exportDocument(which: 'meaning' | 'model'): void {
    const bundle = this.bundle();
    if (!bundle) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle[which], null, 2)], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download =
      which === 'meaning' ? 'query.meaning.json' : 'query.modelspec.json';
    link.click();
    URL.revokeObjectURL(url);
  }
}
