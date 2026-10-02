import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { DemoLang } from '../demo-scenarios';
import type { Observation } from '../investigation/observations';
import { renderMessage, renderTraceMessage } from '../trace/demo-messages';

/** Observations about the result, each linked to the rows it rests on. Computed, never written by AI. */
@Component({
  selector: 'sneat-datatug-demo-observations',
  templateUrl: './demo-observations.component.html',
  styleUrls: ['./demo-observations.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoObservationsComponent {
  readonly observations = input.required<readonly Observation[]>();
  readonly lang = input<DemoLang>('en');
  readonly activeId = input<string | undefined>();
  readonly show = output<Observation>();

  t(key: string): string { return renderMessage(this.lang(), key); }
  text(observation: Observation): string { return renderTraceMessage(this.lang(), observation.message); }
}
