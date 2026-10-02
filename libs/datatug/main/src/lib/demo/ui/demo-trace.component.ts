import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { IonSpinner } from '@ionic/angular';
import type { TraceStep } from '../../chat/chat-trace.types';
import type { DemoLang } from '../demo-scenarios';
import { renderMessage, renderTraceMessage } from '../trace/demo-messages';
import { DemoProvenanceComponent } from './demo-provenance.component';
import { DemoStepEvidenceComponent } from './demo-step-evidence.component';

const MARKS = { ok: '✓', warning: '!', failed: '×', skipped: '–', running: '' } as const;

/** The investigation trace: one line per step, each expandable to its evidence. No model prose anywhere. */
@Component({
  selector: 'sneat-datatug-demo-trace',
  templateUrl: './demo-trace.component.html',
  styleUrls: ['./demo-trace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSpinner, DemoProvenanceComponent, DemoStepEvidenceComponent],
})
export class DemoTraceComponent {
  readonly steps = input.required<readonly TraceStep[]>();
  readonly lang = input<DemoLang>('en');
  /** True when no step used a model or spent tokens: shown as the zero-AI line. */
  readonly noAi = input(false);
  readonly done = input(false);

  private readonly open = signal<ReadonlySet<string>>(new Set());
  readonly showNoAi = computed(() => this.done() && this.noAi());

  t(key: string, params: Readonly<Record<string, string | number>> = {}): string {
    return renderMessage(this.lang(), key, params);
  }
  text(step: TraceStep): string { return renderTraceMessage(this.lang(), step.message); }
  mark(step: TraceStep): string { return MARKS[step.status]; }
  isOpen(step: TraceStep): boolean { return this.open().has(step.id); }
  toggle(step: TraceStep): void {
    this.open.update((current) => {
      const next = new Set(current);
      if (!next.delete(step.id)) next.add(step.id);
      return next;
    });
  }
  duration(step: TraceStep): string | undefined {
    return step.durationMs && step.durationMs >= 1 ? this.t('trace.duration', { ms: step.durationMs }) : undefined;
  }
}
