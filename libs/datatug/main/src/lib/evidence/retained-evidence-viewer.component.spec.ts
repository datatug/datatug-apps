import { NativeSourceInvalidationService } from './native-source-invalidation';
import { TestBed } from '@angular/core/testing';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject } from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { RetainedEvidenceViewerComponent } from './retained-evidence-viewer.component';
import { RetainedEvidenceApiService } from './retained-evidence-api.service';
import { readRetainedExecution } from './retained-open-contract';
import { originalContractFixture } from './original-evidence.spec-helper';
import fixture from './testdata/backend-v044-retained.json';
const ref = {
  storeId: 'firestore',
  spaceID: 'fixture-space',
  projectId: 'fixture-project',
};
describe('Retained evidence native cold-open presentation', () => {
  it.each([
    { change: 'actor', invalidates: true, original: 'available' },
    { change: 'actor', invalidates: true, original: 'unavailable' },
    { change: 'source-reset', invalidates: false, original: 'available' },
    { change: 'source-reset', invalidates: false, original: 'unavailable' },
  ] as const)(
    'renders immutable retained evidence when $change occurs (invalidates current viewer: $invalidates)',
    async ({ change, invalidates, original }) => {
      const auth = new BehaviorSubject({
          status: 'authenticated',
          user: { uid: 'current-reader' },
        }),
        read = vi.fn();
      const value = await readRetainedExecution(
        {
          ...fixture.execution,
          originalEvidence:
            original === 'available'
              ? originalContractFixture()
              : { version: 1, status: 'unavailable', reason: 'not-admitted' },
        },
        {
          projectRef: ref,
          environment: 'demo',
          actor: 'current-reader',
          nativeDatabaseId: 'fixture-db',
          nativeProjectId: 'fixture-project',
        },
      );
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
      const section = page.nativeElement.querySelector(
        '[aria-label="Original evidence"]',
      );
      expect(section.querySelector('header h4').textContent).toBe(
        'Original evidence',
      );
      expect(section.querySelector('ion-card')).toBeNull();
      if (original === 'available') {
        expect(section.textContent).toContain('historical configuration 17');
        expect(section.textContent).toContain('route-expired');
        expect(section.textContent).toContain('2026-10-21T00:00:00Z');
        expect(
          section.querySelector('pre[aria-label="Original log text"]')
            .textContent,
        ).toContain('"event_id":"event-blocked"');
        expect(section.textContent).toContain(
          'actual-reader-reference-required-at-parity',
        );
      } else {
        expect(section.textContent).toContain('not-admitted');
        expect(section.querySelector('pre')).toBeNull();
        expect(
          page.nativeElement.querySelector(
            'sneat-datatug-held-result-presentation',
          ),
        ).not.toBeNull();
      }
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
      if (invalidates) {
        expect(page.nativeElement.textContent).not.toContain(
          'Original actor fixture-actor',
        );
        expect(
          page.nativeElement.querySelector('[aria-label="Original evidence"]'),
        ).toBeNull();
      } else
        expect(page.nativeElement.textContent).toContain(
          'Original actor fixture-actor',
        );
      expect(read).toHaveBeenCalledOnce();
      page.destroy();
    },
  );
  it.each(['late-account', 'retry-denial'] as const)(
    'clears all original protected content for %s',
    async (mode) => {
      const auth = new BehaviorSubject({
        status: 'authenticated',
        user: { uid: 'current-reader' },
      });
      const value = await readRetainedExecution(
        { ...fixture.execution, originalEvidence: originalContractFixture() },
        {
          projectRef: ref,
          environment: 'demo',
          actor: 'current-reader',
          nativeDatabaseId: 'fixture-db',
          nativeProjectId: 'fixture-project',
        },
      );
      let resolve!: (resolved: typeof value) => void;
      const read = vi
        .fn()
        .mockImplementationOnce(() =>
          mode === 'late-account'
            ? new Promise((done) => {
                resolve = done;
              })
            : Promise.resolve(value),
        )
        .mockRejectedValue({ status: 403 });
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
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      if (mode === 'late-account') {
        auth.next({ status: 'authenticated', user: { uid: 'other-reader' } });
        resolve(value);
      } else {
        await vi.waitFor(() =>
          expect(page.nativeElement.textContent).toContain('event-blocked'),
        );
        // Read retries clear the previous protected result before dispatch.
        (
          page.componentInstance as unknown as {
            retry: { update: (fn: (n: number) => number) => void };
          }
        ).retry.update((n) => n + 1);
      }
      await page.whenStable();
      await vi.waitFor(() =>
        expect(
          page.nativeElement.querySelector('[aria-label="Original evidence"]'),
        ).toBeNull(),
      );
      expect(page.nativeElement.textContent).not.toContain('event-blocked');
      expect(page.nativeElement.textContent).not.toContain(
        'actual-reader-reference-required-at-parity',
      );
      if (mode === 'retry-denial') {
        await vi.waitFor(() =>
          expect(page.nativeElement.textContent).toContain(
            'no longer available',
          ),
        );
        const retry = page.nativeElement.querySelector(
          'header ion-button[title="Retry current evidence read"]',
        );
        expect(retry).not.toBeNull();
        expect(
          retry.shadowRoot?.querySelector(
            '[aria-label="Retry current evidence read"]',
          ),
        ).not.toBeNull();
      }
      page.destroy();
    },
  );
});
