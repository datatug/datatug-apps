import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { useDetectivePageContext } from '../detective/detective-page-context';
import { projectPageHref } from '../nav/project-page-href';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import { equalProjectRef } from '../core/project-context';
import { SOURCE_ADAPTER_REGISTRATIONS } from './source-workspace-contract';

@Component({
  selector: 'sneat-source-entries',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styles: `
    :host {
      display: block;
      margin-block: 0.75rem;
      color: var(--ion-text-color);
    }
    h2 {
      font-size: 1rem;
      margin: 0.25rem 0;
    }
    ul {
      padding: 0;
      list-style: none;
    }
    li {
      padding-block: 0.25rem;
      overflow-wrap: anywhere;
    }
    p {
      font-size: 0.85rem;
      margin: 0.25rem 0;
    }
  `,
  template: `@if (registrations.length) {
    <section aria-label="Source actions">
      <h2>Source actions</h2>
      @if (loading()) {
        <p role="status">Checking current source access…</p>
      }
      @if (unavailable()) {
        <p role="status">
          Source actions unavailable for the current project context.
        </p>
      }
      <ul>
        @for (entry of entries(); track entry.sourceId) {
          <li>
            <a [routerLink]="entry.href">{{ entry.title }}</a>
            @if (entry.description) {
              <p>{{ entry.description }}</p>
            }
          </li>
        }
      </ul>
    </section>
  }`,
})
export class SourceEntriesComponent {
  readonly registrations = inject(SOURCE_ADAPTER_REGISTRATIONS);
  private readonly page = this.registrations.length
    ? useDetectivePageContext()
    : undefined;
  private readonly destroy = inject(DestroyRef);
  private readonly generation = signal(0);
  private readonly held = signal<
    | {
        key: string;
        items: readonly {
          sourceId: string;
          title: string;
          description?: string;
          href: string;
        }[];
      }
    | undefined
  >(undefined);
  readonly loading = signal(false);
  readonly unavailable = signal(false);
  private readonly key = computed(() =>
    JSON.stringify([
      this.page?.identity(),
      this.page?.ref(),
      this.page?.currentEnvironment()?.id,
      this.generation(),
    ]),
  );
  readonly entries = computed(() =>
    this.held()?.key === this.key() ? this.held()?.items : [],
  );
  constructor() {
    this.page?.scopeChanges$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.held.set(undefined);
      this.generation.update((v) => v + 1);
    });
    inject(NativeSourceInvalidationService)
      .changes$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (
          this.page &&
          equalProjectRef(event.projectRef, this.page.ref()) &&
          event.actor === this.page.context()?.principal
        ) {
          this.held.set(undefined);
          this.generation.update((v) => v + 1);
        }
      });
    effect((cleanup) => {
      const key = this.key(),
        page = this.page,
        ref = page?.ref(),
        actor = page?.context()?.principal,
        identity = page?.identity(),
        environment = page?.currentEnvironment()?.id;
      this.held.set(undefined);
      this.loading.set(false);
      this.unavailable.set(false);
      if (!page || !ref || !actor || !identity) return;
      const abort = new AbortController();
      cleanup(() => abort.abort());
      this.loading.set(true);
      void Promise.allSettled(
        this.registrations.map(async (registration) => {
          if (!registration.discover) return undefined;
          const value = await registration.discover(
            {
              projectRef: structuredClone(ref),
              actor,
              identity,
              sourceId: registration.sourceId,
              ...(environment ? { environment } : {}),
            },
            abort.signal,
          );
          if (!value) return undefined;
          let href = projectPageHref(ref, ['sources', registration.sourceId]);
          if (environment)
            href += '?environment=' + encodeURIComponent(environment);
          return { sourceId: registration.sourceId, ...value, href };
        }),
      ).then((results) => {
        if (
          abort.signal.aborted ||
          this.destroy.destroyed ||
          key !== this.key()
        )
          return;
        const items = results.flatMap((result) =>
          result.status === 'fulfilled' && result.value ? [result.value] : [],
        );
        this.held.set({ key, items });
        this.unavailable.set(items.length === 0);
        this.loading.set(false);
      });
    });
  }
}
