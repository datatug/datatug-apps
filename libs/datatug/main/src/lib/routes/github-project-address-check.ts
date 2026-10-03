import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import {
  asciiLowerCase,
  formatGithubProjectId,
  GITHUB_STORE_ID,
  IGithubProjectParts,
  IProjectUrlParts,
  parseProjectUrl,
  ProjectUrlErrorReason,
  projectUrl,
} from '@datatug/project-address';
import { DatatugStoreGithubService } from '../services/repo/datatug-store.service.github';
import { githubGet } from '../services/repo/github/github-http';
import {
  GITHUB_FETCH,
  GithubProjectNotFoundError,
} from '../services/repo/github/github-project-reader.service';
import {
  GITHUB_RESOLVE_TIMEOUT_MS,
  MAX_PROJECT_FILE_BYTES,
} from '../services/repo/github/github-read-limits';

// What happens before a project opens at its short address (design `demo-as-github-project.md` 3.4a):
//   1. every other spelling of the address is replaced by the canonical one (a redirect, query and fragment kept);
//   2. an address that names a branch is looked up once against the repository's default branch, and when it IS the
//      default branch the address is replaced by the `HEAD` spelling, so a default-branch project has one id;
//   3. an address that cannot be a project, or has no project file, shows a page that says so, instead of a broken one.
// Everything here is plain functions and small root services, so each step can be driven with fakes.

/** The `/project/github.com/…` address of a GitHub project, read from the router's (decoded) path segments. */
export type ShortGithubAddress =
  /** Not under `/project/github.com`: not this route's business. */
  | { readonly kind: 'not-short-github' }
  /** Under `/project/github.com` but not an address that can be a project. */
  | { readonly kind: 'refused'; readonly reason: ProjectUrlErrorReason }
  | {
      readonly kind: 'project';
      readonly parts: IProjectUrlParts;
      /** How many of the segments are the project locator; the rest is the page. */
      readonly locatorLength: number;
    };

/** The encoded path of an address, as the one place that knows the shapes (`parseProjectUrl`) reads it. */
const encodedPath = (segments: readonly string[]): string =>
  '/' + segments.map((s) => encodeURIComponent(s)).join('/');

/** How many of the (already normalised) segments are the project locator, given what follows it. */
const locatorLengthOf = (
  segments: readonly string[],
  parts: IProjectUrlParts,
): number =>
  segments.length - (parts.rest === '' ? 0 : parts.rest.split('/').length - 1);

/**
 * Reads the segments as the router has them (percent-decoded) with `parseProjectUrl`, the one place that knows the
 * shapes. Each segment is encoded again first, so a `%2F` or a `%` in a segment reads as the text it came from.
 *
 * The fixed segments (`project`, `github.com`, `tree`, and the first page, which is always a lower-case name) are
 * read in any letter case, as the hand-off route's matcher and index.html's script read them, and are another
 * spelling of the canonical address (`isCanonical` is false: the route redirects). Only ASCII letters are folded,
 * so no look-alike letter ever passes for one of them. Owner and repository are lower-cased by `parseProjectUrl`.
 */
export function readShortGithubAddress(
  segments: readonly string[],
): ShortGithubAddress {
  if (
    segments.length < 2 ||
    asciiLowerCase(segments[0]) !== 'project' ||
    asciiLowerCase(segments[1]) !== GITHUB_STORE_ID
  ) {
    return { kind: 'not-short-github' };
  }
  const normalised = [...segments];
  normalised[0] = 'project';
  normalised[1] = GITHUB_STORE_ID;
  if (normalised[4] !== undefined && asciiLowerCase(normalised[4]) === 'tree') {
    normalised[4] = 'tree';
  }
  let parsed = parseProjectUrl(encodedPath(normalised));
  if (!parsed.ok) {
    return { kind: 'refused', reason: parsed.reason };
  }
  let locatorLength = locatorLengthOf(normalised, parsed);
  const page = normalised[locatorLength];
  if (page !== undefined && asciiLowerCase(page) !== page) {
    normalised[locatorLength] = asciiLowerCase(page);
    parsed = parseProjectUrl(encodedPath(normalised)) as IProjectUrlParts;
    locatorLength = locatorLengthOf(normalised, parsed);
  }
  const respelled = normalised.some((segment, i) => segment !== segments[i]);
  return {
    kind: 'project',
    parts: respelled ? { ...parsed, isCanonical: false } : parsed,
    locatorLength,
  };
}

/** What the visitor is told instead of a project. */
export type GithubAddressProblem =
  | { readonly kind: 'unsupported'; readonly reason: ProjectUrlErrorReason }
  | {
      readonly kind: 'not-found';
      readonly owner: string;
      readonly repo: string;
      /** The typed branch, tag or commit; absent for the default branch. */
      readonly ref?: string;
      readonly folder: string;
      /** GitHub answered with a redirect: a renamed or moved repository. */
      readonly moved: boolean;
    };

