import { Injectable, inject, signal } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import {
  GITHUB_DEFAULT_BRANCH_REF,
  GITHUB_STORE_ID,
  IGithubProjectParts,
  IProjectUrlParts,
  parseProjectUrl,
  ProjectUrlErrorReason,
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

/**
 * Reads the segments as the router has them (percent-decoded) with `parseProjectUrl`, the one place that knows the
 * shapes. Each segment is encoded again first, so a `%2F` or a `%` in a segment reads as the text it came from.
 */
export function readShortGithubAddress(
  segments: readonly string[],
): ShortGithubAddress {
  if (segments[0] !== 'project' || segments[1] !== GITHUB_STORE_ID) {
    return { kind: 'not-short-github' };
  }
  const parsed = parseProjectUrl(
    '/' + segments.map((s) => encodeURIComponent(s)).join('/'),
  );
  if (!parsed.ok) {
    return { kind: 'refused', reason: parsed.reason };
  }
  const pageSegments =
    parsed.rest === '' ? 0 : parsed.rest.split('/').length - 1;
  return {
    kind: 'project',
    parts: parsed,
    locatorLength: segments.length - pageSegments,
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
 * The path of the same project and page with the ref `HEAD` instead of the named one, in its canonical spelling.
 * `parts` is a canonical address that names a ref, so its path has `/tree/<encoded ref>` right after the repository,
 * and the same path with `HEAD` there is an address that parses.
 */
function defaultBranchPath(
  parts: IProjectUrlParts,
  github: IGithubProjectParts & { readonly ref: string },
): string {
  const prefix = `/project/${GITHUB_STORE_ID}/${github.owner}/${github.repo}/tree/`;
  const named = prefix + encodeURIComponent(github.ref);
  const replaced = parseProjectUrl(
    prefix +
      GITHUB_DEFAULT_BRANCH_REF +
      parts.canonicalPath.slice(named.length),
  ) as IProjectUrlParts;
  return replaced.canonicalPath;
}

/** The decisions, in the order of the design. Injectable so the router glue stays a one-liner and a test fakes the network. */
@Injectable({ providedIn: 'root' })
export class GithubAddressCheck {
  private readonly branches = inject(GithubDefaultBranchLookup);
  private readonly notices = inject(GithubAddressNotices);
  private readonly store = inject(DatatugStoreGithubService);
  /** Projects whose first read ended in anything but "not found" (a project that was there is not asked about again). */
  private readonly probed = new Set<string>();

  async decide(segments: readonly string[]): Promise<AddressDecision> {
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
    if (!parts.isCanonical) {
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
        this.notices.defaultBranchUnknown(
          github.owner,
          github.repo,
          github.ref,
        );
      }
    }
    if (!this.probed.has(parts.projectId)) {
      const missing = await this.probe(parts.projectId);
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
      this.probed.add(parts.projectId);
    }
    return { kind: 'open' };
  }

  /** `'missing'` or `'moved'` when GitHub says there is no project at this id; undefined otherwise, errors included. */
  private async probe(
    projectId: string,
  ): Promise<'missing' | 'moved' | undefined> {
    try {
      await firstValueFrom(this.store.getProjectSummary(projectId));
      return undefined;
    } catch (err) {
      return err instanceof GithubProjectNotFoundError ? err.reason : undefined;
    }
  }
}
