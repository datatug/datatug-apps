import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import {
  DetectiveClientService,
  detectiveErrorMessage,
} from '../../detective/detective-client.service';
import { useDetectivePageContext } from '../../detective/detective-page-context';
import { DetectiveState } from '../../detective/models';

/** Current server capability is an affordance; every asset operation reauthorizes. */
@Injectable()
export class HostedBoardScope {
  readonly page = useDetectivePageContext();
  private readonly client = inject(DetectiveClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly state = signal<DetectiveState | undefined>(undefined);
  private readonly stateIdentity = signal<string | undefined>(undefined);
  readonly error = signal('');
  readonly loading = signal(false);
  private readonly revision = signal(0);
  readonly environment = computed(() => this.params().get('environment') || '');
  readonly environments = computed(() => this.state()?.environments ?? []);
  readonly admitted = computed(
    () =>
      !!this.page.context()?.principal &&
      this.stateIdentity() === this.page.identity() &&
      !!this.state()?.capabilities.canRead &&
      this.environments().includes(this.environment()),
  );
  readonly canWrite = computed(
    () => this.admitted() && this.state()?.capabilities.canWrite === true,
  );
  readonly identity = computed(() =>
    JSON.stringify([this.page.identity(), this.environment()]),
  );
  constructor() {
    effect((onCleanup) => {
      this.revision();
      const context = this.page.context();
      const identity = this.page.identity();
      this.stateIdentity.set(undefined);
      this.state.set(undefined);
      this.error.set('');
      this.loading.set(false);
      if (!context || context.kind !== 'cloud' || !context.principal) return;
      let cancelled = false;
      this.loading.set(true);
      void firstValueFrom(this.client.state(context))
        .then((state) => {
          if (!cancelled) {
            this.stateIdentity.set(identity);
            this.state.set(state);
          }
        })
        .catch((error) => {
          if (!cancelled) this.error.set(detectiveErrorMessage(error, true));
        })
        .finally(() => {
          if (!cancelled) this.loading.set(false);
        });
      onCleanup(() => {
        cancelled = true;
      });
    });
  }
  refresh(): void {
    this.revision.update((n) => n + 1);
  }
  deny(error: unknown): void {
    this.stateIdentity.set(undefined);
    this.state.set(undefined);
    this.error.set(detectiveErrorMessage(error, true));
  }
  choose(environment: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { environment: environment || null },
      queryParamsHandling: 'merge',
    });
  }
}