/** The problem the page being shown is about. Set by the check, read by the page. */
@Injectable({ providedIn: 'root' })
export class GithubAddressProblemState {
  readonly problem = signal<GithubAddressProblem | undefined>(undefined);
}

/** What the lookup of a repository's default branch came to. */
export type DefaultBranchLookup =
  | { readonly kind: 'found'; readonly branch: string }
  /** The repository is not there (or has moved): nothing to compare with, and nothing to warn about. */
  | { readonly kind: 'absent' }
  /** Refused (a rate limit), failed, timed out, or answered with something else. */
  | { readonly kind: 'refused' };

/**
 * `GET api.github.com/repos/<owner>/<repo>`, field `default_branch`; the one extra GitHub API call of design 3.4a,
 * made only when an address names a branch. One answer per repository for the life of the page (a refusal too: a
 * rate-limited visit must not ask again on every navigation).
 */
@Injectable({ providedIn: 'root' })
export class GithubDefaultBranchLookup {
  private readonly fetchFn = inject(GITHUB_FETCH);
  private readonly answers = new Map<string, Promise<DefaultBranchLookup>>();

  lookup(owner: string, repo: string): Promise<DefaultBranchLookup> {
    const key = `${owner}/${repo}`;
    let answer = this.answers.get(key);
    if (!answer) {
      answer = this.ask(owner, repo);
      this.answers.set(key, answer);
    }
    return answer;
  }

  private async ask(owner: string, repo: string): Promise<DefaultBranchLookup> {
    const outcome = await githubGet(
      this.fetchFn,
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        maxBytes: MAX_PROJECT_FILE_BYTES,
        accept: 'application/vnd.github+json',
        detectMoved: true,
        timeoutMs: GITHUB_RESOLVE_TIMEOUT_MS,
      },
    );
    if (outcome.kind === 'missing' || outcome.kind === 'moved') {
      return { kind: 'absent' };
    }
    if (outcome.kind !== 'ok') {
      return { kind: 'refused' };
    }
    try {
      const { default_branch: branch } = JSON.parse(outcome.text) as {
        default_branch?: unknown;
      };
      return typeof branch === 'string' && branch !== ''
        ? { kind: 'found', branch }
        : { kind: 'refused' };
    } catch {
      return { kind: 'refused' };
    }
  }
}

/** Tells the visitor something about the address that does not stop the page: a toast. */
@Injectable({ providedIn: 'root' })
export class GithubAddressNotices {
  private readonly toast = inject(ToastController);

  /** The default branch could not be looked up: the address is left as typed, and its history is its own. */
  defaultBranchUnknown(owner: string, repo: string, ref: string): void {
    void this.toast
      .create({
        message: `Could not check whether "${ref}" is the default branch of ${owner}/${repo}. This address is kept as typed, and its chat history is kept separately from the default branch's.`,
        duration: 10_000,
        position: 'bottom',
        buttons: [{ text: 'OK', role: 'cancel' }],
      })
      .then((toast) => toast.present());
  }
}

/** Where the check stands in the navigation: the query and fragment a redirect keeps. */
export interface NavigationParts {
  readonly queryParams: Record<string, string | string[]>;
  readonly fragment: string | null;
}

/** What the check decides for a navigation to a short GitHub address. */
export type AddressDecision =
  /** Not this route's address, or nothing wrong: let the project route take it. */
  | { readonly kind: 'open' }
  /** Replace the address by this path (query and fragment kept). */
  | { readonly kind: 'redirect'; readonly path: string }
  /** Show the page that says there is a problem. */
  | { readonly kind: 'problem'; readonly problem: GithubAddressProblem };

/**
 * The path of the same project and page with the ref `HEAD` instead of the named one (the project at the default
 * branch has no ref in its id), in its canonical spelling: what `projectUrl` writes for that project and page.
 * `parts` is a canonical address that names a ref.
 */
function defaultBranchPath(
  parts: IProjectUrlParts,
  github: IGithubProjectParts & { readonly ref: string },
): string {
  const page = parts.rest ? parts.rest.slice(1).split('/') : [];
  return projectUrl(
    {
      storeId: parts.storeId,
      projectId: formatGithubProjectId({
        repo: github.repo,
        org: github.owner,
        folder: github.folder,
      }),
    },
    // `rest` is as typed (percent-encoded, and already judged by `parseProjectUrl`): `projectUrl` takes plain text.
    page.map((segment) => decodeURIComponent(segment)),
  );
}

/**
 * How long the check waits for GitHub to say whether a project file is there, before it lets the project open and
 * the pages show their own loading or error state. A host that does not answer must not leave a blank page: the
 * pages' own reads give up after 40 s, the old form of the address shows its state at once.
 */
export const GITHUB_PROBE_TIMEOUT_MS = 3000;

