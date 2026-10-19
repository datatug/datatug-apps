import { Injectable } from '@angular/core';

/** A dataset's optional offer stays dismissed for this browser tab's session. */
@Injectable({ providedIn: 'root' })
export class ProjectCopyOfferSessionService {
  // Preserve the preference between component instances even when storage is denied.
  private readonly preferences = new Map<string, boolean>();

  dismissed(dataset: string): boolean {
    const key = this.key(dataset);
    const preference = this.preferences.get(key);
    if (preference !== undefined) return preference;
    try {
      return sessionStorage.getItem(key) === 'dismissed';
    } catch {
      return false;
    }
  }

  setDismissed(dataset: string, dismissed: boolean): void {
    const key = this.key(dataset);
    this.preferences.set(key, dismissed);
    try {
      if (dismissed) sessionStorage.setItem(key, 'dismissed');
      else sessionStorage.removeItem(key);
    } catch {
      // The in-memory preference still applies while this app is open.
    }
  }

  private key(dataset: string): string {
    return `datatug:demo-project-copy:${dataset.trim().toLowerCase()}`;
  }
}
