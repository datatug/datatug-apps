import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { SOURCE_ADAPTER_REGISTRATIONS } from './source-workspace-contract';
import { SourceEntriesComponent } from './source-entries.component';

const context = vi.hoisted(() => ({ page: undefined as unknown }));
vi.mock('../detective/detective-page-context', () => ({
  useDetectivePageContext: () => context.page,
}));

describe('neutral source discovery lifetime', () => {
  it('rejects ignored-abort discovery from the old actor and clears links immediately on scope replacement', async () => {
    const actor = signal('actor-a'),
      changes = new Subject<string | undefined>(),
      pending: {
        actor: string;
        abort: AbortSignal;
        resolve: (value: { title: string }) => void;
      }[] = [];
    context.page = {
      ref: () => ({ storeId: 'firestore', spaceID: 'S1', projectId: 'p' }),
      identity: actor,
      context: () => ({ principal: actor() }),
      currentEnvironment: () => undefined,
      scopeChanges$: changes,
    };
    TestBed.configureTestingModule({
      imports: [SourceEntriesComponent],
      providers: [
        provideRouter([]),
        {
          provide: SOURCE_ADAPTER_REGISTRATIONS,
          useValue: [
            {
              sourceId: 'dataset-copy',
              discover: (scope: { actor: string }, abort: AbortSignal) =>
                new Promise<{ title: string }>((resolve) =>
                  pending.push({ actor: scope.actor, abort, resolve }),
                ),
            },
          ],
        },
      ],
    });
    const fixture = TestBed.createComponent(SourceEntriesComponent);
    fixture.detectChanges();
    expect(pending[0].actor).toBe('actor-a');
    actor.set('actor-b');
    changes.next(undefined);
    fixture.detectChanges();
    expect(pending[0].abort.aborted).toBe(true);
    pending[0].resolve({ title: 'Private old source' });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Private old source',
    );
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
    pending[1].resolve({ title: 'Current source' });
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).toContain('Current source'),
    );
    actor.set('actor-c');
    changes.next(undefined);
    expect(fixture.componentInstance.entries()).toEqual([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
    fixture.destroy();
    pending[2].resolve({ title: 'Late destroyed source' });
    await Promise.resolve();
    expect(pending[2].abort.aborted).toBe(true);
  });
});
