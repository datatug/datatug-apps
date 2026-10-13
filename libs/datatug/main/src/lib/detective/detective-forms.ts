import {
  CheckStepResult,
  CheckInput,
  DetectiveExecutionRef,
  DetectiveInputValue,
  DetectiveValue,
  ValidationResult,
} from './models';

export const detectiveSlug = /^[a-z][a-z0-9-]{0,127}$/u;

export function compatibleCaseInput(
  input: CheckInput,
  value: DetectiveInputValue | undefined,
): boolean {
  if (!value) return false;
  if (input.cardinality === 'set')
    return (
      value.type === 'set' &&
      value.values.length > 0 &&
      value.values.every((member) => member.type === input.type)
    );
  if (input.cardinality === 'range')
    return (
      value.type === 'range' &&
      value.start.type === input.type &&
      value.end.type === input.type
    );
  return value.type === input.type;
}

export interface IdentifierProposal {
  readonly key: 'order_id' | 'invoice_id';
  readonly value: DetectiveInputValue;
  readonly evidence: string;
}

/** Conservative local ticket parser. Every proposal still needs user confirmation. */
export function identifierProposals(text: string): IdentifierProposal[] {
  const found = new Map<
    IdentifierProposal['key'],
    { values: string[]; evidence: string[] }
  >();
  for (const match of text.matchAll(
    /\b(order|invoice)[\s_-]*ids?\s*[:#]?\s*([^.;\n]+)/giu,
  )) {
    const key = `${match[1].toLowerCase()}_id` as IdentifierProposal['key'];
    const entry = found.get(key) || { values: [], evidence: [] };
    for (const candidate of match[2].split(/\s*,\s*|\s+and\s+/iu)) {
      const id = candidate.trim();
      if (
        !/^[A-Za-z0-9-]+$/u.test(id) ||
        !(/[0-9-]/u.test(id) || (id === id.toUpperCase() && id.length >= 3))
      )
        continue;
      if (!entry.values.includes(id)) entry.values.push(id);
    }
    if (entry.values.length) entry.evidence.push(match[0]);
    found.set(key, entry);
  }
  return [...found]
    .filter(([, item]) => item.values.length)
    .map(([key, item]) => ({
      key,
      value:
        item.values.length === 1
          ? { type: 'string', value: item.values[0] }
          : {
              type: 'set',
              values: item.values.map((value) => ({ type: 'string', value })),
            },
      evidence: item.evidence.join('; '),
    }));
}

export function parseScalar(
  raw: string,
  type: DetectiveValue['type'],
): DetectiveValue {
  const value = raw.trim();
  switch (type) {
    case 'null':
      return { type, value: null };
    case 'boolean':
      if (value !== 'true' && value !== 'false')
        throw new Error('Use true or false.');
      return { type, value: value === 'true' };
    case 'number': {
      const number = Number(value);
      if (!value || !Number.isFinite(number))
        throw new Error('Enter a finite number.');
      return { type, value: number };
    }
    case 'integer':
      if (!/^-?(0|[1-9][0-9]*)$/u.test(value))
        throw new Error('Enter a decimal integer.');
      return { type, value };
    case 'decimal':
      if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(value))
        throw new Error('Enter a decimal value.');
      return { type, value };
    case 'date':
      if (
        !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
        Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
      )
        throw new Error('Use YYYY-MM-DD.');
      return { type, value };
    case 'datetime':
      if (!value || Number.isNaN(Date.parse(value)))
        throw new Error('Enter a date and time.');
      return { type, value: new Date(value).toISOString() };
    case 'string':
      return { type, value: raw };
  }
}

export function parseInputValue(
  raw: string,
  type: DetectiveValue['type'],
  cardinality: 'scalar' | 'set' | 'range',
  end = '',
): DetectiveInputValue {
  if (cardinality === 'scalar') return parseScalar(raw, type);
  if (cardinality === 'range') {
    if (!raw.trim() || !end.trim())
      throw new Error('Both range endpoints are required.');
    return {
      type: 'range',
      start: parseScalar(raw, type),
      end: parseScalar(end, type),
    };
  }
  const tokens = raw
    .split(/[,\n]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!tokens.length) throw new Error('Enter at least one value.');
  return {
    type: 'set',
    values: tokens.map((token) => parseScalar(token, type)),
  };
}

export function displayInputValue(value: DetectiveInputValue): string {
  if (value.type === 'set')
    return value.values.map((item) => displayInputValue(item)).join(', ');
  if (value.type === 'range')
    return `${displayInputValue(value.start)} – ${displayInputValue(value.end)}`;
  return value.type === 'null' ? 'null' : String(value.value);
}

