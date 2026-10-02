import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ProvenanceClass } from '../../chat/chat-trace.types';
import type { DemoLang } from '../demo-scenarios';
import { renderMessage } from '../trace/demo-messages';
import { PROVENANCE_GLYPH } from '../trace/provenance-glyphs';

/** A provenance marker: a distinct silhouette per class, with a text alternative, so meaning never rests on colour alone. */
@Component({
  selector: 'sneat-datatug-demo-provenance',
  template: `
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path [attr.d]="glyph().d" [attr.fill]="glyph().fill ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" [attr.stroke-dasharray]="glyph().dash ? '2 2' : null" />
    </svg>
    <span class="sr">{{ label() }}</span>`,
  styleUrls: ['./demo-provenance.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-prov]': 'provenance()', '[attr.title]': 'label()' },
})
export class DemoProvenanceComponent {
  readonly provenance = input.required<ProvenanceClass>();
  readonly lang = input<DemoLang>('en');
  glyph(): (typeof PROVENANCE_GLYPH)[ProvenanceClass] { return PROVENANCE_GLYPH[this.provenance()]; }
  label(): string { return renderMessage(this.lang(), `provenance.${this.provenance()}`); }
}
