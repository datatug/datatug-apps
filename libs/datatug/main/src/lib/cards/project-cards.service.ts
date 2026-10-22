import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, untracked } from '@angular/core';
import {
  CARD_ID_PATTERN,
  ProjectCard,
  ProjectCardBrief,
  validMatchRules,
  validateProjectCard,
} from '@datatug/board-models';
import {
  Observable,
  catchError,
  defer,
  from,
  map,
  mergeMap,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
  toArray,
} from 'rxjs';
import { BoardChoicesService } from '../board/core/board-choices.service';
import { IProjectRef, isSharedProjectRef } from '../core/project-context';
import { ProjectAssetsApiService } from '../services/project/project-assets-api.service';
import { githubProjectAddressForRef } from '../services/project/project-assets-read.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import {
  GITHUB_READ_ONLY_MESSAGE,
  StoreApiService,
} from '../services/repo/store-api.service';

/** Raised when a card id has no card in the project. */
export class CardNotFoundError extends Error {
  constructor(readonly cardId: string) {
    super(`Card not found: ${cardId}`);
    this.name = 'CardNotFoundError';
  }
}

/** Cached card reads are read again after this long (spec: 5 minutes). */
export const CARD_CACHE_TTL_MS = 5 * 60 * 1000;

const MAX_CARDS = 200;
const MAX_PARALLEL_READS = 8;
const READ_ONLY_QUALIFIED =
  'Cards of this project are read-only here. Open the project in a DataTug agent to edit them.';
const HOSTED_DELETE_UNSUPPORTED =
  'Deleting a card is not available for shared cloud projects yet.';

const isGithub = (ref: IProjectRef): boolean =>
  ref.storeId === 'github' || ref.storeId === 'github.com';

/** Reduces a full card to the list row (`all_cards` shape). */
export function cardBrief(card: ProjectCard): ProjectCardBrief {
  return {
    id: card.id,
    title: card.title,
    ...(card.description ? { description: card.description } : {}),
    ...(card.display ? { display: card.display } : {}),
    ...(card.parameters?.length
      ? {
          parameters: card.parameters.map((p) => ({
            id: p.id,
            type: p.type,
            ...(p.isRequired !== undefined ? { isRequired: p.isRequired } : {}),
            ...(p.match?.length ? { match: p.match } : {}),
          })),
        }
      : {}),
  };
}

/** Admits one `all_cards` row; undefined when it cannot be listed. */
export function validBrief(row: unknown): ProjectCardBrief | undefined {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const r = row as Record<string, unknown>;
  if (
    typeof r['id'] !== 'string' ||
    !CARD_ID_PATTERN.test(r['id']) ||
    (r['title'] != null && typeof r['title'] !== 'string')
  )
    return undefined;
  const params = Array.isArray(r['parameters'])
    ? (r['parameters'] as unknown[]).flatMap((p) => {
        if (!p || typeof p !== 'object') return [];
        const q = p as Record<string, unknown>;
        if (typeof q['id'] !== 'string' || typeof q['type'] !== 'string')
          return [];
        return [
          {
            id: q['id'],
            type: q['type'],
            ...(typeof q['isRequired'] === 'boolean'
              ? { isRequired: q['isRequired'] }
              : {}),
            // Malformed rules are never fatal: keep what is structurally valid.
            ...(validMatchRules(q['match']) && Array.isArray(q['match'])
              ? { match: q['match'] as never }
              : {}),
          },
        ];
      })
    : undefined;
  return {
    id: r['id'],
    title: (r['title'] as string | undefined) || r['id'],
    ...(typeof r['description'] === 'string'
      ? { description: r['description'] }
      : {}),
    ...(r['display'] === 'panel' || r['display'] === 'tooltip'
      ? { display: r['display'] }
      : {}),
    ...(params?.length ? { parameters: params } : {}),
  };
}

const sorted = (rows: ProjectCardBrief[]): ProjectCardBrief[] =>
  [...rows].sort(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );

/**
 * Project cards (`cards/<id>/card.json`), routed per backend exactly like
 * boards: the local agent (`/cards/*`), the hosted shared-asset API
 * (`datatug/cards/*`, revision/ETag guarded), the qualified common API
 * (read-only) and the GitHub reader (read-only). Every read is validated
 * with {@link validateProjectCard}. The list and single reads are cached per
 * project (and environment) and dropped by every write.
 */
