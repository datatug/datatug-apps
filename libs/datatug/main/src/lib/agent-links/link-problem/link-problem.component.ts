import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonText,
} from '@ionic/angular';
import { AgentTableRef, LinkProblem } from '../agent-link-api.service';
import { qualifiedTableName } from '../table-identity';

/** What the page tells the person for a problem: a headline and hints, built from the link's identifiers only. */
export interface LinkProblemText {
  readonly title: string;
  readonly hints: readonly string[];
}

/**
 * Whether this browser may block a page on https://datatug.app from reaching an agent on 127.0.0.1 (Feature
 * claude-mod-web-links, Decision 3: Safari/WebKit and Brave; the advice is Chrome). Every browser on iOS is WebKit.
 */
export function browserMayBlockLoopback(
  nav: Pick<Navigator, 'userAgent'> & { brave?: unknown } = navigator,
): boolean {
  if (nav.brave) return true;
  const ua = nav.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\/|FxiOS\//.test(ua);
}

/** The agent address of a store id such as `http-127.0.0.1:8989`, for the text: `127.0.0.1:8989`. */
function agentAddress(storeId: string | undefined): string {
  return storeId ? storeId.replace(/^https?-/, '') : 'this computer';
}

/**
 * The text of each named state (REQ:ui-unresolved-states). It names only what the link itself names (agent address,
 * project, environment, database, table): never a key value, a row, or anything the agent answered.
 */
export function linkProblemText(
  problem: LinkProblem,
  ref: AgentTableRef | undefined,
  blockingBrowser: boolean,
): LinkProblemText {
  const table = ref ? qualifiedTableName(ref.table) : 'the table of this link';
  const db = ref?.source ?? 'the database of this link';
  const project = ref?.project ?? 'of this link';
  const env = ref?.env ?? 'of this link';
  switch (problem) {
    case 'agent-unreachable':
      return {
        title: `The DataTug agent at ${agentAddress(ref?.storeId)} cannot be reached.`,
        hints: [
          'Start it with: datatug daemon start, then press Check again. A started agent may not accept this link any more; then press Check again on the card in Claude Code for a fresh link.',
          blockingBrowser
            ? 'This browser may block datatug.app from reaching the agent, and the built-in browser of AI tools cannot reach a local agent at all. Open the link in Chrome on the computer that runs the agent.'
            : 'If the agent is running, the request may be blocked by the browser or an extension (an ad blocker, Brave Shields, or the built-in browser of an AI tool, which cannot reach a local agent). Open the link in Chrome.',
        ],
      };
    case 'link-expired':
      return {
        title: 'This link has expired or was already used.',
        hints: ['Press Check again on the card in Claude Code for a fresh link.'],
      };
    case 'project-not-found':
      return {
        title: `The agent has no project ${project}.`,
        hints: [
          'The agent on this port may serve other projects. Stop it, then run: datatug daemon start.',
        ],
      };
    case 'database-not-found':
      return {
        title: `Project ${project} has no database ${db} in environment ${env}.`,
        hints: ['Add it with: datatug db add.'],
      };
    case 'table-not-found':
      return {
        title: `Database ${db} has no table ${table}.`,
        hints: ['The table may have been renamed or dropped.'],
      };
    case 'record-not-found':
      return {
        title: `${table} has no record with the key in this link.`,
        hints: ['The record may have been deleted or its key changed.'],
      };
    case 'bad-key':
      return {
        title: `The key in this link is not a primary key of ${table}.`,
        hints: ['Press Check again on the card in Claude Code for a fresh link.'],
      };
    default:
      return {
        title: 'The DataTug agent could not read this view.',
        hints: ['Press Check again. If it keeps failing, see the agent log: datatug daemon status.'],
      };
  }
}

/**
 * A named state on the page a card's link opened, in place of the view it cannot show: a plain message, its hints,
 * the state name and a Check again button. The page stays on the same address; nothing is written or started.
 */
@Component({
  selector: 'sneat-datatug-link-problem',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonText, IonButton],
  template: `
    <ion-card data-testid="link-problem" [attr.data-problem]="problem()">
      <ion-card-header>
        <ion-card-title>{{ text().title }}</ion-card-title>
      </ion-card-header>
      <ion-card-content>
        @for (hint of text().hints; track $index) {
          <p data-testid="link-problem-hint">{{ hint }}</p>
        }
        <p>
          <ion-text color="medium"><small>{{ problem() }}</small></ion-text>
        </p>
        <ion-button data-testid="link-check-again" (click)="checkAgain.emit()">Check again</ion-button>
      </ion-card-content>
    </ion-card>
  `,
})
export class LinkProblemComponent {
  readonly problem = input.required<LinkProblem>();
  readonly tableRef = input<AgentTableRef | undefined>(undefined);
  readonly checkAgain = output<void>();

  private readonly blockingBrowser = browserMayBlockLoopback();

  readonly text = computed(() =>
    linkProblemText(this.problem(), this.tableRef(), this.blockingBrowser),
  );
}
