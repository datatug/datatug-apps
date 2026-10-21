import { NativeSourceInvalidationService } from './native-source-invalidation';
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
  it.each([
    { change: 'actor', invalidates: true },
    { change: 'source-reset', invalidates: false },
  ] as const)(
    'renders immutable retained evidence when $change occurs (invalidates current viewer: $invalidates)',
    async ({ change, invalidates }) => {
      const auth = new BehaviorSubject({
          status: 'authenticated',
          user: { uid: 'current-reader' },
        }),
        read = vi.fn();
      const value = await readRetainedExecution(fixture.execution, {
        projectRef: ref,
        environment: 'demo',
        actor: 'current-reader',
        nativeDatabaseId: 'fixture-db',
        nativeProjectId: 'fixture-project',
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
      if (change === 'actor')
        auth.next({ status: 'authenticated', user: { uid: 'other-reader' } });
      else
        TestBed.inject(NativeSourceInvalidationService).invalidate({
          projectRef: ref,
          actor: 'current-reader',
          sourceId: 'shipping-working-copy',
          action: 'reset',
        });
      expect(signal.aborted).toBe(invalidates);
      await page.whenStable();
      if (invalidates)
        expect(page.nativeElement.textContent).not.toContain(
          'Original actor fixture-actor',
        );
      else
        expect(page.nativeElement.textContent).toContain(
          'Original actor fixture-actor',
        );
      expect(read).toHaveBeenCalledOnce();
      page.destroy();
    },
  );
});
