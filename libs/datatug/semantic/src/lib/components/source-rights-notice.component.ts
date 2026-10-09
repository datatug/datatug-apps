import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  decodeSourceRightsEvidence,
  type SourceRightsEvidence,
} from '../../contract/source-rights';

/** Reads only captured response evidence; it never consults a selected plan,
 * follows a terms URL, or changes source/execution admission. */
@Component({
  selector: 'sneat-datatug-source-rights-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  styles: [
    '.terms-text { white-space: pre-wrap; overflow-wrap: anywhere; } article { margin-block: 1rem; }',
  ],
  template: `
    <section aria-label="Source data terms" data-testid="source-rights-notice">
      @if (decoded().error) {
        <h3>Source data terms</h3>
        <p role="alert">
          Source data terms could not be verified: malformed or unsafe evidence.
        </p>
      } @else if (compact()) {
        @if (decoded().evidence.sourceRights?.length) {
          <details data-testid="source-rights-details">
            <summary>Source licences</summary>
            <p>
              Licences apply to the source data. Check each source before
              sharing or reusing query results.
            </p>
            <ng-container *ngTemplateOutlet="declarations" />
          </details>
        }
      } @else {
        <h3>Source data terms</h3>
        <p>
          These declarations describe source data. They do not assign a licence
          to the joined or derived result.
        </p>
        @if (!decoded().evidence.sourceRights?.length) {
          <p>Source data terms not declared.</p>
        }
        <ng-container *ngTemplateOutlet="declarations" />
      }
      <ng-template #declarations>
        @for (right of decoded().evidence.sourceRights; track right.sourceId) {
          <article>
            <h4>
              {{ right.source.databaseId || right.source.serverId
              }}{{
                right.source.recordset ? ' / ' + right.source.recordset : ''
              }}
            </h4>
            <p>{{ right.source.serverId }} · {{ right.sourceId }}</p>
            <p>
              {{ usage(right.sourceId) }} ·
              {{ right.declarationScope }} declaration ·
              {{ right.evidenceOrigin }} metadata
            </p>
            @if (right.declaration.name) {
              <p>{{ right.declaration.name }}</p>
            }
            @if (right.declaration.spdx) {
              <p>{{ right.declaration.spdx }}</p>
            }
            @if (right.declaration.url) {
              <a
                [href]="right.declaration.url"
                target="_blank"
                rel="noopener noreferrer"
                >Source terms (external)</a
              >
            }
            @if (right.attribution; as notice) {
              <p class="terms-text">Source credit: {{ notice.text }}</p>
              @if (notice.url) {
                <a [href]="notice.url" target="_blank" rel="noopener noreferrer"
                  >Source attribution (external)</a
                >
              }
            }
            @if (right.freeSource; as notice) {
              <p class="terms-text">{{ notice.text }}</p>
              <a [href]="notice.url" target="_blank" rel="noopener noreferrer"
                >Original free source (external)</a
              >
            }
            @for (change of right.transformations; track $index) {
              <p class="terms-text">Transformation: {{ change }}</p>
            }
            @if (right.declaration.text) {
              <details>
                <summary>Source terms text</summary>
                <p class="terms-text">{{ right.declaration.text }}</p>
              </details>
            }
            @if (right.pins.length) {
              <details>
                <summary>Captured source evidence</summary>
                @for (pin of right.pins; track $index) {
                  <p>
                    {{ pin.role }} · {{ pin.repository }} at
                    {{ pin.revision }} · {{ pin.path }} · SHA256
                    {{ pin.sha256 }}
                  </p>
                }
              </details>
            }
          </article>
        }
        @for (id of undeclared(); track id) {
          <p>Source data terms not declared: {{ id }}</p>
        }
      </ng-template>
    </section>
  `,
})
export class SourceRightsNoticeComponent {
  readonly evidence = input<SourceRightsEvidence | undefined>();
  readonly compact = input(false);
  readonly decoded = computed(() => {
    try {
      return {
        evidence: decodeSourceRightsEvidence(
          (this.evidence() as Record<string, unknown>) ?? {},
        ),
        error: false,
      };
    } catch {
      return { evidence: {} as SourceRightsEvidence, error: true };
    }
  });
  readonly undeclared = computed(() =>
    (this.decoded().evidence.usedSourceIds ?? []).filter(
      (id) =>
        !this.decoded().evidence.sourceRights?.some(
          (right) => right.sourceId === id,
        ),
    ),
  );
  usage(id: string): string {
    const used = this.decoded().evidence.usedSourceIds;
    return used === undefined
      ? 'Usage not reported'
      : used.includes(id)
        ? 'Used by this result'
        : 'Planned input; not reported used';
  }
}
