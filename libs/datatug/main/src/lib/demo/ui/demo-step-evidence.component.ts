import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { TraceEvidence, TraceStep } from '../../chat/chat-trace.types';
import type { DemoLang } from '../demo-scenarios';
import { renderMessage, renderTraceMessage } from '../trace/demo-messages';

/** What one step rests on: the decision, who made it, where the knowledge came from, and each piece of evidence. */
@Component({
  selector: 'sneat-datatug-demo-step-evidence',
  templateUrl: './demo-step-evidence.component.html',
  styleUrls: ['./demo-step-evidence.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoStepEvidenceComponent {
  readonly step = input.required<TraceStep>();
  readonly lang = input<DemoLang>('en');

  t(key: string): string { return renderMessage(this.lang(), key); }
  message(message: TraceStep['message']): string { return renderTraceMessage(this.lang(), message); }
  /** Details to show as key/value rows: everything except the DTQL, which gets its own block. */
  details(evidence: TraceEvidence): readonly { key: string; value: string }[] {
    return Object.entries(evidence.detail ?? {}).filter(([key]) => key !== 'dtql').map(([key, value]) => ({ key, value: String(value) }));
  }
  dtql(evidence: TraceEvidence): string | undefined {
    const value = evidence.detail?.['dtql'];
    return typeof value === 'string' ? value : undefined;
  }
}
