import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';
import { POSTMORTEM_SHARE_TOKEN } from './postmortem-share-token';
export { POSTMORTEM_SHARE_TOKEN } from './postmortem-share-token';
import type { PublicReport } from './postmortem.models';
/** Deliberately has no Work, Context Bag, identity or analytics dependency. */
@Component({
  selector: 'sneat-postmortem-shared',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TitleCasePipe],
  template: `<main>
    <h1>{{ 'Shared postmortem' }}</h1>
    @if (loading()) {
      <p role="status">Loading approved report…</p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    @if (report(); as report) {
      @for (section of report.content.sections; track section.name) {
        <section>
          <h2>{{ section.name.replaceAll('-', ' ') | titlecase }}</h2>
          <p class="classification">{{ section.classification }}</p>
          <p>{{ section.text }}</p>
        </section>
      }
      @for (label of report.content.safeCitationLabels || []; track label) {
        <p>{{ label }}</p>
      }
      @for (summary of report.content.proposalSummaries || []; track summary) {
        <p>{{ summary }}</p>
      }
    }
  </main>`,
  styles: `
    main {
      max-width: 52rem;
      margin: auto;
      padding: 1.5rem;
      font: 1rem/1.6 system-ui;
    }
    p {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .classification {
      font-size: 0.85rem;
      color: #666;
    }
  `,
})
export class PostmortemSharedComponent {
  private readonly http = inject(HttpClient);
  private readonly base = inject(DatatugApiBaseUrl);
  readonly report = signal<PublicReport | undefined>(undefined);
  readonly loading = signal(true);
  readonly error = signal('');
  constructor() {
    void this.load(inject(POSTMORTEM_SHARE_TOKEN, { optional: true }) ?? '');
  }
  private async load(token: string) {
    try {
      if (
        !/^[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{40,128}$/.test(
          token,
        )
      )
        throw new Error();
      this.report.set(
        await firstValueFrom(
          this.http.get<PublicReport>(
            this.base + 'datatug/postmortems/shared',
            { headers: { Authorization: `Bearer ${token}` } },
          ),
        ),
      );
    } catch {
      this.error.set('This report link is unavailable, expired or revoked.');
    } finally {
      this.loading.set(false);
    }
  }
}
