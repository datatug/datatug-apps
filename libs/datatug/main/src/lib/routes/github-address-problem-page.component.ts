import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { ProjectUrlErrorReason } from '@datatug/project-address';
import {
  GithubAddressProblem,
  GithubAddressProblemState,
} from './github-project-address-check';

/** What the visitor reads for each kind of problem with a short GitHub address (design 3.4a, "Not supported"). */
export interface GithubAddressMessage {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** A GitHub link to show, `owner/repo`. */
  readonly repo?: string;
}

const UNSUPPORTED_HEADING = 'This address is not supported';

/** The words for an address that cannot be a project. Text only: nothing here is markup. */
export function messageForUnsupported(
  reason: ProjectUrlErrorReason,
): GithubAddressMessage {
  switch (reason) {
    case 'file-link':
      return {
        heading: 'This is a link to a file',
        paragraphs: ["Open the project's folder instead."],
      };
    case 'at-sign-not-supported':
      return {
        heading: UNSUPPORTED_HEADING,
        paragraphs: [
          'A folder or a branch name cannot contain "@": it separates the parts of the project id.',
        ],
      };
    case 'dash-directory-not-supported':
      return {
        heading: UNSUPPORTED_HEADING,
        paragraphs: [
          'A folder named "-" is not supported: the first "-" in an address ends the project locator.',
        ],
      };
    case 'missing-ref':
      return {
        heading: UNSUPPORTED_HEADING,
        paragraphs: ['Name a branch, a tag or a commit after "/tree/".'],
      };
    default:
      return {
        heading: UNSUPPORTED_HEADING,
        paragraphs: [
          'A project address looks like datatug.app/project/github.com/<owner>/<repo>.',
        ],
      };
  }
}

/** The words for an address that is a project address with no project at it. */
export function messageForNotFound(
  problem: Extract<GithubAddressProblem, { kind: 'not-found' }>,
): GithubAddressMessage {
  const repo = `${problem.owner}/${problem.repo}`;
  if (problem.moved) {
    return {
      heading: 'No DataTug project here',
      paragraphs: [
        `${repo} has moved or been renamed. Open it by its new name.`,
      ],
      repo,
    };
  }
  if (problem.ref !== undefined && problem.folder !== '') {
    return {
      heading: 'No DataTug project here',
      paragraphs: [
        `No DataTug project at "${problem.folder}" on "${problem.ref}".`,
        'If the branch name contains "/", open it by its commit instead: datatug.app/project/github.com/' +
          `${repo}/tree/<commit>/${problem.folder}`,
      ],
      repo,
    };
  }
  const where =
    (problem.folder === '' ? 'the root of' : `"${problem.folder}" in`) +
    ` ${repo}` +
    (problem.ref !== undefined ? ` at "${problem.ref}"` : '');
  return {
    heading: 'No DataTug project here',
    paragraphs: [`There is no datatug-project.json at ${where}.`],
    repo,
  };
}

/**
 * The page for a short GitHub address that cannot open a project (design 3.4a): it says why, in words, with a way
 * out, instead of a broken page. Text only; the GitHub link is built from an owner and a repo name that matched
 * GitHub's own patterns.
 */
@Component({
  selector: 'sneat-datatug-github-address-problem',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonTitle,
    IonContent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-menu-button />
        </ion-buttons>
        <ion-title>DataTug</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="problem">
        <h1 tabindex="-1">{{ message().heading }}</h1>
        <div role="status">
          @for (paragraph of message().paragraphs; track $index) {
            <p>{{ paragraph }}</p>
          }
        </div>
        <p class="links">
          @if (message().repo; as repo) {
            <a [href]="'https://github.com/' + repo" rel="noopener noreferrer"
              >Open {{ repo }} on GitHub</a
            >
          }
          <a routerLink="/">Back to DataTug</a>
        </p>
      </div>
    </ion-content>
  `,
  styles: `
    .problem {
      max-width: 40rem;
      margin: 0 auto;
    }
    h1 {
      margin: 0.5rem 0 1rem;
      font-size: 1.5rem;
      outline: none;
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.5rem;
      margin-top: 1.5rem;
    }
  `,
})
export class GithubAddressProblemPageComponent {
  private readonly state = inject(GithubAddressProblemState);

  protected readonly message = computed<GithubAddressMessage>(() => {
    const problem = this.state.problem();
    if (problem?.kind === 'not-found') {
      return messageForNotFound(problem);
    }
    return messageForUnsupported(
      problem?.kind === 'unsupported'
        ? problem.reason
        : 'not-a-project-address',
    );
  });
}
