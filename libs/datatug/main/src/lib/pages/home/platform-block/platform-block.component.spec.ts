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
    Array.from(part(id).querySelectorAll('.mechanisms li')).map(
      (li) => (li as HTMLElement).dataset['status'],
    );

  it('uses the requested secondary-entry heading and intro', () => {
    expect(root.querySelector('h2')?.textContent).toBe(
      'Other ways to use DataTug',
    );
    expect(root.querySelector('.lede')?.textContent).toContain(
      'terminal or connect it to your AI agent',
    );
  });

  it('shows only Terminal / CLI and AI agent as the two options', () => {
    const ids = Array.from(root.querySelectorAll('.part')).map(
      (item) => (item as HTMLElement).dataset['part'],
    );
    expect(ids).toEqual(['terminal', 'agent']);
    expect(part('terminal').textContent).toContain('TugQL');
    expect(part('terminal').textContent).toContain('datatug CLI');
    expect(part('agent').textContent).toContain('Claude Code');
  });

  it('marks CLI skills available and both MCP mechanisms planned', () => {
    expect(statuses('terminal')).toEqual(['available']);
    expect(statuses('agent')).toEqual(['available', 'planned', 'planned']);
    expect(part('agent').textContent).toContain('CLI skills');
    expect(part('agent').textContent).toContain('MCP server');
    expect(part('agent').textContent).toContain('MCP web app');
    expect(part('agent').textContent).toContain('Planned');
  });

  it('links each option to its current product documentation', () => {
    const terminal = part('terminal').querySelector('a') as HTMLAnchorElement;
    const agent = part('agent').querySelector('a') as HTMLAnchorElement;
    expect(terminal.href).toBe('https://datatug.io/apps/cli/');
    expect(agent.href).toBe('https://datatug.ai/skills/');
    for (const link of [terminal, agent]) {
      expect(link.target).toBe('_blank');
      expect(link.rel).toContain('noopener');
    }
  });

  it('keeps the data constant and the two rendered options in step', () => {
    expect(PLATFORM_PARTS.map((item) => item.id)).toEqual([
      'terminal',
      'agent',
    ]);
    expect(root.querySelectorAll('.part')).toHaveLength(PLATFORM_PARTS.length);
  });
});
