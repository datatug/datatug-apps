import { Injectable } from '@angular/core';

/** A dataset's optional offer stays dismissed for this browser tab's session. */
@Injectable({ providedIn: 'root' })
export class ProjectCopyOfferSessionService {
  // Preserve the preference between component instances even when storage is denied.
  private readonly preferences = new Map<string, boolean>();

  dismissed(dataset: string): boolean {
    const preference = this.preferences.get(dataset);
    if (preference !== undefined) return preference;
    try {
      return sessionStorage.getItem(this.key(dataset)) === 'dismissed';
    } catch {
      return false;
    }
  }

  setDismissed(dataset: string, dismissed: boolean): void {
    this.preferences.set(dataset, dismissed);
    try {
      if (dismissed) sessionStorage.setItem(this.key(dataset), 'dismissed');
      else sessionStorage.removeItem(this.key(dataset));
    } catch {
      // The in-memory preference still applies while this app is open.
    }
  }

  private key(dataset: string): string {
    return `datatug:demo-project-copy:${dataset}`;
  }
}