@Injectable({ providedIn: 'root' })
export class ProjectCardsService {
  private readonly store = inject(StoreApiService);
  private readonly hosted = inject(ProjectAssetsApiService);
  private readonly qualified = inject(ProjectQueryApiService);
  private readonly github = inject(GithubProjectReaderService);

  private readonly lists = new Map<string, Observable<ProjectCardBrief[]>>();
  private readonly cards = new Map<string, Observable<ProjectCard>>();
  /** When each cached read started: reads older than {@link CARD_CACHE_TTL_MS} are read again. */
  private readonly stamps = new Map<Map<string, unknown>, Map<string, number>>();
  private readonly choices = inject(BoardChoicesService);
  /** Injectable clock, milliseconds. */
  protected now: () => number = () => Date.now();
  /** Last revision read or written per hosted card; guards the next save. */
  private readonly revisions = new Map<string, string>();

  constructor() {
    // Another person (or signing out) must never be served what the previous one was allowed to read.
    let previous: string | undefined;
    effect(() => {
      const actor = this.choices.actor();
      untracked(() => {
        this.lists.clear();
        this.cards.clear();
        this.stamps.clear();
        // Revisions guard saves of the person who read them: dropped on a real switch (A to B, or A signing
        // out), kept when the sign-in merely resolves (no actor yet, then the user).
        if (previous !== undefined && previous !== actor) this.revisions.clear();
        previous = actor;
      });
    });
  }

  private scopeKey(ref: IProjectRef, environment?: string): string {
    return JSON.stringify([
      ref.storeId,
      ref.projectId,
      ref.spaceID,
      ref.projectApi,
      ref.branch,
      this.choices.actor() ?? '',
      environment ?? '',
    ]);
  }

  /** Drops every cached read of one project (all environments). */
  invalidate(ref: IProjectRef): void {
    const prefix = JSON.stringify([
      ref.storeId,
      ref.projectId,
      ref.spaceID,
      ref.projectApi,
      ref.branch,
    ]).slice(0, -1);
    for (const map of [this.lists, this.cards])
      for (const key of [...map.keys()])
        if (key.startsWith(prefix)) {
          map.delete(key);
          this.stamps.get(map)?.delete(key);
        }
  }

  private isLocalAgent(ref: IProjectRef): boolean {
    return (
      !isSharedProjectRef(ref) &&
      !isGithub(ref) &&
      ref.projectApi === undefined &&
      ref.branch === undefined &&
      ref.spaceID === undefined &&
      ref.storeId !== 'firestore'
    );
  }

  /** Whether cards of this project can be created and saved (the backend still decides on each write). */
  canWrite(ref: IProjectRef): boolean {
    return !isGithub(ref) && (isSharedProjectRef(ref) || this.isLocalAgent(ref));
  }

  /** Whether a card can be deleted: not for GitHub, qualified or hosted projects. */
  canDelete(ref: IProjectRef): boolean {
    return !isGithub(ref) && !isSharedProjectRef(ref) && this.isLocalAgent(ref);
  }

