import { TestBed } from '@angular/core/testing';
import { ActivityListComponent } from './activity-list.component';
import { type ActivityListItem } from './activity-list-item';

// A second, independent presentation fixture; no backend capability is claimed.
const documentActivity: readonly ActivityListItem[] = [
  {
    id: 'document-revision-17',
    title: 'Revision saved',
    outcome: 'Recorded',
    acceptedAt: '2026-10-22T06:00:00Z',
    metadata: 'Revision 17',
    detail: { label: 'Change details', text: 'Document title updated' },
    openLabel: 'Open revision',
  },
  {
    id: 'document-revision-18',
    title: 'Review completed',
    outcome: 'Acknowledged',
    acceptedAt: '2026-10-22T06:01:00Z',
    openLabel: 'Open review',
  },
];

describe('neutral activity presentation', () => {
  async function mount() {
    const f = TestBed.createComponent(ActivityListComponent);
    for (const [key, value] of Object.entries({
      heading: 'Document activity',
      actionLabel: 'Refresh activity',
      listLabel: 'Document revisions',
      loadingMessage: 'Loading revisions…',
      emptyMessage: 'No revisions available.',
    }))
      f.componentRef.setInput(key, value);
    f.detectChanges();
    await f.whenStable();
    return f;
  }
  it('renders a second data source after initial render and emits only opaque owner-selected IDs', async () => {
    const f = await mount();
    const opened = vi.fn(),
      reload = vi.fn();
    f.componentInstance.openItem.subscribe(opened);
    f.componentInstance.reload.subscribe(reload);
    f.componentRef.setInput('items', documentActivity);
    await f.whenStable();
    const root = f.nativeElement as HTMLElement;
    expect(root.querySelector('h2')?.textContent).toBe('Document activity');
    expect(root.querySelectorAll('li')).toHaveLength(2);
    expect(root.textContent).toContain('Review completed');
    expect(root.textContent).toContain('Acknowledged');
    expect(root.querySelector('time')?.getAttribute('datetime')).toBe(
      documentActivity[0].acceptedAt,
    );
    expect(root.querySelector('summary')?.textContent).toBe('Change details');
    expect(root.textContent).toContain('Document title updated');
    expect(root.querySelector('ion-card')).toBeNull();
    expect(root.textContent).not.toMatch(
      /Shipping|receipt|generation|recovery/,
    );
    root.querySelector<HTMLElement>('li ion-button')?.click();
    expect(opened).toHaveBeenCalledExactlyOnceWith('document-revision-17');
    root.querySelector<HTMLElement>('header ion-button')?.click();
    expect(reload).toHaveBeenCalledExactlyOnceWith(undefined);
  });
  it('handles unloaded, loading, empty, error and disabled states with supplied accessible copy', async () => {
    const f = await mount();
    const root = f.nativeElement as HTMLElement;
    expect(root.querySelector('ul')).toBeNull();
    f.componentRef.setInput('loading', true);
    await f.whenStable();
    expect(root.querySelector('[role=status]')?.textContent).toBe(
      'Loading revisions…',
    );
    expect(root.querySelector('header ion-button')?.textContent?.trim()).toBe(
      'Refresh activity',
    );
    f.componentRef.setInput('loading', false);
    f.componentRef.setInput('items', []);
    await f.whenStable();
    expect(root.textContent).toContain('No revisions available.');
    f.componentRef.setInput('error', 'Current access is unavailable.');
    f.componentRef.setInput('disabled', true);
    f.componentRef.setInput('items', documentActivity);
    await f.whenStable();
    expect(root.querySelector('[role=alert]')?.textContent).toBe(
      'Current access is unavailable.',
    );
    expect(
      (
        root.querySelector('li ion-button') as HTMLElement & {
          disabled: boolean;
        }
      ).disabled,
    ).toBe(true);
    expect(f.componentInstance.disabled()).toBe(true);
  });
});
