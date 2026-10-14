import { checkConsumers, inspectCheck } from './check-inspection';
import { CheckDefinition, DetectiveState } from './models';

const check = (
  id: string,
  steps: CheckDefinition['steps'],
): CheckDefinition => ({
  id,
  title: id,
  version: 1,
  inputs: [],
  steps,
});

it('shows transitive catalog dependencies and all direct consumers', () => {
  const root = check('root', [
    { id: 'root-step', kind: 'check', checkId: 'child' },
  ]);
  const child = check('child', [
    {
      id: 'query-step',
      kind: 'query',
      queryId: 'finance/invoices',
      validators: [
        {
          id: 'local',
          scope: 'row',
          kind: 'check',
          checkId: 'leaf',
          severity: 'error',
        },
        {
          id: 'reused',
          validatorId: 'shared',
          scope: 'row',
          kind: '',
          severity: 'warning',
        },
      ],
    },
  ]);
  const leaf = check('leaf', []);
  const state = {
    checks: [root, child, leaf],
    validators: [
      {
        id: 'shared',
        title: 'Shared check',
        version: 1,
        validator: {
          id: 'shared',
          scope: 'row',
          kind: 'check',
          checkId: 'leaf',
          severity: 'warning',
        },
      },
    ],
    queryValidators: [
      {
        queryId: 'finance/invoices',
        version: 1,
        validators: [
          {
            id: 'query-ref',
            validatorId: 'shared',
            scope: 'row',
            kind: '',
            severity: 'warning',
          },
        ],
      },
    ],
  } as DetectiveState;
  const dependencies = inspectCheck(root, state);
  expect(dependencies.checks.map((item) => item.id)).toEqual(['child', 'leaf']);
  expect(dependencies.queryIds).toEqual(['finance/invoices']);
  expect(dependencies.validators).toHaveLength(3);
  expect(dependencies.missing).toEqual([]);
  const consumers = checkConsumers('leaf', state);
  expect(consumers.checks.map((item) => item.id)).toEqual(['child']);
  expect(consumers.validators.map((item) => item.id)).toEqual(['shared']);
  expect(consumers.queries.map((item) => item.queryId)).toEqual([
    'finance/invoices',
  ]);
});

it('surfaces unresolved definitions without following cyclic Check references forever', () => {
  const root = check('root', [
    { id: 'cycle', kind: 'check', checkId: 'child' },
    {
      id: 'missing',
      kind: 'query',
      queryId: 'saved/query',
      validators: [
        {
          id: 'missing-published',
          validatorId: 'gone',
          scope: 'row',
          kind: '',
          severity: 'error',
        },
      ],
    },
  ]);
  const child = check('child', [
    { id: 'back', kind: 'check', checkId: 'root' },
  ]);
  const state = {
    checks: [root, child],
    validators: [],
    queryValidators: [],
  } as unknown as DetectiveState;
  expect(inspectCheck(root, state)).toMatchObject({
    checks: [child],
    queryIds: ['saved/query'],
    missing: ['Validator gone'],
  });
});
