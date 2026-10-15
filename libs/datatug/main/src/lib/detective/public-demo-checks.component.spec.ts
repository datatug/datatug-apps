import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { DEMO_PROJECT_REF } from '@datatug/project-address';
import { PublicDemoChecksComponent } from './public-demo-checks.component';
import { PublicDemoChecksService } from './public-demo-checks.service';
import { CheckDefinition } from './models';

const sample: CheckDefinition = {
  id: 'customers',
  title: 'Customer coverage',
  version: 1,
  inputs: [],
  steps: [
    {
      id: 'customers',
      kind: 'query',
      queryId: 'demodb/customers',
      validators: [
        {
          id: 'count',
          kind: 'row-count',
          scope: 'set',
          severity: 'error',
          expected: { type: 'integer', value: '59' },
        },
      ],
    },
  ],
};

describe('public Checks page states', () => {
  const service = { load: vi.fn(), run: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      imports: [PublicDemoChecksComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: PublicDemoChecksService, useValue: service },
      ],
    });
  });
  it('renders asynchronous definitions without a follow-up user interaction', async () => {
    let resolve!: (checks: CheckDefinition[]) => void;
    service.load.mockReturnValue(
      new Promise<CheckDefinition[]>((done) => {
        resolve = done;
      }),
    );
    const fixture = TestBed.createComponent(PublicDemoChecksComponent);
    fixture.componentRef.setInput('project', DEMO_PROJECT_REF);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Loading public Checks',
    );
    resolve([sample]);
    await Promise.resolve();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Customer coverage');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Loading public Checks',
    );
  });
  it('shows empty, not-found and unsupported states', async () => {
    service.load.mockResolvedValue([]);
    const fixture = TestBed.createComponent(PublicDemoChecksComponent);
    fixture.componentRef.setInput('project', DEMO_PROJECT_REF);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'No public Checks have been published',
    );
    fixture.componentRef.setInput('checkId', 'missing');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'This Check was not found',
    );
  });
  it('shows a load error and supports retry', async () => {
    service.load
      .mockRejectedValueOnce(new Error('GitHub unavailable'))
      .mockResolvedValueOnce([sample]);
    const fixture = TestBed.createComponent(PublicDemoChecksComponent);
    fixture.componentRef.setInput('project', DEMO_PROJECT_REF);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('GitHub unavailable');
    fixture.nativeElement.querySelector('ion-button').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Customer coverage');
  });
  it('blocks duplicate runs and discards a result after changing Check', async () => {
    service.load.mockResolvedValue([sample]);
    let reject!: (error: Error) => void;
    service.run.mockReturnValue(
      new Promise((_, failed) => {
        reject = failed;
      }),
    );
    const fixture = TestBed.createComponent(PublicDemoChecksComponent);
    fixture.componentRef.setInput('project', DEMO_PROJECT_REF);
    fixture.componentRef.setInput('checkId', 'customers');
    await fixture.whenStable();
    const component = fixture.componentInstance as unknown as {
      run(): Promise<void>;
      busy(): boolean;
      error(): string;
    };
    const run = component.run();
    await component.run();
    expect(service.run).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('checkId', 'missing');
    fixture.detectChanges();
    reject(new Error('old execution failed'));
    await run;
    expect(component.error()).toBe('');
    expect(component.busy()).toBe(false);
  });
});
