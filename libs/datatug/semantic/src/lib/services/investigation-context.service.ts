import { Injectable, Signal, computed, signal } from '@angular/core';
import { EntityFieldRef, SemanticValue } from '../models/models';

/** Input to {@link InvestigationContextService.addValue}. */
export interface ContextItemInput {
  readonly entityField: EntityFieldRef;
  readonly value: SemanticValue;
  readonly label: string;
  /** Where this value came from, e.g. `"grid"`, a related-lookup id, a source name. */
  readonly source: string;
}

/** REQ:context-basket — one Investigation Context entry. */
export interface ContextItem extends ContextItemInput {
  readonly id: string;
  readonly enabled: boolean;
  readonly addedAt: string;
}

/** The subset of a query parameter's shape {@link InvestigationContextService.bindingsFor} needs. */
export interface SemanticParameterRef {
  readonly id: string;
  readonly meta?: EntityFieldRef;
}

/** A candidate binding {@link InvestigationContextService.bindingsFor} found for a parameter. */
export interface ParameterBinding {
  readonly parameterId: string;
  readonly entityField: EntityFieldRef;
  readonly value: SemanticValue;
  readonly label: string;
  readonly source: string;
  readonly contextItemId: string;
}

const STORAGE_KEY = 'datatug.investigationContext.v1';

function contextItemId(entityField: EntityFieldRef, value: SemanticValue): string {
  return `${entityField.entity}.${entityField.field}=${value}`;
}

/**
 * REQ:context-basket — the Investigation Context ("basket", A3: internal name only).
 * An ordered, session-scoped set of semantic values the user explicitly added, each
 * removable and independently disable-able without being removed.
 *
 * REQ:no-hidden-filters — this service NEVER filters, binds, or otherwise constrains a
 * query on its own. {@link bindingsFor} only reports candidate bindings; a caller (a
 * query page) decides whether to show and apply them before running.
 */
@Injectable({ providedIn: 'root' })
export class InvestigationContextService {
  private readonly itemsSignal = signal<readonly ContextItem[]>(this.restore());

  /** The ordered set of context items, disabled items included. */
  readonly items: Signal<readonly ContextItem[]> = this.itemsSignal.asReadonly();

  /** Count of *enabled* items — what the collapsed context indicator on every screen shows. */
  readonly enabledCount: Signal<number> = computed(
    () => this.itemsSignal().filter((item) => item.enabled).length,
  );

  /** Adds a semantic value; adding an already-present `entityField`+`value` pair is a no-op that returns the existing item. */
  addValue(input: ContextItemInput): ContextItem {
    const id = contextItemId(input.entityField, input.value);
    const existing = this.itemsSignal().find((item) => item.id === id);
    if (existing) {
      return existing;
    }
    const item: ContextItem = {
      ...input,
      id,
      enabled: true,
      addedAt: new Date().toISOString(),
    };
    this.itemsSignal.set([...this.itemsSignal(), item]);
    this.persist();
    return item;
  }

  /** Removes a value from the context entirely. */
  removeValue(id: string): void {
    this.itemsSignal.set(this.itemsSignal().filter((item) => item.id !== id));
    this.persist();
  }

  /** Temporarily enables/disables a value without removing it (REQ:context-basket). */
  setEnabled(id: string, enabled: boolean): void {
    this.itemsSignal.set(
      this.itemsSignal().map((item) =>
        item.id === id ? { ...item, enabled } : item,
      ),
    );
    this.persist();
  }

  /** Clears the whole basket (e.g. "start a new investigation"). */
  clear(): void {
    this.itemsSignal.set([]);
    this.persist();
  }

  /**
   * REQ:parameter-auto-binding (context half) — for each of `parameters` that carries
   * semantic `meta`, reports the *enabled* context value it would bind from, if any.
   * Purely informational: it never mutates a query. The caller must show the binding
   * (with its origin) before running, and let the user clear or override it
   * (REQ:no-hidden-filters, REQ:parameter-auto-binding).
   */
  bindingsFor(
    parameters: readonly SemanticParameterRef[],
  ): readonly ParameterBinding[] {
    const enabled = this.itemsSignal().filter((item) => item.enabled);
    const bindings: ParameterBinding[] = [];
    for (const parameter of parameters) {
      const meta = parameter.meta;
      if (!meta) {
        continue;
      }
      const match = enabled.find(
        (item) =>
          item.entityField.entity === meta.entity &&
          item.entityField.field === meta.field,
      );
      if (match) {
        bindings.push({
          parameterId: parameter.id,
          entityField: match.entityField,
          value: match.value,
          label: match.label,
          source: match.source,
          contextItemId: match.id,
        });
      }
    }
    return bindings;
  }

  private restore(): readonly ContextItem[] {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ContextItem[]) : [];
    } catch {
      // sessionStorage unavailable (private mode, SSR, or a full quota) — start empty.
      return [];
    }
  }

  private persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.itemsSignal()));
    } catch {
      // Same as above: in-memory state still works even if it can't be persisted.
    }
  }
}
