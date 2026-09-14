import { Component, input } from '@angular/core';
import { RouterLink, type Params } from '@angular/router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
} from '@ionic/angular';
import type {
  IncidentEvidenceTarget,
  IncidentHypothesisView,
  IncidentProjectTarget,
} from '../../../incidents/incident-evidence-targets';
import type { IncidentStatusSentence } from '../../../incidents/incident-status-projection';
import type {
  IncidentFactView,
  IncidentParticipant,
  IncidentStreamItem,
} from '../../../incidents/models';

@Component({
  selector: 'sneat-datatug-incident-read-panels',
  templateUrl: './incident-read-panels.component.html',
  imports: [
    RouterLink,
    IonButton,
    IonCard,
    IonCardContent,
    IonItem,
    IonLabel,
    IonList,
    IonNote,
  ],
})
export class IncidentReadPanelsComponent {
  readonly statusSentences = input<readonly IncidentStatusSentence[]>([]);
  readonly statusLoading = input(false);
  readonly statusError = input<string | undefined>(undefined);
  readonly events = input<readonly IncidentStreamItem[] | undefined>(undefined);
  readonly timelineLoading = input(false);
  readonly timelineError = input<string | undefined>(undefined);
  readonly hypotheses = input<readonly IncidentHypothesisView[]>([]);
  readonly evidence = input<readonly IncidentEvidenceTarget[]>([]);
  readonly participants = input<readonly IncidentParticipant[]>([]);
  readonly projects = input<readonly IncidentProjectTarget[]>([]);
  readonly recordCommands = input<readonly string[] | undefined>(undefined);
  readonly recordQueryParams = input<Params | undefined>(undefined);

  protected factValue(fact: IncidentFactView): string {
    return 'redacted' in fact.value ? 'redacted' : String(fact.value.value);
  }

  protected eventSummary(item: IncidentStreamItem): string {
    const event = item.event;
    if (
      event.type === 'note.added' &&
      event.payload &&
      typeof event.payload === 'object' &&
      'body' in event.payload &&
      typeof event.payload.body === 'string'
    ) {
      return event.payload.body;
    }
    return event.type;
  }
}
