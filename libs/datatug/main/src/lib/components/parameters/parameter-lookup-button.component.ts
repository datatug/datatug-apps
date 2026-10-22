import {
  ChangeDetectionStrategy,
  Component,
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
import { AgentService } from '../../services/repo/agent.service';
import { pickedParameterValue } from './parameter-lookup-model';
import { ParameterLookupService, type ParameterLookupHost } from './parameter-lookup.service';

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
  providers: [ParameterLookupService, AgentService],
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
  private readonly lookup = inject(ParameterLookupService);
  private readonly injector = inject(Injector);

  readonly parameter = input.required<IParameterDef>();
  readonly context = input<ParameterLookupHost>({});
  readonly disabled = input(false);
  /** The input's current text, preselected in the list when present. */
  readonly currentValue = input<string | undefined>(undefined);
  readonly picked = output<ParameterLookupPick>();

  private readonly button = viewChild<ElementRef<HTMLIonButtonElement>>('button');
  readonly available = signal(false);
  readonly opening = signal(false);
  readonly label = computed(() => `Find ${this.parameter().title || this.parameter().id}`);

  private availabilityGeneration = 0;

  constructor() {
    effect(() => {
      const parameter = this.parameter();
      const host = this.context();
      // No reset to false here: a new context object with the same content must not make the button flicker.
      const generation = ++this.availabilityGeneration;
      this.lookup.isAvailable(parameter, host).then(
        (available) => {
          if (generation === this.availabilityGeneration) this.available.set(available);
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
      const result = await this.lookup.open(parameter, this.context(), this.currentValue());
      if (result) {
        const checked = pickedParameterValue(parameter, result.value);
        if ('value' in checked) this.picked.emit({ value: checked.value, key: result.value });
      }
    } catch (e) {
      this.injector.get<IErrorLogger>(ErrorLogger).logError(e, 'Failed to open the parameter lookup');
    } finally {
      this.opening.set(false);
      setTimeout(() => this.focusButton(), 0);
    }
  }

  private focusButton(): void {
    const el = this.button()?.nativeElement;
    const inner = el?.shadowRoot?.querySelector('button') as HTMLElement | null | undefined;
    (inner ?? el)?.focus();
  }
}
