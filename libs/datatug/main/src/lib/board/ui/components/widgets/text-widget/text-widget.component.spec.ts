import { TestBed } from '@angular/core/testing';
import { TextWidgetComponent } from './text-widget.component';
import {
  renderSafeMarkdown,
  safeLinkTarget,
  substitutePlaceholders,
} from './safe-markdown';

const html = (md: string, values: Record<string, unknown> = {}): HTMLElement => {
  const div = document.createElement('div');
  div.appendChild(renderSafeMarkdown(md, values, document));
  return div;
};

describe('safe markdown', () => {
  it('renders common markdown', () => {
    const el = html('# Title\n\nHello **bold** and _em_ `code`\n\n- a\n- b\n\n1. x');
    expect(el.querySelector('h1')?.textContent).toBe('Title');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(el.querySelector('em')?.textContent).toBe('em');
    expect(el.querySelector('code')?.textContent).toBe('code');
    expect(el.querySelectorAll('ul li')).toHaveLength(2);
    expect(el.querySelectorAll('ol li')).toHaveLength(1);
  });

  it('shows raw HTML as literal text', () => {
    const el = html('<img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('substitutes values as text after parsing: a value cannot become a link', () => {
    const el = html('Hello [{{name}}](https://example.com) and {{name}}', {
      name: '](javascript:alert(1))',
    });
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.com/');
    expect(links[0].textContent).toBe('](javascript:alert(1))');
    expect(el.textContent).toContain('and ](javascript:alert(1))');
    expect(el.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('a value with markup, images or html stays literal', () => {
    const el = html('{{v}}', {
      v: '<img src=x onerror=alert(1)> ![x](http://e/x.png) **b**',
    });
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('strong')).toBeNull();
    expect(el.textContent).toBe(
      '<img src=x onerror=alert(1)> ![x](http://e/x.png) **b**',
    );
  });

  it('substitutes {{param.column}} from a record, and leaves unset placeholders', () => {
    const el = html('{{row.Name}} / {{row.Missing}} / {{gone}} / {{n}}', {
      row: { Name: 'Ann' },
      n: null,
    });
    expect(el.textContent).toBe('Ann / {{row.Missing}} / {{gone}} / ');
  });

  it('links only http, https and mailto; images do not render', () => {
    const el = html(
      '[a](javascript:alert(1)) [b](data:text/html,x) [c](/rel) [d](mailto:a@b.co) [e](http://x.io) ![alt](https://x.io/i.png)',
    );
    const hrefs = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['mailto:a@b.co', 'http://x.io/']);
    expect(el.querySelector('img')).toBeNull();
    expect(safeLinkTarget('JaVaScRiPt:alert(1)')).toBeUndefined();
    expect(safeLinkTarget(' https://ok.dev ')).toBe('https://ok.dev/');
    expect(safeLinkTarget(undefined)).toBeUndefined();
  });

  it('renders tables and blockquotes', () => {
    const el = html('> q\n\n| a | b |\n|---|---|\n| 1 | {{x}} |', { x: 'Z' });
    expect(el.querySelector('blockquote')?.textContent).toContain('q');
    expect(el.querySelectorAll('td')[1].textContent).toBe('Z');
  });

  it('substitutePlaceholders handles records and recordsets', () => {
    expect(substitutePlaceholders('{{r.a}}', { r: [{ a: 5 }] })).toBe('5');
    expect(substitutePlaceholders('{{o}}', { o: { k: 1 } })).toBe('{"k":1}');
  });
});

describe('TextWidgetComponent', () => {
  it('renders title and markdown with substituted text', async () => {
    const fixture = TestBed.createComponent(TextWidgetComponent);
    fixture.componentRef.setInput('def', { title: 'Hi', markdown: 'Hello {{who}}' });
    fixture.componentRef.setInput('values', { who: '](javascript:alert(1))' });
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.widget-title')?.textContent).toBe('Hi');
    expect(el.textContent).toContain('Hello ](javascript:alert(1))');
    expect(el.querySelector('a')).toBeNull();
    fixture.componentRef.setInput('values', { who: 'Bob' });
    await fixture.whenStable();
    expect(el.textContent).toContain('Hello Bob');
  });
});
