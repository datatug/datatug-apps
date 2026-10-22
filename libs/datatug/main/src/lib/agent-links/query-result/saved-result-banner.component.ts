import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonText } from '@ionic/angular';
import type { LinkProblem } from '../agent-link-api.service';
import { LinkProblemComponent } from '../link-problem/link-problem.component';
import { RESULT_VIEWS, ResultPrompt, VIEW_QUERY_PARAM } from './query-result';
import type { ResultEditorMode } from './result-editor';

/** What the banner above the query editor says about the saved result the editor was opened from. */
export type SavedResultBannerState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'problem'; readonly problem: LinkProblem }
  | {
      readonly kind: 'shown';
      readonly mode: ResultEditorMode;
      readonly savedAt: string;
      readonly rowsKept: number;
      readonly hasMore: boolean;
      readonly notice?: string;
      /** The database and environment the query ran in (`chinook-local · environment local`), when the project has them. */
      readonly database?: string;
      readonly summary: readonly string[];
      /** Parameters whose list values the editor cannot hold; named, never their values. */
      readonly skippedParameters: readonly string[];
      readonly prompt?: ResultPrompt;
    };

const OTHER_VIEWS = RESULT_VIEWS.filter((v) => v !== 'table');
const VIEW_LABEL: Record<string, string> = {
  record: 'Record',
  columns: 'Columns',
  sources: 'Sources',
  related: 'Related',
};

/**
 * The strip above the query editor when it was opened from a stored query result (`?result=`): a "saved result from
 * <time>" badge, a named message when the editor has no query to show, the saved query's read-only summary, the
 * prompt in a collapsible section, and links to the other views of the result. The prompt and every other value
 * reach the page only as interpolated text: no HTML is ever built from them.
 */
@Component({
  selector: 'sneat-datatug-saved-result-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonText, LinkProblemComponent],
  template: `
    @let s = state();
    @if (s.kind === 'loading') {
      <p class="saved-result-line" data-testid="saved-result-loading">
        <ion-text color="medium">Loading the saved result…</ion-text>
      </p>
    } @else if (s.kind === 'problem') {
      <sneat-datatug-link-problem
        [problem]="s.problem"
        [storeId]="storeId()"
        (checkAgain)="checkAgain.emit()"
      />
    } @else {
      <section class="saved-result" data-testid="saved-result-banner">
        <div class="saved-result-line">
          <span class="saved-result-badge" data-testid="saved-result-badge"
            >Saved result from {{ savedAtLabel() }}</span
          >
          <span data-testid="saved-result-rows">
            {{ s.rowsKept }} {{ s.rowsKept === 1 ? 'row' : 'rows' }}
            @if (s.hasMore) {
              · more rows exist
            }
          </span>
          @if (s.mode === 'draft') {
            <span data-testid="saved-result-draft-hint"
              >· save the query to run it again</span
            >
          }
          <nav
            class="saved-result-views"
            aria-label="Other views of this result"
          >
            @for (v of otherViews; track v) {
              <a
                [routerLink]="resultCommands()"
                [queryParams]="viewParams(v)"
                [attr.data-testid]="'saved-result-view-' + v"
                >{{ viewLabel(v) }}</a
              >
            }
          </nav>
        </div>
        @if (s.database) {
          <p class="saved-result-database" data-testid="saved-result-database">
            Database {{ s.database }}
          </p>
        }
        @if (s.notice) {
          <p class="saved-result-notice" data-testid="saved-result-notice">
            {{ s.notice }}
          </p>
        }
        @if (s.mode === 'rows-only' || s.mode === 'saved') {
          <ul class="saved-result-summary" data-testid="saved-result-summary">
            @for (line of s.summary; track line) {
              <li>{{ line }}</li>
            }
          </ul>
        }
        @if (s.skippedParameters.length) {
          <p class="saved-result-notice" data-testid="saved-result-skipped">
            List parameters ({{ s.skippedParameters.join(', ') }}) are not
            restored in the editor.
          </p>
        }
        @if (s.prompt; as prompt) {
          <details
            open
            class="saved-result-prompt"
            data-testid="saved-result-prompt"
          >
            <summary>Prompt</summary>
            <pre data-testid="saved-result-prompt-text">{{ prompt.text }}</pre>
            @if (prompt.truncated) {
              <p data-testid="saved-result-prompt-truncated">
                <ion-text color="medium"
                  >The prompt was cut short when it was saved.</ion-text
                >
              </p>
            }
          </details>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 0.5rem 1rem 0;
    }
    .saved-result-line {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 0.75rem;
      margin: 0;
    }
    .saved-result-badge {
      background: var(--ion-background-color-step-150, #e6e6e6);
      border-radius: 999px;
      color: var(--ion-text-color, #222);
      font-weight: 600;
      padding: 0.1rem 0.6rem;
    }
    .saved-result-views {
      display: flex;
      gap: 0.75rem;
      margin-left: auto;
    }
    .saved-result-notice,
    .saved-result-database {
      margin: 0.4rem 0 0;
    }
    .saved-result-summary {
      color: var(--dt-text-muted, #666);
      margin: 0.4rem 0 0;
      padding-left: 1.2rem;
    }
    .saved-result-prompt {
      margin-top: 0.5rem;
    }
    .saved-result-prompt summary {
      cursor: pointer;
      font-weight: 600;
    }
    .saved-result-prompt pre {
      margin: 0.4rem 0 0;
      max-height: 12rem;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
  `,
})
export class SavedResultBannerComponent {
  readonly state = input.required<SavedResultBannerState>();
  readonly storeId = input.required<string>();
  readonly resultId = input.required<string>();
  readonly checkAgain = output<void>();

  readonly otherViews = OTHER_VIEWS;

  /** The result page of this result (`/store/<agent>/result/<id>`): the other views live there. */
  readonly resultCommands = computed(() => [
    '/store',
    this.storeId(),
    'result',
    this.resultId(),
  ]);

  readonly savedAtLabel = computed(() => {
    const s = this.state();
    if (s.kind !== 'shown') return '';
    const d = new Date(s.savedAt);
    return Number.isNaN(d.getTime()) ? s.savedAt : d.toLocaleString();
  });

  viewLabel(view: string): string {
    return VIEW_LABEL[view] ?? view;
  }

  viewParams(view: string): Record<string, string> {
    return { [VIEW_QUERY_PARAM]: view };
  }
}
