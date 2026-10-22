import {
  DestroyRef,
  Injectable,
  InjectionToken,
  computed,
  effect,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { equalProjectRef, type IProjectRef } from '../core/project-context';
import { useDetectivePageContext } from '../detective/detective-page-context';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import {
  SOURCE_ADAPTER_REGISTRATIONS,
  type SourceBusinessClock,
} from './source-workspace-contract';

/** heterogeneous-sources REQ:source-business-clock. */
export interface BusinessClockView {
  readonly sourceId: string;
  readonly label: string;
  /** `20 May 2018 10:00 UTC` */
  readonly text: string;
  readonly at: string;
}

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `D Mon YYYY HH:MM UTC`, `:SS` only when non-zero, fractions never; undefined for anything malformed. */
export function businessClockText(at: unknown): string | undefined {
  if (typeof at !== 'string' || at.length > 40) return undefined;
  const parts = INSTANT.exec(at);
  if (!parts) return undefined;
  const [, year, month, day, hour, minute, second] = parts;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  )
    return undefined;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year} ${hour}:${minute}${second === '00' ? '' : ':' + second} UTC`;
}

/** Only `{label, at}` of a declared clock reaches the chip; anything else from the source is ignored. */
export function readBusinessClock(
  sourceId: string,
  value: SourceBusinessClock | undefined,
): BusinessClockView | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  const text = businessClockText(value.at);
  if (!label || label.length > 40 || !text) return undefined;
  return { sourceId, label, text, at: value.at };
}

/** The current project page scope the clock reads under. */
export interface BusinessClockPage {
  ref(): IProjectRef | undefined;
  identity(): string | undefined;
  context(): { principal?: string } | undefined;
  currentEnvironment(): { id: string } | undefined;
}

export const BUSINESS_CLOCK_PAGE = new InjectionToken<BusinessClockPage>(
  'business clock page scope',
  { providedIn: 'root', factory: () => useDetectivePageContext() },
);

/**
 * One shared read of every declared business clock for the current project page, so every open chip shows the
 * same value. A verified source receipt for this project and actor re-reads it; until the new read lands the
 * previous value stays, and a failed or empty read hides that clock. Provided next to the source adapter
 * registrations (SOURCE_ADAPTER_PROVIDERS), so it sees the same deployment's sources.
 */
@Injectable()
export class BusinessClockService {
  private readonly registrations = inject(SOURCE_ADAPTER_REGISTRATIONS).filter(
    (registration) => !!registration.businessClock,
  );
  // Only a deployment with a clock-declaring source reads the page scope at all.
  private readonly page = this.registrations.length
    ? inject(BUSINESS_CLOCK_PAGE)
    : undefined;
  private readonly destroy = inject(DestroyRef);
  private readonly generation = signal(0);
  private readonly scope = computed(() =>
    JSON.stringify([
      this.page?.identity(),
      this.page?.ref(),
      this.page?.context()?.principal,
      this.page?.currentEnvironment()?.id,
    ]),
  );
  private readonly held = signal<
    { scope: string; clocks: readonly BusinessClockView[] } | undefined
  >(undefined);
  readonly clocks: Signal<readonly BusinessClockView[]> = computed(() => {
    const held = this.held();
    return held && held.scope === this.scope() ? held.clocks : [];
  });

  constructor() {
    const page = this.page;
    if (!page) return;
    inject(NativeSourceInvalidationService)
      .changes$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (
          equalProjectRef(event.projectRef, page.ref()) &&
          event.actor === page.context()?.principal &&
          this.registrations.some((r) => r.sourceId === event.sourceId)
        )
          this.generation.update((value) => value + 1);
      });
    effect((cleanup) => {
      const scope = this.scope();
      this.generation();
      const ref = page.ref(),
        actor = page.context()?.principal,
        identity = page.identity(),
        environment = page.currentEnvironment()?.id;
      if (!ref || !actor || !identity) {
        this.held.set({ scope, clocks: [] });
        return;
      }
      const abort = new AbortController();
      cleanup(() => abort.abort());
      void Promise.allSettled(
        this.registrations.map(async (registration) =>
          readBusinessClock(
            registration.sourceId,
            await registration.businessClock?.(
              {
                projectRef: structuredClone(ref),
                actor,
                identity,
                sourceId: registration.sourceId,
                ...(environment ? { environment } : {}),
              },
              abort.signal,
            ),
          ),
        ),
      ).then((results) => {
        if (abort.signal.aborted || this.destroy.destroyed) return;
        this.held.set({
          scope,
          clocks: results.flatMap((result) =>
            result.status === 'fulfilled' && result.value ? [result.value] : [],
          ),
        });
      });
    });
  }
}
