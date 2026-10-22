import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { OriginalEvidencePresentation } from './source-evidence-presentation';

/** Source-neutral records and byte provenance. No collection/field-name inference. */
@Component({
  selector: 'sneat-original-evidence-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (presentation(); as data) {
    <section aria-label="Original evidence">
      <header>
        <h4>Original evidence</h4>
        <span
          >{{ data.status === 'available' ? 'Available' : 'Unavailable' }}
          @if (data.log) {
            · {{ data.log.parseStatus }}
          }
        </span>
      </header>
      @if (data.status === 'unavailable') {
        <p role="status">
          Original evidence unavailable: {{ data.reason }}. The authorized
          retained result remains below.
        </p>
      } @else {
        @if (data.summary) {
          <p>{{ data.summary }}</p>
        }
        @for (notice of data.notices || []; track $index) {
          <p>{{ notice }}</p>
        }
        @for (record of data.records || []; track $index) {
          <h5>{{ record.title }}</h5>
          <dl>
            @for (field of record.facts; track field.label) {
              <dt>{{ field.label }}</dt>
              <dd [class.observation-bound]="field.emphasized">
                {{ field.value }}
              </dd>
            }
          </dl>
          <details>
            <summary>Complete original {{ record.title }} record</summary>
            <dl>
              @for (field of record.fields; track field.label) {
                <dt>{{ field.label }}</dt>
                <dd>{{ field.value }}</dd>
              }
            </dl>
          </details>
        }
        @if (data.emptyMessage) {
          <p>{{ data.emptyMessage }}</p>
        }
        @if (data.log; as log) {
          <details>
            <summary>Original log bytes and provenance</summary>
            <p>
              {{ log.artifact }} · bytes [{{ log.byteStart }},
              {{ log.byteEnd }}) of {{ log.artifactBytes }} · {{ log.parser }} /
              {{ log.parseStatus }}
            </p>
            <p>
              SHA256 <code>{{ log.artifactSHA256 }}</code>
            </p>
            <p>
              Source reference <code>{{ log.sourceRef }}</code>
            </p>
            @if (log.text !== undefined) {
              <pre aria-label="Original log text">{{ log.text }}</pre>
            } @else {
              <p role="status">
                Original bytes are not valid UTF8 text. Exact bytes remain
                available as base64 below.
              </p>
            }
            <details>
              <summary>Exact original bytes (base64)</summary>
              <pre>{{ log.rawBase64 }}</pre>
            </details>
          </details>
        }
      }
    </section>
  }`,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
      color: var(--ion-text-color);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    h4,
    h5 {
      margin-block: 0.5rem;
    }
    p,
    dl {
      font-size: 0.85rem;
      line-height: 1.45;
    }
    dl {
      display: grid;
      grid-template-columns: minmax(7rem, auto) minmax(0, 1fr);
      gap: 0.25rem 0.75rem;
    }
    dt {
      font-weight: 600;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .observation-bound {
      font-variant-numeric: tabular-nums;
    }
    pre,
    code {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    details {
      margin-block: 0.5rem;
    }
    @container (max-width:26rem) {
      dl {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class OriginalEvidencePanelComponent {
  readonly presentation = input<OriginalEvidencePresentation>();
}
