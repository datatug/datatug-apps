import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IonButton, IonCard, IonCardContent } from '@ionic/angular';
import { SCENARIOS, type DemoLang, type DemoScenario } from '../demo-scenarios';
import { renderMessage } from '../trace/demo-messages';

/** The curated scenarios, shown when a visitor arrives without one this release can run. */
@Component({
  selector: 'sneat-datatug-demo-chooser',
  templateUrl: './demo-chooser.component.html',
  styleUrls: ['./demo-chooser.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCard, IonCardContent, IonButton],
})
export class DemoChooserComponent {
  readonly lang = input<DemoLang>('en');
  /** What to tell the visitor about why they are choosing (computed by the page). */
  readonly notice = input('');
  readonly choose = output<DemoScenario>();

  readonly scenarios = SCENARIOS;
  t(key: string): string { return renderMessage(this.lang(), key); }
  question0(scenario: DemoScenario): string { return scenario.question[this.lang()]; }
}