  private cached<T>(
    map: Map<string, Observable<T>>,
    key: string,
    load: () => Observable<T>,
  ): Observable<T> {
    let stamps = this.stamps.get(map);
    if (!stamps) this.stamps.set(map, (stamps = new Map()));
    const started = stamps.get(key);
    if (started !== undefined && this.now() - started >= CARD_CACHE_TTL_MS) {
      map.delete(key);
      stamps.delete(key);
    }
    let hit = map.get(key);
    if (!hit) {
      stamps.set(key, this.now());
      const loading = defer(load).pipe(
        catchError((error: unknown) => {
          if (map.get(key) === loading) map.delete(key);
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      hit = loading;
      map.set(key, hit);
    }
    return hit;
  }

  /** The project's cards, best-first by title. */
  listCards(
    ref: IProjectRef,
    environment?: string,
    forceReload = false,
  ): Observable<ProjectCardBrief[]> {
    const key = this.scopeKey(ref, environment);
    if (forceReload) this.lists.delete(key);
    return this.cached(this.lists, key, () => this.loadList(ref, environment));
  }

  private loadList(
    ref: IProjectRef,
    environment?: string,
  ): Observable<ProjectCardBrief[]> {
    const normalise = (rows: unknown): ProjectCardBrief[] => {
      if (!Array.isArray(rows)) throw new Error('Card list is unavailable.');
      if (rows.length > MAX_CARDS)
        throw new Error(`Project card list exceeds ${MAX_CARDS} items`);
      return sorted(
        rows.flatMap((row) => {
          const brief = validBrief(row);
          return brief ? [brief] : [];
        }),
      );
    };
    if (isSharedProjectRef(ref))
      return this.hosted.cards(ref, environment || '').pipe(map(normalise));
    if (ref.projectApi !== undefined)
      return this.qualified.cards<unknown>(ref).pipe(map(normalise));
    if (isGithub(ref)) return this.githubList(ref);
    if (this.isLocalAgent(ref))
      return this.store
        .get<unknown>(ref.storeId, '/cards/all_cards', {
          params: { project: ref.projectId },
        })
        .pipe(map(normalise));
    return this.qualified.cards<unknown>(ref).pipe(map(normalise));
  }

  private githubList(ref: IProjectRef): Observable<ProjectCardBrief[]> {
    return defer(() => of(githubProjectAddressForRef(ref))).pipe(
      switchMap((project) =>
        this.github.listDirectory(project, 'cards').pipe(
          map((entries) => {
            const ids = new Set<string>();
            for (const entry of entries) {
              const id =
                entry.type === 'dir'
                  ? entry.name
                  : entry.name.endsWith('.card.json')
                    ? entry.name.slice(0, -'.card.json'.length)
                    : undefined;
              if (id && CARD_ID_PATTERN.test(id)) ids.add(id);
            }
            if (ids.size > MAX_CARDS)
              throw new Error(`Project card list exceeds ${MAX_CARDS} items`);
            return [...ids];
          }),
          switchMap((ids) =>
            from(ids).pipe(
              mergeMap(
                (id) =>
                  this.githubRead(project, id).pipe(
                    map((card) => cardBrief(card)),
                    // A broken or missing card file never hides its siblings.
                    catchError(() => of(undefined)),
                  ),
                MAX_PARALLEL_READS,
              ),
              toArray(),
              map((rows) =>
                sorted(rows.filter((r): r is ProjectCardBrief => !!r)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /** `cards/<id>/card.json`, else flat `cards/<id>.card.json`; the folder form wins. */
  private githubRead(project: string, id: string): Observable<ProjectCard> {
    return this.github
      .getRawJson<unknown>(project, `cards/${id}/card.json`)
      .pipe(
        switchMap((folder) =>
          folder !== undefined
            ? of(folder)
            : this.github.getRawJson<unknown>(project, `cards/${id}.card.json`),
        ),
        map((raw) => {
          if (raw === undefined) throw new CardNotFoundError(id);
          const card = validateProjectCard(raw);
          if (card.id !== id) throw new Error('Card detail identity mismatch.');
          return card;
        }),
      );
  }

  /** One card by id; throws {@link CardNotFoundError} when it does not exist. */
  getCard(
    ref: IProjectRef,
    id: string,
    environment?: string,
    forceReload = false,
  ): Observable<ProjectCard> {
    if (!id || !CARD_ID_PATTERN.test(id))
      return throwError(() => new Error('Invalid card id'));
    const key = this.scopeKey(ref, environment) + '|' + id;
    if (forceReload) {
      this.cards.delete(key);
      this.stamps.get(this.cards)?.delete(key);
    }
    return this.cached(this.cards, key, () =>
      this.loadCard(ref, id, environment),
    );
  }

  private loadCard(
    ref: IProjectRef,
    id: string,
    environment?: string,
  ): Observable<ProjectCard> {
    const notFound = <T>(source: Observable<T>) =>
      source.pipe(
        catchError((error: unknown) =>
          throwError(() =>
            error instanceof HttpErrorResponse && error.status === 404
              ? new CardNotFoundError(id)
              : error,
          ),
        ),
      );
    const checked = (raw: unknown): ProjectCard => {
      const card = validateProjectCard(raw);
      if (card.id !== id) throw new Error('Card detail identity mismatch.');
      return card;
    };
    if (isSharedProjectRef(ref))
      return notFound(this.hosted.card(ref, environment || '', id)).pipe(
        tap((snapshot) =>
          this.revisions.set(
            this.scopeKey(ref, environment) + '|' + id,
            snapshot.revision,
          ),
        ),
        map((snapshot) => snapshot.card),
      );
    if (ref.projectApi !== undefined)
      return notFound(this.qualified.card<unknown>(ref, id)).pipe(map(checked));
    if (isGithub(ref))
      return defer(() => of(githubProjectAddressForRef(ref))).pipe(
        switchMap((project) => this.githubRead(project, id)),
      );
    if (this.isLocalAgent(ref))
      return notFound(
        this.store.get<unknown>(ref.storeId, '/cards/card', {
          params: { project: ref.projectId, id },
        }),
      ).pipe(map(checked));
    return notFound(this.qualified.card<unknown>(ref, id)).pipe(map(checked));
  }

  /** Creates a card. Fails when the id is invalid or already taken. */
  createCard(
    ref: IProjectRef,
    card: ProjectCard,
    environment?: string,
  ): Observable<ProjectCard> {
    return defer(() => {
      validateProjectCard(card);
      if (isGithub(ref))
        return throwError(() => new Error(GITHUB_READ_ONLY_MESSAGE));
      if (isSharedProjectRef(ref))
        return this.hostedWrite(ref, card, environment, true);
      if (!this.isLocalAgent(ref))
        return throwError(() => new Error(READ_ONLY_QUALIFIED));
      return this.store
        .post<unknown>(ref.storeId, '/cards/create_card', card, {
          params: { project: ref.projectId },
        })
        .pipe(map(() => card));
    }).pipe(tap(() => this.invalidate(ref)));
  }

  /** Saves (overwrites) an existing card. */
  saveCard(
    ref: IProjectRef,
    card: ProjectCard,
    environment?: string,
  ): Observable<ProjectCard> {
    return defer(() => {
      validateProjectCard(card);
      if (isGithub(ref))
        return throwError(() => new Error(GITHUB_READ_ONLY_MESSAGE));
      if (isSharedProjectRef(ref))
        return this.hostedWrite(ref, card, environment, false);
      if (!this.isLocalAgent(ref))
        return throwError(() => new Error(READ_ONLY_QUALIFIED));
      return this.store
        .put<ProjectCard, unknown>(ref.storeId, '/cards/save_card', card, {
          params: { project: ref.projectId },
        })
        .pipe(map(() => card));
    }).pipe(tap(() => this.invalidate(ref)));
  }

  private hostedWrite(
    ref: IProjectRef,
    card: ProjectCard,
    environment: string | undefined,
    create: boolean,
  ): Observable<ProjectCard> {
    const key = this.scopeKey(ref, environment) + '|' + card.id;
    const revision = this.revisions.get(key);
    if (!create && !revision)
      return throwError(
        () => new Error('Reload the card before saving it.'),
      );
    return this.hosted
      .saveCard(ref, environment || '', {
        operationId: crypto.randomUUID(),
        card,
        ...(create ? { ifNoneMatch: true as const } : { ifMatch: revision }),
      })
      .pipe(
        tap((ack) => this.revisions.set(key, ack.revision)),
        map(() => card),
      );
  }

  /** Deletes a card (`cards/<id>/` is removed by the agent). */
  deleteCard(ref: IProjectRef, id: string): Observable<void> {
    return defer(() => {
      if (!CARD_ID_PATTERN.test(id))
        return throwError(() => new Error('Invalid card id'));
      if (isGithub(ref))
        return throwError(() => new Error(GITHUB_READ_ONLY_MESSAGE));
      if (isSharedProjectRef(ref))
        return throwError(() => new Error(HOSTED_DELETE_UNSUPPORTED));
      if (!this.isLocalAgent(ref))
        return throwError(() => new Error(READ_ONLY_QUALIFIED));
      return this.store
        .delete<unknown>(ref.storeId, '/cards/delete_card', {
          params: { project: ref.projectId, id },
        })
        .pipe(map(() => undefined));
    }).pipe(tap(() => this.invalidate(ref)));
  }
}
