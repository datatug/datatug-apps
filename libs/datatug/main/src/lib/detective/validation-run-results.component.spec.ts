import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AgGridAngular } from 'ag-grid-angular';
import { ValidationRunResultsComponent } from './validation-run-results.component';
import { ValidatorGridRow, ValidationRowSelection } from './detective-forms';
import { CheckRun, CheckStepResult, DetectiveExecutionRef } from './models';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- models AG Grid inputs and row activation
  selector: 'ag-grid-angular',
  template: `@for (row of rowData(); track row.id) { <span class="grid-row">{{ row.validator }}:{{ row.outcome }}</span> }`,
})
class GridStubComponent {
  readonly rowData = input<ValidatorGridRow[]>([]);
  readonly columnDefs = input<unknown>();
  readonly defaultColDef = input<unknown>();
  readonly rowClicked = output<{ data?: ValidatorGridRow }>();
}

const execution: DetectiveExecutionRef = { storeId: 'store', projectId: 'project', executionId: 'exec-1' };

function step(overrides: Partial<CheckStepResult> = {}): CheckStepResult {
  return {
    stepId: 'q1', kind: 'query', queryId: 'orders', executionStatus: 'completed', outcome: 'fail', severity: 'error',
    rowCount: 3, execution, source: 'sqlite', observedAt: '2026-01-01', executionProfile: 'local',
    queryRevision: 'rev-7', resultFingerprint: 'fp-9',
    validators: [
      { validatorId: 'not-null', executionStatus: 'completed', outcome: 'fail', severity: 'error', rowIndex: 1, message: 'Missing total' },
      { validatorId: 'positive', executionStatus: 'completed', outcome: 'pass', severity: 'warning', rowIndex: 0 },
      { validatorId: 'shape', executionStatus: 'skipped', outcome: 'unknown', severity: 'info' },
    ],
    ...overrides,
  };
}

function run(steps: CheckStepResult[] = [step()], overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 'run-1', kind: 'check', checkId: 'orders-check', definition: {} as CheckRun['definition'], dependencies: [],
    publishedValidators: [], queryValidators: [], environment: 'demo', inputNames: ['order_id'],
    executionStatus: 'completed', outcome: 'fail', severity: 'error', steps, startedAt: '2026-01-02T03:04:05Z',
    durationMs: 10, actor: 'alice', checkInvocations: 1, queryExecutions: 2, ...overrides,
  };
}

async function setup(value: CheckRun = run(), root: { execution?: DetectiveExecutionRef; queryId?: string } = { execution, queryId: 'orders' }) {
  TestBed.overrideComponent(ValidationRunResultsComponent, {
    remove: { imports: [AgGridAngular] }, add: { imports: [GridStubComponent] },
  });
  TestBed.configureTestingModule({ imports: [ValidationRunResultsComponent] });
  const fixture = TestBed.createComponent(ValidationRunResultsComponent);
  fixture.componentRef.setInput('run', value);
  fixture.componentRef.setInput('rootExecution', root.execution);
  fixture.componentRef.setInput('rootQueryId', root.queryId);
  const selected: ValidationRowSelection[] = [];
  fixture.componentInstance.rowSelected.subscribe((selection) => selected.push(selection));
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  // Ionic's scoped-slot patch hides light-DOM text from `textContent` in jsdom, so read the markup instead.
  const text = () => el.innerHTML.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const items = (): HTMLElement[] => Array.from(el.querySelectorAll('ion-item'));
  const grid = () => fixture.debugElement.query(By.directive(GridStubComponent))?.componentInstance as GridStubComponent | undefined;
  const toggle = () => el.querySelector('ion-button') as HTMLElement | null;
  const item = (label: string) => items().find((node) => node.innerHTML.includes(label)) as HTMLElement;
  const gridRows = async () => {
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(grid()).toBeDefined();
    });
    return grid()?.rowData() ?? [];
  };
  return { fixture, el, text, item, grid, gridRows, toggle, selected };
}

