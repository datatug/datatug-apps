import type { DeclaredCatalogContext } from './declared-source';
import { INITIAL_CANONICAL_PINS } from './canonical-metadata';
import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { IQueryDef } from '../../models/definition/query-def';
import type { IProjectRef } from '../../core/project-context';
import type { QueriesService } from '../queries.service';
import type { PublicDataService } from './public-data.service';
import {
  savedPlanIdentity,
  type SavedPlanRevalidation,
} from './saved-plan-revalidation';

/** Query-page state: opening a saved query performs no metadata or data request. */
export class SavedPlanReview {
  readonly checking = signal(false);
  readonly saving = signal(false);
  readonly review = signal<SavedPlanRevalidation | undefined>(undefined);
  readonly acknowledged = signal<string | undefined>(undefined);
  readonly message = signal<string | undefined>(undefined);
  private operation?: AbortController;
  constructor(
    private readonly definition: () => IQueryDef | undefined,
    private readonly metadata: PublicDataService,
    private readonly queries: QueriesService,
    private readonly project: () => IProjectRef | undefined,
    private readonly configured?: (
      definition: IQueryDef,
      signal: AbortSignal,
    ) => Promise<DeclaredCatalogContext | undefined>,
  ) {}
  reset(): void {
    this.operation?.abort();
    this.operation = undefined;
    this.checking.set(false);
    this.review.set(undefined);
    this.acknowledged.set(undefined);
    this.message.set(undefined);
  }
  async check(): Promise<void> {
    const definition = this.definition();
    if (!definition?.publicData) return;
    this.reset();
    const operation = (this.operation = new AbortController());
    this.checking.set(true);
    try {
      const context = definition.publicData.declaredSource
        ? await this.configured?.(definition, operation.signal)
        : undefined;
      const review = await this.metadata.revalidate(
        definition,
        operation.signal,
        INITIAL_CANONICAL_PINS,
        context,
      );
      if (!operation.signal.aborted && this.current(review))
        this.review.set(review);
    } catch (error) {
      if (!operation.signal.aborted)
        this.message.set(
          error instanceof Error
            ? error.message
            : 'Current metadata could not be checked.',
        );
    } finally {
      if (this.operation === operation) this.checking.set(false);
    }
  }
  private current(review: SavedPlanRevalidation): boolean {
    const definition = this.definition();
    return (
      !!definition && review.originalPlan === savedPlanIdentity(definition)
    );
  }
  acknowledge(): void {
    const review = this.review();
    if (review?.compatible && this.current(review))
      this.acknowledged.set(review.fingerprint);
  }
  async saveCopy(): Promise<void> {
    const review = this.review(),
      project = this.project();
    if (
      this.saving() ||
      !review?.copy ||
      !review.compatible ||
      !project ||
      !this.current(review)
    )
      return;
    if (review.changes.length && this.acknowledged() !== review.fingerprint) {
      this.message.set(
        'Inspect and acknowledge this metadata check before saving its changed pins.',
      );
      return;
    }
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        this.queries.createQuery(project, review.copy),
      );
      this.message.set(
        `Saved separate pending plan “${saved.title || saved.id}”. Original pins and results are retained; execution remains unavailable.`,
      );
    } catch (error) {
      this.message.set(
        error instanceof Error
          ? error.message
          : 'Pending plan could not be saved.',
      );
    } finally {
      this.saving.set(false);
    }
  }
  destroy(): void {
    this.reset();
  }
}
