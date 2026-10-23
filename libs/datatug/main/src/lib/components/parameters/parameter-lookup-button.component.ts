import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular';
import { ErrorLogger, type IErrorLogger } from '@sneat/core';
import type { TypedValue } from '@sneat/datatug-semantic';
import type { IParameterDef } from '../../models/definition/parameter';
import { isScalarLookupParameter, pickedParameterValue } from './parameter-lookup-model';
import { PARAMETER_LOOKUP_LOADER, type ParameterLookupApi } from './parameter-lookup-loader';
import type { ParameterLookupHost } from './parameter-lookup.service';

/** What the host writes into its input after a pick. */
export interface ParameterLookupPick {
  /** The value in the parameter's own type: a number for `integer`, otherwise text. */
  readonly value: string | number;
  readonly key: TypedValue;
}

/**
 * The `[...]` pick button beside a parameter input (datatug/backstage
 * spec/features/parameter-lookup, REQ:meaning-keyed-pick-button,
 * REQ:accessible-picker). It renders nothing unless a lookup can work for this
 * parameter on this host, opens the lookup dialog, emits the picked value, and
 * returns focus to itself when the dialog closes.
 */
@Component({
  selector: 'sneat-datatug-parameter-lookup-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonIcon],
  template: `
    @if (available()) {
      <ion-button
        #button
        fill="clear"
        color="medium"
        data-testid="parameter-lookup-button"
        [attr.aria-label]="label()"
        [title]="label()"
        [disabled]="disabled()"
        (click)="open()"
      >
        <ion-icon name="ellipsis-horizontal-outline" slot="icon-only" />
      </ion-button>
    }
  `,
  styles: [':host { display: contents; }'],
})
export class ParameterLookupButtonComponent {
  private readonly injector = inject(Injector);
  private readonly loader = inject(PARAMETER_LOOKUP_LOADER);
  /** The lookup machinery, loaded on first need (a separate chunk; never at route start). */
  // Signals, not plain fields: they are written from async callbacks (zoneless rule), though no template reads them.
  private readonly lookupApi = signal<Promise<ParameterLookupApi> | undefined>(undefined);
  private readonly destroyed = signal(false);

  readonly parameter = input.required<IParameterDef>();
  readonly context = input<ParameterLookupHost>({});
  readonly disabled = input(false);
  /** The input's current text, preselected in the list when present. */
  readonly currentValue = input<string | undefined>(undefined);
  readonly picked = output<ParameterLookupPick>();

  private readonly button = viewChild<ElementRef<HTMLIonButtonElement>>('button');
  readonly available = signal(false);
  readonly opening = signal(false);
  /** True when the parameter's meaning was inferred from its name, not declared. */
  readonly inferred = signal(false);
  readonly label = computed(() =>
    `Find ${this.parameter().title || this.parameter().id}${this.inferred() ? ' (meaning guessed from its name)' : ''}`);

  private availabilityGeneration = 0;

  constructor() {
    // A dialog must not outlive the input it fills (for example, the board navigated away).
    inject(DestroyRef).onDestroy(() => {
      this.destroyed.set(true);
      void this.lookupApi()?.then((api) => api.dispose(), () => undefined);
    });
    effect(() => {
      const parameter = this.parameter();
      const host = this.context();
      // No reset to false here: a new context object with the same content must not make the button flicker.
      const generation = ++this.availabilityGeneration;
      // A parameter that can never have a picker loads nothing.
      if (!parameter.lookup && !isScalarLookupParameter(parameter)) {
        this.available.set(false);
        return;
      }
      this.lookup().then((api) => api.availability(parameter, host)).then(
        ({ available, inferred }) => {
          if (generation !== this.availabilityGeneration) return;
          this.available.set(available);
          this.inferred.set(inferred);
        },
        () => undefined,
      );
    });
  }

  async open(): Promise<void> {
    if (this.opening()) return;
    this.opening.set(true);
    try {
      const parameter = this.parameter();
      const api = await this.lookup();
      if (this.destroyed()) return;
      const result = await api.open(parameter, this.context(), this.currentValue());
      if (result) {
        const checked = pickedParameterValue(parameter, result.value);
        if ('value' in checked) this.picked.emit({ value: checked.value, key: result.value });
        else this.injector.get<IErrorLogger>(ErrorLogger).logError(new Error(checked.error), 'Parameter lookup pick dropped', { show: false });
      }
    } catch (e) {
      this.injector.get<IErrorLogger>(ErrorLogger).logError(e, 'Failed to open the parameter lookup');
    } finally {
      this.opening.set(false);
      setTimeout(() => this.focusButton(), 0);
    }
  }

  private lookup(): Promise<ParameterLookupApi> {
    let api = this.lookupApi();
    if (!api) {
      api = this.loader(this.injector).then((loaded) => {
        if (this.destroyed()) loaded.dispose();
        return loaded;
      });
      const pending = api;
      // A failed chunk load is retried on the next need.
      pending.catch(() => {
        if (this.lookupApi() === pending) this.lookupApi.set(undefined);
      });
      this.lookupApi.set(api);
    }
    return api;
  }

  private focusButton(): void {
    const el = this.button()?.nativeElement;
    const inner = el?.shadowRoot?.querySelector('button') as HTMLElement | null | undefined;
    (inner ?? el)?.focus();
  }
}