describe('ValidationRunResultsComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('summarizes the run and counts validator outcomes', async () => {
    const { text } = await setup();
    expect(text()).toContain('run-1');
    expect(text()).toContain('demo · execution completed · outcome fail · highest finding severity error');
    expect(text()).toContain('2 query executions; 1 Check invocations');
    expect(text()).toContain('order_id recorded');
    expect(text()).toContain('Validator results: 1 failed, 1 unknown, 1 passed.');
    expect(text()).toContain('Passing details are collapsed.');
  });

  it('falls back to "none" severity and "no input names" when absent', async () => {
    const { text } = await setup(run([], { severity: undefined, inputNames: [] }));
    expect(text()).toContain('highest finding severity none');
    expect(text()).toContain('no input names recorded');
    expect(text()).toContain('Validator results: 0 failed, 0 unknown, 0 passed.');
  });

  it('hides passing rows and lines until expanded, then collapses again', async () => {
    const { fixture, text, gridRows, toggle } = await setup();
    expect((await gridRows()).map((row) => row.validator)).toEqual(['not-null', 'shape']);
    expect(text()).not.toContain('Validator positive');
    expect(toggle()?.textContent).toContain('Show all passing details');

    toggle()?.click();
    await fixture.whenStable();
    expect((await gridRows()).map((row) => row.validator)).toEqual(['not-null', 'positive', 'shape']);
    expect(text()).toContain('Validator positive');
    expect(text()).not.toContain('Passing details are collapsed.');
    expect(toggle()?.textContent).toContain('Collapse passing details');

    toggle()?.click();
    await fixture.whenStable();
    expect(await gridRows()).toHaveLength(2);
  });

  it('omits the toggle and grid when the run has no validator rows', async () => {
    const { toggle, grid, text } = await setup(run([step({ validators: [], outcome: 'pass' })]));
    expect(toggle()).toBeNull();
    expect(grid()).toBeUndefined();
    expect(text()).not.toContain('Filter by outcome');
  });

  it('keeps the grid hidden when only passing rows exist and they are collapsed', async () => {
    const passing = step({ outcome: 'pass', validators: [{ validatorId: 'ok', executionStatus: 'completed', outcome: 'pass', severity: 'info', rowIndex: 0 }] });
    const { grid, gridRows, text, toggle } = await setup(run([passing]));
    expect(text()).toContain('Filter by outcome');
    expect(grid()).toBeUndefined();
    toggle()?.click();
    expect(await gridRows()).toHaveLength(1);
  });

  it('renders step details including source, revision and fingerprint', async () => {
    const { text } = await setup();
    expect(text()).toContain('Query orders · 3 rows');
    expect(text()).toContain('configured severity error (applies on failure)');
    expect(text()).toContain('sqlite · observed 2026-01-01 · local · query rev-7 · result fp-9');
    expect(text()).toContain('Validator not-null · row 2');
    expect(text()).toContain('Missing total');
  });

  it('keeps ancestors of nested failing lines while passing siblings are collapsed', async () => {
    const nested = step({
      stepId: 'c1', kind: 'check', checkId: 'parent', queryId: undefined, outcome: 'fail', validators: [],
      children: [step({ stepId: 'q2', queryId: 'lines', validators: [{ validatorId: 'deep', executionStatus: 'completed', outcome: 'fail', severity: 'error', rowIndex: 4 }] })],
    });
    const passing = step({ stepId: 'q3', queryId: 'ok', outcome: 'pass', validators: [{ validatorId: 'fine', executionStatus: 'completed', outcome: 'pass', severity: 'info' }] });
    const { text } = await setup(run([nested, passing]));
    expect(text()).toContain('Check parent');
    expect(text()).toContain('Query lines');
    expect(text()).toContain('Validator deep · row 5 · lines child-local row; snapshot drilldown unavailable');
    expect(text()).not.toContain('Validator fine');
  });

  it('emits a selection when an eligible root validator line is clicked', async () => {
    const { item, selected } = await setup();
    item('Validator not-null').click();
    expect(selected).toEqual([{ rowIndex: 1, queryId: 'orders', execution, nodePath: 'root/0/validator/0' }]);
  });

  it.each([
    ['there is no root execution', { queryId: 'orders' }],
    ['the root query differs', { execution, queryId: 'other' }],
    ['the execution id differs', { execution: { ...execution, executionId: 'exec-2' }, queryId: 'orders' }],
  ])('marks rows as child-local and ignores clicks when %s', async (_label, root) => {
    const { item, selected, text } = await setup(run(), root);
    expect(text()).toContain('Validator not-null · row 2 · orders child-local row; snapshot drilldown unavailable');
    item('Validator not-null').click();
    expect(selected).toEqual([]);
  });

  it('does not emit for a set-level line without a row index', async () => {
    const { item, selected } = await setup();
    item('Validator shape').click();
    expect(selected).toEqual([]);
  });

  it('emits from a grid row click only for eligible rows', async () => {
    const { grid, gridRows, selected } = await setup();
    const rows = await gridRows();
    grid()?.rowClicked.emit({ data: rows[0] });
    grid()?.rowClicked.emit({ data: rows[1] });
    grid()?.rowClicked.emit({});
    expect(selected).toEqual([{ rowIndex: 1, queryId: 'orders', execution, nodePath: 'root/0/validator/0' }]);
  });

  it('re-renders when a new run input arrives after the first render', async () => {
    const { fixture, text } = await setup();
    fixture.componentRef.setInput('run', run([], { id: 'run-2', outcome: 'pass' }));
    await fixture.whenStable();
    expect(text()).toContain('run-2');
    expect(text()).toContain('Validator results: 0 failed, 0 unknown, 0 passed.');
  });
});
