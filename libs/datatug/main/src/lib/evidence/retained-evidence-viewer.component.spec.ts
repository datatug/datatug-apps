import { TestBed } from '@angular/core/testing';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject } from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { RetainedEvidenceViewerComponent } from './retained-evidence-viewer.component';
import { RetainedEvidenceApiService } from './retained-evidence-api.service';
import { readRetainedExecution } from './retained-open-contract';
import fixture from './testdata/backend-v044-retained.json';
const ref = {
  storeId: 'firestore',
  spaceID: 'fixture-space',
  projectId: 'fixture-project',
};
describe('Retained evidence native cold-open presentation', () => {
  it('renders the original admitted execution then synchronously withholds protected held content on actor change without rerunning', async () => {
    const auth = new BehaviorSubject({
        status: 'authenticated',
        user: { uid: 'current-reader' },
      }),
      read = vi.fn();
    const value = await readRetainedExecution(fixture.execution, {
      projectRef: ref,
      environment: 'demo',
      actor: 'current-reader',
    });
    read.mockResolvedValue(value);
    await TestBed.configureTestingModule({
      imports: [RetainedEvidenceViewerComponent],
      providers: [
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: new BehaviorSubject({ ref }) },
        },
        {
          provide: RetainedEvidenceApiService,
          useValue: { read, openRow: vi.fn() },
        },
      ],
    }).compileComponents();
    const page = TestBed.createComponent(RetainedEvidenceViewerComponent);
    page.componentRef.setInput('projectRef', ref);
    page.componentRef.setInput('environment', 'demo');
    page.componentRef.setInput('target', {
      kind: 'execution',
      execution: fixture.execution.result.execution,
    });
    page.detectChanges();
    await page.whenStable();
    await vi.waitFor(() =>
      expect(page.nativeElement.textContent).toContain(
        'Original actor fixture-actor',
      ),
    );
    expect(read).toHaveBeenCalledOnce();
    const signal = read.mock.calls[0][2] as AbortSignal;
    auth.next({ status: 'authenticated', user: { uid: 'other-reader' } });
    expect(signal.aborted).toBe(true);
    await page.whenStable();
    expect(page.nativeElement.textContent).not.toContain(
      'Original actor fixture-actor',
    );
    expect(read).toHaveBeenCalledOnce();
    page.destroy();
  });
});