/** Resolves after `ms` milliseconds. A token so that a test says when the time is up. */
export const GITHUB_PROBE_TIMER = new InjectionToken<
  (ms: number) => Promise<void>
>('GITHUB_PROBE_TIMER', {
  providedIn: 'root',
  factory: () => (ms) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
});

const TIME_UP = Symbol('probe time is up');

/** The decisions, in the order of the design. Injectable so the router glue stays a one-liner and a test fakes the network. */
@Injectable({ providedIn: 'root' })
export class GithubAddressCheck {
  private readonly branches = inject(GithubDefaultBranchLookup);
  private readonly notices = inject(GithubAddressNotices);
  private readonly store = inject(DatatugStoreGithubService);
  private readonly timer = inject(GITHUB_PROBE_TIMER);
  /** Repositories and refs the visitor has been told about (once each for the life of the page). */
  private readonly told = new Set<string>();
  /** Projects whose first read ended in anything but "not found" (a project that was there is not asked about again). */
  private readonly probed = new Set<string>();
  /** Projects whose first read has not answered yet, though the time allowed is up: not waited for again. */
  private readonly waiting = new Set<string>();
  /** What a first read said, after the time allowed was up: told on the next navigation, once. */
  private readonly late = new Map<string, 'missing' | 'moved'>();

  /**
   * `matrixParameters`: the segments had matrix parameters (`/project;a=1/…`, `…/queries;msg=Q`). They are another
   * spelling of the address, so the canonical one, which has none, replaces it.
   */
  async decide(
    segments: readonly string[],
    options: { readonly matrixParameters?: boolean } = {},
  ): Promise<AddressDecision> {
    const address = readShortGithubAddress(segments);
    if (address.kind === 'not-short-github') {
      return { kind: 'open' };
    }
    if (address.kind === 'refused') {
      return {
        kind: 'problem',
        problem: { kind: 'unsupported', reason: address.reason },
      };
    }
    const { parts } = address;
    if (!parts.isCanonical || options.matrixParameters) {
      return { kind: 'redirect', path: parts.canonicalPath };
    }
    // A project at `/project/github.com/…` is always a GitHub project: its parts are always there.
    const github = parts.github as IGithubProjectParts;
    if (github.ref !== undefined) {
      const lookup = await this.branches.lookup(github.owner, github.repo);
      if (lookup.kind === 'found' && lookup.branch === github.ref) {
        return {
          kind: 'redirect',
          path: defaultBranchPath(parts, { ...github, ref: github.ref }),
        };
      } else if (lookup.kind === 'refused') {
        const key = `${github.owner}/${github.repo}@${github.ref}`;
        if (!this.told.has(key)) {
          this.told.add(key);
          this.notices.defaultBranchUnknown(
            github.owner,
            github.repo,
            github.ref,
          );
        }
      }
    }
    if (!this.probed.has(parts.projectId)) {
      const missing = await this.firstRead(parts.projectId);
      if (missing) {
        return {
          kind: 'problem',
          problem: {
            kind: 'not-found',
            owner: github.owner,
            repo: github.repo,
            ...(github.ref !== undefined ? { ref: github.ref } : {}),
            folder: github.folder,
            moved: missing === 'moved',
          },
        };
      }
    }
    return { kind: 'open' };
  }

  /**
   * `'missing'` or `'moved'` when GitHub says there is no project at this id; undefined otherwise, errors included,
   * and when GitHub has not answered within `GITHUB_PROBE_TIMEOUT_MS` (the project opens, and its pages show
   * their own loading or error state).
   *
   * The id counts as a project that is there only once GitHub has said so (or failed in another way than "not
   * found"). A read that is still waiting when the time is up proves nothing: it is not waited for again, and what
   * it says when it does answer is kept, so that "no project here" is shown on the next navigation.
   */
  private async firstRead(
    projectId: string,
  ): Promise<'missing' | 'moved' | undefined> {
    const late = this.late.get(projectId);
    if (late) {
      this.late.delete(projectId);
      return late;
    }
    if (this.waiting.has(projectId)) {
      return undefined;
    }
    const answer = firstValueFrom(this.store.getProjectSummary(projectId)).then(
      () => undefined,
      (err: unknown) =>
        err instanceof GithubProjectNotFoundError ? err.reason : undefined,
    );
    const timeUp = this.timer(GITHUB_PROBE_TIMEOUT_MS).then(
      (): typeof TIME_UP => TIME_UP,
    );
    const first = await Promise.race([answer, timeUp]);
    if (first === TIME_UP) {
      this.waiting.add(projectId);
      void answer.then((outcome) => {
        this.waiting.delete(projectId);
        if (outcome) {
          this.late.set(projectId, outcome);
        } else {
          this.probed.add(projectId);
        }
      });
      return undefined;
    }
    if (!first) {
      this.probed.add(projectId);
    }
    return first;
  }
}
