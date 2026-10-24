import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonInput,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
} from '@ionic/angular';
import { SessionScope } from '../session-context/session-context-contract';
import {
  WorkDraft,
  WorkEnvironment,
  WorkMember,
  WorkType,
} from './work.models';

@Component({
  selector: 'sneat-work-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    IonButton,
    IonButtons,
    IonInput,
    IonItem,
    IonLabel,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTextarea,
  ],
  templateUrl: './work-form.component.html',
  styles: `
    ion-input,
    ion-textarea,
    ion-select {
      --highlight-color-valid: var(--ion-color-primary);
    }
    :host {
      display: block;
    }
    .paired {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    @media (max-width: 600px) {
      .paired {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class WorkFormComponent {
  readonly initial = input<WorkDraft>();
  readonly initialScope = input<SessionScope>();
  readonly members = input<WorkMember[]>([]);
  readonly environments = input<WorkEnvironment[]>([]);
  readonly busy = input(false);
  readonly canAssign = input(false);
  readonly editing = input(false);
  readonly actor = input('');
  readonly submitted = output<{
    draft: WorkDraft;
    contextScope: SessionScope;
  }>();
  readonly cancelled = output<void>();
  readonly form = new FormGroup({
    type: new FormControl<WorkType>('task', { nonNullable: true }),
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(256)],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(16384),
    }),
    ownerId: new FormControl('', { nonNullable: true }),
    assigneeIds: new FormControl<string[]>([], { nonNullable: true }),
    primaryAssigneeId: new FormControl('', { nonNullable: true }),
    priority: new FormControl('normal', { nonNullable: true }),
    dueAt: new FormControl('', { nonNullable: true }),
    criteria: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(16384),
    }),
    severity: new FormControl('major', { nonNullable: true }),
    impact: new FormControl('', { nonNullable: true }),
    environment: new FormControl('', {
      nonNullable: true,
      validators: Validators.required,
    }),
  });
  constructor() {
    effect(() => {
      const draft = this.initial();
      const actor = this.actor();
      const initialScope = this.initialScope();
      const options = this.environments();
      const env =
        options.find((e) =>
          initialScope
            ? this.scopeKey(e) === this.scopeKey(initialScope)
            : e.environmentId === draft?.environment,
        ) ?? options[0];
      this.form.reset({
        type: draft?.type ?? 'task',
        title: draft?.title ?? '',
        description: draft?.description ?? '',
        ownerId: draft?.ownerId ?? actor,
        assigneeIds: draft?.assigneeIds ?? (actor ? [actor] : []),
        primaryAssigneeId: draft?.primaryAssigneeId ?? actor,
        priority: draft?.priority ?? 'normal',
        dueAt: localDateInput(draft?.dueAt),
        criteria: draft?.criteria ?? '',
        severity: draft?.severity ?? 'major',
        impact: draft?.impact ?? '',
        environment: env ? this.scopeKey(env) : '',
      });
    });
    effect(() => {
      if (this.busy()) {
        this.form.disable({ emitEvent: false });
        return;
      }
      this.form.enable({ emitEvent: false });
      if (this.editing()) {
        this.form.controls.type.disable({ emitEvent: false });
        this.form.controls.environment.disable({ emitEvent: false });
      }
      if (!this.canAssign()) {
        this.form.controls.ownerId.disable({ emitEvent: false });
        this.form.controls.assigneeIds.disable({ emitEvent: false });
        this.form.controls.primaryAssigneeId.disable({ emitEvent: false });
      }
    });
  }
  scopeKey(scope: SessionScope): string {
    return JSON.stringify([scope.environmentId, scope.identityDomain]);
  }
  name(id: string): string {
    return this.members().find((member) => member.id === id)?.title || id;
  }
  selectionChanged(): void {
    const ids = this.form.controls.assigneeIds.value;
    if (!ids.includes(this.form.controls.primaryAssigneeId.value))
      this.form.controls.primaryAssigneeId.setValue(ids[0] ?? '');
  }
  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;
    const value = this.form.getRawValue();
    const scope = this.environments().find(
      (env) => this.scopeKey(env) === value.environment,
    );
    if (!scope || !value.title.trim()) return;
    if (
      value.assigneeIds.length &&
      !value.assigneeIds.includes(value.primaryAssigneeId)
    )
      return;
    const dueAt = value.dueAt ? new Date(value.dueAt) : undefined;
    if (dueAt && !Number.isFinite(dueAt.getTime())) return;
    this.submitted.emit({
      draft: {
        type: value.type,
        title: value.title.trim(),
        description: value.description.trim(),
        ownerId: value.ownerId,
        assigneeIds: value.assigneeIds,
        primaryAssigneeId: value.primaryAssigneeId,
        priority: value.priority,
        ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
        criteria: value.criteria.trim(),
        environment: scope.environmentId,
        ...(value.type === 'incident'
          ? { severity: value.severity, impact: value.impact.trim() }
          : {}),
      },
      contextScope: {
        environmentId: scope.environmentId,
        identityDomain: scope.identityDomain,
      },
    });
  }
}
export function localDateInput(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
