import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { IProjectRef } from '../core/project-context';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { QueriesService } from '../queries/queries.service';
import { PublicSqliteQueryService } from '../queries/public-sqlite-query.service';
import {
  CheckDefinition,
  CheckRun,
  ValidationResult,
  ValidatorDefinition,
} from './models';

export { isPublicChecksProject } from './public-checks-project';
import { isPublicChecksProject } from './public-checks-project';

export function publicCheckUnsupported(check: CheckDefinition): string {
  if (
    !check ||
    !Array.isArray(check.inputs) ||
    check.inputs.length ||
    !Array.isArray(check.steps) ||
    !check.steps.length ||
    check.steps.length > 4
  )
    return 'Browser demo Checks require 1–4 saved-query steps and no inputs.';
  for (const step of check.steps) {
    if (
      !step ||
      step.kind !== 'query' ||
      typeof step.queryId !== 'string' ||
      !step.queryId ||
      step.checkId ||
      step.bindings?.length ||
      step.onUnavailable ||
      !step.validators?.length ||
      step.validators.length > 4
    )
      return 'This Check requires actions that the browser demo does not support.';
    for (const validator of step.validators) {
      if (
        !validator ||
        validator.kind !== 'row-count' ||
        validator.scope !== 'set' ||
        validator.validatorId ||
        validator.checkId ||
        validator.bindings?.length ||
        validator.onUnavailable ||
        !['critical', 'error', 'warning', 'info'].includes(
          validator.severity,
        ) ||
        validator.expected?.type !== 'integer' ||
        !/^(0|[1-9]\d*)$/u.test(validator.expected.value) ||
        !Number.isSafeInteger(Number(validator.expected.value))
      )
        return 'Only inline set row-count Validators with a nonnegative integer expectation run in this browser demo.';
    }
  }
  return '';
}

/** Same row-count semantics as Core pkg/detective/engine.go: incomplete populations cannot prove equality. */
export function publicRowCountResult(
  validator: ValidatorDefinition,
  rows: number,
  incomplete: boolean,
): ValidationResult {
  const expected = validator.expected;
  if (
    expected?.type !== 'integer' ||
    !/^(0|[1-9]\d*)$/u.test(expected.value) ||
    !Number.isSafeInteger(Number(expected.value))
  )
    return {
      validatorId: validator.id,
      executionStatus: 'error',
      outcome: 'unknown',
      severity: validator.severity,
      message: 'Invalid row-count expectation.',
    };
  const wanted = Number(expected.value);
  const outcome =
    rows !== wanted && (!incomplete || rows > wanted)
      ? 'fail'
      : incomplete
        ? 'unknown'
        : 'pass';
  return {
    validatorId: validator.id,
    executionStatus: 'completed',
    outcome,
    severity: validator.severity,
    message: `Expected ${wanted} rows; observed ${rows}.${incomplete ? ' Population was filtered or truncated.' : ''}`,
  };
}

@Injectable({ providedIn: 'root' })
export class PublicDemoChecksService {
  private readonly reader = inject(GithubProjectReaderService);
  private readonly queries = inject(QueriesService);
  private readonly sqlite = inject(PublicSqliteQueryService);

  async load(ref: IProjectRef): Promise<CheckDefinition[]> {
    if (!isPublicChecksProject(ref))
      throw new Error(
        'Public Checks are supported only in the default DataTug demo project.',
      );
    const entries = await firstValueFrom(
      this.reader.listDirectory(ref.projectId, 'checks').pipe(timeout(15000)),
    );
    const files = entries.filter(
      (entry) =>
        entry.type === 'file' && /^[a-z0-9][a-z0-9-]*\.json$/u.test(entry.name),
    );
    if (files.length > 12)
      throw new Error(
        'The public Checks catalog exceeds the browser limit of 12 definitions.',
      );
    return Promise.all(
      files.map(async (file) => {
        const check = await firstValueFrom(
          this.reader
            .getRawJson<CheckDefinition>(ref.projectId, `checks/${file.name}`)
            .pipe(timeout(15000)),
        );
        if (
          !check ||
          check.id !== file.name.slice(0, -5) ||
          typeof check.title !== 'string' ||
          !check.title.trim() ||
          !Array.isArray(check.steps) ||
          !Array.isArray(check.inputs) ||
          check.steps.some(
            (step) =>
              !step ||
              typeof step.id !== 'string' ||
              (step.validators !== undefined &&
                (!Array.isArray(step.validators) ||
                  step.validators.some(
                    (validator) =>
                      !validator || typeof validator.id !== 'string',
                  ))),
          )
        )
          throw new Error(`Invalid Check definition: ${file.name}`);
        return check;
      }),
    );
  }

  async run(ref: IProjectRef, check: CheckDefinition): Promise<CheckRun> {
    if (!isPublicChecksProject(ref))
      throw new Error(
        'This project is not admitted for public Check execution.',
      );
    const unsupported = publicCheckUnsupported(check);
    if (unsupported) throw new Error(unsupported);
    const started = Date.now();
    const definition = structuredClone(check);
    const steps: CheckRun['steps'] = [];
    for (const step of definition.steps) {
      const stepStarted = Date.now();
      const query = await firstValueFrom(
        this.queries.getQuery(ref, step.queryId as string).pipe(timeout(15000)),
      );
      // PublicSqliteQueryService admits the pinned connection catalog and the bounded read-only worker.
      const result = await this.sqlite.run(ref, query);
      const incomplete =
        result.truncated ||
        result.limitations.some((limitation) => limitation.rowsFiltered);
      const validators = (step.validators || []).map((validator) =>
        publicRowCountResult(
          validator,
          result.recordset.rows.length,
          incomplete,
        ),
      );
      steps.push({
        stepId: step.id,
        kind: 'query',
        queryId: step.queryId,
        executionStatus: 'completed',
        outcome: validators.some((v) => v.outcome === 'fail')
          ? 'fail'
          : validators.some((v) => v.outcome === 'unknown')
            ? 'unknown'
            : 'pass',
        rowCount: result.recordset.rows.length,
        validators,
        source: result.provenance.source,
        observedAt: result.provenance.observedAt,
        executionProfile: 'protected',
        durationMs: Date.now() - stepStarted,
      });
    }
    const outcome = steps.some((step) => step.outcome === 'fail')
      ? 'fail'
      : steps.some((step) => step.outcome === 'unknown')
        ? 'unknown'
        : 'pass';
    const severities = ['critical', 'error', 'warning', 'info'];
    const severity = severities.find((value) =>
      steps.some((step) =>
        step.validators?.some(
          (v) => v.outcome !== 'pass' && v.severity === value,
        ),
      ),
    );
    return {
      id: `browser-${crypto.randomUUID()}`,
      kind: 'check',
      checkId: definition.id,
      definition,
      dependencies: [],
      publishedValidators: [],
      queryValidators: [],
      environment: 'Pinned Chinook SQLite snapshot',
      inputNames: [],
      executionStatus: 'completed',
      outcome,
      severity,
      steps,
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      actor: 'browser visitor',
      checkInvocations: 1,
      queryExecutions: steps.length,
    };
  }
}
