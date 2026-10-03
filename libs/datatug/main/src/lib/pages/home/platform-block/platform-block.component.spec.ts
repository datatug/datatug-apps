import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlatformBlockComponent } from './platform-block.component';
import { PLATFORM_PARTS } from './platform-parts';

describe('PlatformBlockComponent', () => {
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlatformBlockComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();
    const fixture: ComponentFixture<PlatformBlockComponent> =
      TestBed.createComponent(PlatformBlockComponent);
    fixture.detectChanges();
    root = fixture.nativeElement;
  });

  const part = (id: string) =>
    root.querySelector(`[data-part="${id}"]`) as HTMLElement;
  const statuses = (id: string) =>
    Array.from(part(id).querySelectorAll('.chips li')).map(
      (li) => (li as HTMLElement).dataset['status'],
    );

  it('says the heading and the intro, in the sites wording', () => {
    expect(root.querySelector('h2')?.textContent).toBe(
      'One platform, four ways in.',
    );
    expect(root.querySelector('.lede')?.textContent).toBe(
      'Work in the browser or the terminal, or let your coding agent do it. Each part shows how finished it is.',
    );
  });

  it('shows the four parts, in order', () => {
    const ids = Array.from(root.querySelectorAll('.part')).map(
      (li) => (li as HTMLElement).dataset['part'],
    );
    expect(ids).toEqual(['app', 'terminal', 'skills', 'mcp-app']);
    const names = Array.from(root.querySelectorAll('.name')).map((n) =>
      n.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(names[0]).toContain('DataTug.app');
    expect(names[1]).toContain('Terminal app');
    expect(names[2]).toContain('AI skills');
    expect(names[3]).toContain('MCP web app');
  });

  it('mirrors the sites statuses: app, terminal and skills plugin available; MCP server and MCP web app planned', () => {
    expect(statuses('app')).toEqual(['available']);
    expect(statuses('terminal')).toEqual(['available']);
    expect(statuses('skills')).toEqual(['available', 'planned']);
    expect(statuses('mcp-app')).toEqual(['planned']);
    expect(part('skills').textContent).toContain('Skills plugin');
    expect(part('skills').textContent).toContain('MCP server');
    expect(part('app').textContent).toContain('Available');
    expect(part('mcp-app').textContent).toContain('Planned');
  });

  it('links the other three parts to the sites, in a new tab; DataTug.app does not link to itself', () => {
    const link = (id: string) =>
      part(id).querySelector('a[data-part-link]') as HTMLAnchorElement | null;
    expect(link('app')).toBeNull();
    expect(part('app').querySelector('[aria-current="page"]')).toBeTruthy();
    expect(part('app').textContent).toContain('You are here');
    expect(link('terminal')?.getAttribute('href')).toBe(
      'https://datatug.io/apps/cli/',
    );
    expect(link('skills')?.getAttribute('href')).toBe(
      'https://datatug.ai/skills/',
    );
    expect(link('mcp-app')?.getAttribute('href')).toBe(
      'https://datatug.ai/#way-agent',
    );
    for (const id of ['terminal', 'skills', 'mcp-app']) {
      expect(link(id)?.getAttribute('target')).toBe('_blank');
      expect(link(id)?.getAttribute('rel')).toBe('noopener');
    }
  });

  it('keeps the data constant and the rendered parts in step', () => {
    expect(PLATFORM_PARTS.map((p) => p.id)).toEqual([
      'app',
      'terminal',
      'skills',
      'mcp-app',
    ]);
    expect(root.querySelectorAll('.part')).toHaveLength(PLATFORM_PARTS.length);
  });
});
