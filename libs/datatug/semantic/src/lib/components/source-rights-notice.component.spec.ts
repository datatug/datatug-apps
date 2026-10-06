import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../contract/fixtures/client-only-source-rights.json';
import { SourceRightsNoticeComponent } from './source-rights-notice.component';

describe('captured result source notices', () => {
  it('shows absent legacy terms, URL/text/notices safely and never fetches links', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const fixture = TestBed.createComponent(SourceRightsNoticeComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Source data terms not declared',
    );
    const right = structuredClone(fixtures.structured.sourceRights[0]);
    const evidence = {
      sourceRights: [
        {
          ...right,
          attribution: { text: 'Example source <img src=x onerror=alert(1)>' },
          freeSource: {
            text: 'These data are freely available.',
            url: 'https://example.org/free.xml',
          },
          transformations: ['XML restructured into rows'],
        },
      ],
      usedSourceIds: fixtures.structured.usedSourceIds,
    };
    fixture.componentRef.setInput('evidence', evidence);
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Used by this result');
    expect(element.textContent).toContain('server declaration');
    expect(element.textContent).toContain('Source credit: Example source <img');
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toContain('freely available');
    expect(element.textContent).toContain('XML restructured');
    const links = Array.from(element.querySelectorAll('a'));
    expect(links).toHaveLength(2);
    expect(
      links.every(
        (a) => a.target === '_blank' && a.rel === 'noopener noreferrer',
      ),
    ).toBe(true);
    // Changes to a declaration object after decoding cannot rewrite the captured result.
    right.declaration.text = 'Changed current declaration';
    fixture.detectChanges();
    expect(element.textContent).not.toContain('Changed current declaration');
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });
  it('distinguishes planned unused input identities and refuses unsafe evidence', async () => {
    const fixture = TestBed.createComponent(SourceRightsNoticeComponent);
    fixture.componentRef.setInput('evidence', fixtures.multiSource);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('article')).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain(
      'Planned input; not reported used',
    );
    fixture.componentRef.setInput('evidence', {
      sourceRights: [
        {
          ...fixtures.structured.sourceRights[0],
          declaration: { url: 'javascript:alert(1)' },
        },
      ],
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('a')).toHaveLength(0);
    expect(
      fixture.nativeElement.querySelector('[role=alert]').textContent,
    ).toContain('malformed or unsafe');
  });
});
