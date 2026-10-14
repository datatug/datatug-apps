import {
  CheckDefinition,
  DetectiveState,
  PublishedValidator,
  ValidatorDefinition,
} from './models';

export interface CheckInspection {
  checks: CheckDefinition[];
  queryIds: string[];
  validators: {
    definition: ValidatorDefinition;
    published?: PublishedValidator;
  }[];
  missing: string[];
}

/** Catalog references are descriptive; execution still resolves the current server catalog. */
export function inspectCheck(
  check: CheckDefinition,
  state: DetectiveState,
): CheckInspection {
  const checks: CheckDefinition[] = [];
  const queryIds = new Set<string>();
  const validators: CheckInspection['validators'] = [];
  const missing = new Set<string>();
  const visited = new Set<string>([check.id]);
  const byId = new Map(state.checks.map((item) => [item.id, item]));
  const publishedById = new Map(
    state.validators.map((item) => [item.id, item]),
  );

  function visitCheck(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const dependency = byId.get(id);
    if (!dependency) {
      missing.add(`Check ${id}`);
      return;
    }
    checks.push(dependency);
    visit(dependency);
  }
  function visitValidator(validator: ValidatorDefinition): void {
    const published = validator.validatorId
      ? publishedById.get(validator.validatorId)
      : undefined;
    if (validator.validatorId && !published)
      missing.add(`Validator ${validator.validatorId}`);
    const definition = published?.validator || validator;
    validators.push({ definition, published });
    if (definition.checkId) visitCheck(definition.checkId);
  }
  function visit(definition: CheckDefinition): void {
    for (const step of definition.steps) {
      if (step.queryId && !queryIds.has(step.queryId)) {
        queryIds.add(step.queryId);
        for (const local of state.queryValidators.find(
          (item) => item.queryId === step.queryId,
        )?.validators || [])
          visitValidator(local);
      }
      if (step.checkId) visitCheck(step.checkId);
      for (const validator of step.validators || []) visitValidator(validator);
    }
  }
  visit(check);
  return { checks, queryIds: [...queryIds], validators, missing: [...missing] };
}

export function checkConsumers(checkId: string, state: DetectiveState) {
  const references = (validator: ValidatorDefinition) =>
    validator.checkId === checkId ||
    (!!validator.validatorId &&
      state.validators.some(
        (published) =>
          published.id === validator.validatorId &&
          published.validator.checkId === checkId,
      ));
  return {
    checks: state.checks.filter(
      (check) =>
        check.id !== checkId &&
        check.steps.some(
          (step) =>
            step.checkId === checkId || step.validators?.some(references),
        ),
    ),
    validators: state.validators.filter(
      (published) => published.validator.checkId === checkId,
    ),
    queries: state.queryValidators.filter((query) =>
      query.validators.some(references),
    ),
  };
}
