import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
  type OnChanges,
  type OnDestroy,
  type SimpleChanges,
} from '@angular/core';
import type { PublicSqliteQueryPreview } from '../../public-sqlite-tugql';
import { AuthorSourceInspectorComponent } from './author-source-inspector.component';
import { tokenizeTugql } from './tugql-syntax';
import { IonButton, IonButtons, IonItem, IonLabel } from '@ionic/angular';

interface AuthorSqlBindingDisplay {
  readonly kind: 'customer-id' | 'literal';
  readonly label: string;
  readonly value?: string | number | null;
}

type SqlCopyState = 'pending' | 'copied' | 'failed';

interface SqlCopyFeedback {
  readonly plan: PublicSqliteQueryPreview;
  readonly state: SqlCopyState;
}

interface SqlCopyOperation {
  readonly plan: PublicSqliteQueryPreview;
}

@Component({
  selector: 'sneat-author-sql-preview',
  templateUrl: './author-sql-preview.component.html',
  styleUrl: './author-sql-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthorSourceInspectorComponent, IonButton, IonButtons, IonItem, IonLabel],
})
export class AuthorSqlPreviewComponent implements OnChanges, OnDestroy {
  public readonly plan = input.required<PublicSqliteQueryPreview>();
  public readonly customerId = input('');
  public readonly customerIdValid = input(false);
  public readonly customerIdMissing = input(true);
  public readonly refreshDisabled = input(false);
  public readonly refreshRequested = output<void>();
  public readonly sqlTokens = computed(() => tokenizeTugql(this.plan().sql));
  public readonly wrapSql = signal(false);
  private readonly copyFeedback = signal<SqlCopyFeedback | undefined>(
    undefined,
  );
  private readonly destroyRef = inject(DestroyRef);
  private pendingCopy: SqlCopyOperation | undefined;
  private componentDestroyed = false;

  public readonly copyPending = computed(() => {
    const feedback = this.copyFeedback();
    return feedback?.plan === this.plan() && feedback.state === 'pending';
  });

  public readonly copyStatus = computed(() => {
    const feedback = this.copyFeedback();
    if (feedback?.plan !== this.plan()) return '';
    switch (feedback.state) {
      case 'pending':
        return 'Copying preview SQL…';
      case 'copied':
        return 'Preview SQL copied';
      case 'failed':
        return "Couldn't copy SQL. Try again.";
    }
  });

  public ngOnChanges(changes: SimpleChanges<AuthorSqlPreviewComponent>): void {
    const planChange = changes['plan'];
    if (!planChange || planChange.previousValue === planChange.currentValue)
      return;
    this.copyFeedback.set(undefined);
    this.pendingCopy = undefined;
    this.wrapSql.set(false);
  }

  public ngOnDestroy(): void {
    this.componentDestroyed = true;
    this.pendingCopy = undefined;
    this.copyFeedback.set(undefined);
  }

  public toggleWrapping(): void {
    this.wrapSql.update((wrapped) => !wrapped);
  }

  public requestRefresh(): void {
    if (this.refreshDisabled()) return;
    this.refreshRequested.emit();
  }

  public async copyCurrentSql(): Promise<void> {
    const clickedPlan = this.plan();
    if (this.pendingCopy?.plan === clickedPlan) return;

    let clipboard: Clipboard | undefined;
    try {
      clipboard = globalThis.navigator?.clipboard;
    } catch {
      this.copyFeedback.set({ plan: clickedPlan, state: 'failed' });
      return;
    }
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      this.copyFeedback.set({ plan: clickedPlan, state: 'failed' });
      return;
    }

    const operation: SqlCopyOperation = { plan: clickedPlan };
    this.pendingCopy = operation;
    this.copyFeedback.set({ plan: clickedPlan, state: 'pending' });

    // Keep writeText inside this click handler, before the first await, so the
    // browser still recognizes the user's clipboard gesture.
    let write: Promise<void>;
    try {
      write = clipboard.writeText(clickedPlan.sql);
    } catch {
      if (this.isCurrentCopy(operation)) {
        this.copyFeedback.set({ plan: clickedPlan, state: 'failed' });
        this.pendingCopy = undefined;
      }
      return;
    }

    try {
      await write;
      if (this.isCurrentCopy(operation))
        this.copyFeedback.set({ plan: clickedPlan, state: 'copied' });
    } catch {
      if (this.isCurrentCopy(operation))
        this.copyFeedback.set({ plan: clickedPlan, state: 'failed' });
    } finally {
      if (this.pendingCopy === operation) this.pendingCopy = undefined;
    }
  }

  private isCurrentCopy(operation: SqlCopyOperation): boolean {
    return (
      !this.componentDestroyed &&
      !this.destroyRef.destroyed &&
      this.plan() === operation.plan &&
      this.pendingCopy === operation
    );
  }

  public get bindings(): readonly AuthorSqlBindingDisplay[] {
    const plan = this.plan();
    if (plan.bindingSlots) {
      return plan.bindingSlots.map((slot) => slot.kind === 'customer-id'
        ? { kind: 'customer-id', label: '@CustomerId · integer' }
        : {
            kind: 'literal',
            label: slot.name === 'HAVING threshold (literal)'
              ? 'HAVING threshold · integer literal'
              : `${slot.name} · integer literal`,
            value: slot.value,
          });
    }

    let fixedBindingIndex = 0;
    return plan.bindingNames.map((name) => {
      if (name === 'CustomerId')
        return { kind: 'customer-id', label: '@CustomerId · integer' };
      const value = plan.fixedBindings[fixedBindingIndex++];
      return {
        kind: 'literal',
        label: name === 'HAVING threshold (literal)'
          ? 'HAVING threshold · integer literal'
          : `${name} · integer literal`,
        value,
      };
    });
  }
}
