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

  it('hides valid empty evidence in compact mode and keeps malformed evidence visible', async () => {
    const fixture = TestBed.createComponent(SourceRightsNoticeComponent);
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('evidence', {
      usedSourceIds: ['ovdb:fixture-server/music/Album'],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
    expect(fixture.nativeElement.querySelector('details')).toBeNull();

    fixture.componentRef.setInput('evidence', {
      sourceRights: [
        {
          ...fixtures.structured.sourceRights[0],
          declaration: { url: 'javascript:alert(1)' },
        },
      ],
    });
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[role=alert]').textContent,
    ).toContain('malformed or unsafe');
    expect(fixture.nativeElement.querySelector('details')).toBeNull();
  });

  it('keeps declared terms and missing-source evidence inside the compact disclosure', async () => {
    const fixture = TestBed.createComponent(SourceRightsNoticeComponent);
    const right = structuredClone(fixtures.structured.sourceRights[0]);
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('evidence', {
      sourceRights: [
        {
          ...right,
          attribution: { text: 'Credit this source' },
          transformations: ['Rows were normalized'],
        },
      ],
      usedSourceIds: [right.sourceId, 'ovdb:fixture-server/fx/another-source'],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('summary')?.textContent).toContain(
      'Source licences',
    );
    expect(
      element.querySelector('[data-testid="source-rights-details"]'),
    ).not.toBeNull();
    expect(element.textContent).toContain(
      'Check each source before sharing or reusing query results',
    );
    expect(element.textContent).toContain('Source credit: Credit this source');
    expect(element.textContent).toContain(
      'Transformation: Rows were normalized',
    );
    expect(element.textContent).toContain(
      'Source data terms not declared: ovdb:fixture-server/fx/another-source',
    );
    expect(element.querySelector('a')?.rel).toBe('noopener noreferrer');
  });
});
