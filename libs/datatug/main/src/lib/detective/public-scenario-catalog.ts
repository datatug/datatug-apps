import { Injectable, inject } from '@angular/core';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
import { IProjectRef } from '../core/project-context';
import { Observable, from, throwError } from 'rxjs';
import { map, mergeMap, timeout, toArray } from 'rxjs/operators';
import { CheckInput, InvestigationScenario, ScenarioStep } from './models';
import {
  GithubProjectReaderService,
  GithubReadBudget,
} from '../services/repo/github/github-project-reader.service';

export const MAX_PUBLIC_SCENARIOS = 20;
const MAX_PUBLIC_SCENARIO_STEPS = 50;
const PUBLIC_SCENARIO_TIMEOUT_MS = 45_000;
const SCENARIO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const QUERY_REF = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const SCENARIO_TYPES = new Set([
  'string',
  'integer',
  'number',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'null',
]);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export class PublicScenarioNotFoundError extends Error {
  constructor(id: string) {
    super(`Scenario "${id}" was not found in the public demo.`);
    this.name = 'PublicScenarioNotFoundError';
  }
}

export class InvalidPublicScenarioError extends Error {
  constructor(id: string) {
    super(`Scenario "${id}" has an invalid definition in the public demo.`);
    this.name = 'InvalidPublicScenarioError';
  }
}

export function isCanonicalPublicDemo(ref: IProjectRef | undefined): boolean {
  return (
    ref?.storeId === DEMO_PROJECT_REF.storeId &&
    ref.projectId === DEMO_PROJECT_REF.projectId &&
    ref.spaceID === undefined &&
    ref.projectApi === undefined &&
    ref.branch === undefined
  );
}

/** Accept only the fields the read-only page renders, before any JSON reaches a template. */
export function readPublicScenario(
  value: unknown,
  expectedId: string,
): InvestigationScenario | undefined {
  if (!SCENARIO_ID.test(expectedId) || !object(value)) return undefined;
  if (
    value['id'] !== expectedId ||
    typeof value['title'] !== 'string' ||
    !value['title'].trim() ||
    value['title'].length > 160 ||
    !Number.isSafeInteger(value['version']) ||
    (value['version'] as number) < 1 ||
    (value['description'] !== undefined &&
      (typeof value['description'] !== 'string' ||
        value['description'].length > 2000)) ||
    !Array.isArray(value['inputs']) ||
    value['inputs'].length > 50 ||
    !value['inputs'].every(isCheckInput) ||
    !Array.isArray(value['steps']) ||
    value['steps'].length < 1 ||
    value['steps'].length > MAX_PUBLIC_SCENARIO_STEPS ||
    !value['steps'].every(isScenarioStep)
  ) {
    return undefined;
  }
  const steps = value['steps'] as ScenarioStep[];
  if (new Set(steps.map((step) => step.id)).size !== steps.length)
    return undefined;
  return value as unknown as InvestigationScenario;
}

function isCheckInput(value: unknown): value is CheckInput {
  return (
    object(value) &&
    typeof value['name'] === 'string' &&
    value['name'].length > 0 &&
    value['name'].length <= 128 &&
    typeof value['type'] === 'string' &&
    SCENARIO_TYPES.has(value['type']) &&
    ['scalar', 'set', 'range'].includes(String(value['cardinality'])) &&
    (value['required'] === undefined || typeof value['required'] === 'boolean')
  );
}

function isScenarioStep(value: unknown): value is ScenarioStep {
  if (
    !object(value) ||
    typeof value['id'] !== 'string' ||
    !SCENARIO_ID.test(value['id']) ||
    (value['kind'] !== 'query' && value['kind'] !== 'check') ||
    typeof value['ref'] !== 'string'
  ) {
    return false;
  }
  return value['kind'] === 'query'
    ? QUERY_REF.test(value['ref'])
    : SCENARIO_ID.test(value['ref']);
}

@Injectable({ providedIn: 'root' })
export class PublicScenarioCatalogService {
  private readonly github = inject(GithubProjectReaderService);

  list(ref: IProjectRef): Observable<InvestigationScenario[]> {
    this.assertCanonicalDemo(ref);
    const budget = new GithubReadBudget(MAX_PUBLIC_SCENARIOS);
    return this.github.listDirectory(ref.projectId, 'scenarios').pipe(
      map((entries) =>
        entries
          .filter(
            (entry) => entry.type === 'file' && entry.name.endsWith('.json'),
          )
          .map((entry) => entry.name.slice(0, -'.json'.length))
          .filter((id) => SCENARIO_ID.test(id))
          .sort((left, right) => left.localeCompare(right)),
      ),
      mergeMap((ids) => {
        if (ids.length > MAX_PUBLIC_SCENARIOS) {
          throw new Error(
            'The public Scenario catalog is larger than this page can load.',
          );
        }
        return from(ids).pipe(
          mergeMap(
            (id) =>
              this.github
                .getRawJson<unknown>(ref.projectId, `scenarios/${id}.json`, {
                  budget,
                })
                .pipe(
                  map((value) => {
                    const scenario = readPublicScenario(value, id);
                    if (!scenario) throw new InvalidPublicScenarioError(id);
                    return scenario;
                  }),
                ),
            4,
          ),
          toArray(),
          map((items) =>
            items.sort((left, right) => left.title.localeCompare(right.title)),
          ),
        );
      }),
      timeout({ first: PUBLIC_SCENARIO_TIMEOUT_MS }),
    );
  }

  get(ref: IProjectRef, id: string): Observable<InvestigationScenario> {
    this.assertCanonicalDemo(ref);
    if (!SCENARIO_ID.test(id)) {
      return throwError(() => new PublicScenarioNotFoundError(id));
    }
    return this.github
      .getRawJson<unknown>(ref.projectId, `scenarios/${id}.json`, {
        budget: new GithubReadBudget(1),
      })
      .pipe(
        map((value) => {
          if (value == null) throw new PublicScenarioNotFoundError(id);
          const scenario = readPublicScenario(value, id);
          if (!scenario) throw new InvalidPublicScenarioError(id);
          return scenario;
        }),
        timeout({ first: PUBLIC_SCENARIO_TIMEOUT_MS }),
      );
  }

  private assertCanonicalDemo(ref: IProjectRef): void {
    if (!isCanonicalPublicDemo(ref)) {
      throw new Error(
        'Public Scenarios are available only for the canonical DataTug demo.',
      );
    }
  }
}