export interface ResultLine {
  readonly key: string;
  readonly depth: number;
  readonly label: string;
  readonly executionStatus: string;
  readonly outcome: string;
  readonly severity: string;
  readonly message: string;
  readonly rowIndex?: number;
  readonly queryId?: string;
  readonly execution?: DetectiveExecutionRef;
  readonly nodePath?: string;
  readonly source?: string;
  readonly observedAt?: string;
  readonly executionProfile?: string;
  readonly queryRevision?: string;
  readonly resultFingerprint?: string;
}

export interface ValidatorGridRow {
  readonly id: string;
  readonly query: string;
  readonly row: string;
  readonly rowIndex?: number;
  readonly queryId?: string;
  readonly execution?: DetectiveExecutionRef;
  readonly nodePath: string;
  readonly validator: string;
  readonly outcome: string;
  readonly severity: string;
  readonly message: string;
}

export interface ValidationRowSelection {
  readonly rowIndex: number;
  readonly queryId?: string;
  readonly execution?: DetectiveExecutionRef;
  readonly nodePath: string;
}

/** Status-only rows from the exact persisted run; no query row values are retained. */
export function validatorGridRows(
  steps: readonly CheckStepResult[],
): ValidatorGridRow[] {
  const rows: ValidatorGridRow[] = [];
  const walk = (
    items: readonly CheckStepResult[],
    parentQuery = '',
    parentExecution?: DetectiveExecutionRef,
    prefix = 'root',
  ): void => {
    for (const [stepIndex, step] of items.entries()) {
      const nodePath = `${prefix}/${stepIndex}`;
      const query = step.queryId || parentQuery;
      const execution = step.execution || parentExecution;
      for (const [index, result] of (step.validators || []).entries()) {
        rows.push({
          id: `${step.stepId}/${index}/${rows.length}`,
          query,
          row:
            result.rowIndex === undefined ? 'Set' : String(result.rowIndex + 1),
          rowIndex: result.rowIndex,
          queryId: query,
          execution,
          nodePath: `${nodePath}/validator/${index}`,
          validator: result.validatorId,
          outcome: result.outcome,
          severity: result.severity,
          message: result.message || '',
        });
        walk(
          result.children || [],
          query,
          execution,
          `${nodePath}/validator/${index}`,
        );
      }
      walk(step.children || [], query, execution, nodePath);
    }
  };
  walk(steps);
  return rows;
}

/** Preserve the complete nested tree and row positions in a compact Ionic list. */
export function resultLines(steps: readonly CheckStepResult[]): ResultLine[] {
  const lines: ResultLine[] = [];
  const walk = (
    items: readonly CheckStepResult[],
    depth: number,
    prefix: string,
    parentQuery = '',
    parentExecution?: DetectiveExecutionRef,
  ) => {
    items.forEach((step, index) => {
      const key = `${prefix}/${index}`;
      const queryId = step.queryId || parentQuery;
      const execution = step.execution || parentExecution;
      lines.push({
        key,
        depth,
        label: `${step.kind === 'check' ? 'Check' : 'Query'} ${step.checkId || step.queryId || step.stepId}${step.rowCount !== undefined ? ` · ${step.rowCount} rows` : ''}`,
        executionStatus: step.executionStatus,
        outcome: step.outcome,
        severity: step.severity || '',
        message: step.message || '',
        source: step.source,
        observedAt: step.observedAt,
        executionProfile: step.executionProfile,
        queryRevision: step.queryRevision,
        resultFingerprint: step.resultFingerprint,
      });
      (step.validators || []).forEach(
        (validator: ValidationResult, validatorIndex) => {
          lines.push({
            key: `${key}/validator/${validatorIndex}`,
            depth: depth + 1,
            label: `Validator ${validator.validatorId}`,
            executionStatus: validator.executionStatus,
            outcome: validator.outcome,
            severity: validator.severity,
            message: validator.message || '',
            rowIndex: validator.rowIndex,
            queryId,
            execution,
            nodePath: `${key}/validator/${validatorIndex}`,
          });
          walk(
            validator.children || [],
            depth + 2,
            `${key}/validator/${validatorIndex}`,
            queryId,
            execution,
          );
        },
      );
      walk(step.children || [], depth + 1, key, queryId, execution);
    });
  };
  walk(steps, 0, 'root');
  return lines;
}
