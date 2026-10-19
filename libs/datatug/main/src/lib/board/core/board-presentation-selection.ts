import { Injectable, signal } from '@angular/core';
/** Transient board-view state, deliberately absent from execution identity and storage. */
@Injectable()
export class BoardPresentationSelection {
  private readonly values = signal<Readonly<Record<string, string>>>({});
  value(id: string | undefined): string | undefined {
    const values = this.values();
    return id && Object.hasOwn(values, id) ? values[id] : undefined;
  }
  select(id: string, country: string): void {
    this.values.update((values) => ({ ...values, [id]: country }));
  }
  clear(id?: string): void {
    this.values.update((values) =>
      id
        ? Object.fromEntries(
            Object.entries(values).filter(([key]) => key !== id),
          )
        : {},
    );
  }
  retain(ids: readonly string[]): void {
    this.values.update((values) =>
      Object.fromEntries(
        Object.entries(values).filter(([key]) => ids.includes(key)),
      ),
    );
  }
}
