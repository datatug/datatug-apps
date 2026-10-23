import { lexer, type Token, type Tokens } from 'marked';

/** Matches `{{parameterId}}` and `{{parameterId.column}}`. */
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_-]+)(?:\.([^{}]+?))?\s*\}\}/g;
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const MAX_TOKENS = 5000;
const MAX_DEPTH = 24;

/** Parameter values a `text` widget can substitute. */
export type TextParameterValues = Readonly<Record<string, unknown>>;

/** The target of a markdown link when it is safe to render as a link, else undefined. */
export function safeLinkTarget(href: string | undefined): string | undefined {
  const target = (href ?? '').trim();
  if (!target) return undefined;
  // Reject relative, protocol-relative and scheme-less targets outright.
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return undefined;
  try {
    const url = new URL(target);
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function stringify(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function lookup(
  values: TextParameterValues,
  id: string,
  column: string | undefined,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(values, id)) return undefined;
  let value = values[id];
  if (column !== undefined) {
    const row = Array.isArray(value) ? value[0] : value;
    if (!row || typeof row !== 'object') return undefined;
    const name = column.trim();
    if (!Object.prototype.hasOwnProperty.call(row, name)) return undefined;
    value = (row as Record<string, unknown>)[name];
  }
  return stringify(value);
}

/** Substitutes placeholders in a plain string; the result is only ever used as a text node. */
export function substitutePlaceholders(
  text: string,
  values: TextParameterValues,
): string {
  return text.replace(PLACEHOLDER, (whole, id: string, column?: string) => {
    return lookup(values, id, column) ?? whole;
  });
}

class Renderer {
  private tokens = 0;
  constructor(
    private readonly doc: Document,
    private readonly values: TextParameterValues,
  ) {}

  private text(parent: Node, text: string): void {
    parent.appendChild(
      this.doc.createTextNode(substitutePlaceholders(text, this.values)),
    );
  }

  private el<K extends keyof HTMLElementTagNameMap>(
    parent: Node,
    tag: K,
  ): HTMLElementTagNameMap[K] {
    const node = this.doc.createElement(tag);
    parent.appendChild(node);
    return node;
  }

  render(parent: Node, tokens: readonly Token[] | undefined, depth = 0): void {
    if (!tokens || depth > MAX_DEPTH) return;
    for (const token of tokens) {
      if (++this.tokens > MAX_TOKENS) return;
      this.token(parent, token, depth);
    }
  }

  private token(parent: Node, token: Token, depth: number): void {
    const t = token as Tokens.Generic;
    switch (token.type) {
      case 'space':
        return;
      case 'heading': {
        const level = Math.min(6, Math.max(1, (t['depth'] as number) || 1));
        const node = this.el(
          parent,
          `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
        );
        return this.render(node, t.tokens, depth + 1);
      }
      case 'paragraph':
        return this.render(this.el(parent, 'p'), t.tokens, depth + 1);
      case 'text':
      case 'escape':
        if (t.tokens?.length) return this.render(parent, t.tokens, depth + 1);
        return this.text(parent, String(t['text'] ?? ''));
      case 'html':
        // Raw HTML is disabled: it is shown as literal text, never parsed.
        return this.text(parent, String(t['text'] ?? t.raw ?? ''));
      case 'strong':
        return this.render(this.el(parent, 'strong'), t.tokens, depth + 1);
      case 'em':
        return this.render(this.el(parent, 'em'), t.tokens, depth + 1);
      case 'del':
        return this.render(this.el(parent, 'del'), t.tokens, depth + 1);
      case 'codespan':
        return this.text(this.el(parent, 'code'), String(t['text'] ?? ''));
      case 'code': {
        const pre = this.el(parent, 'pre');
        return this.text(this.el(pre, 'code'), String(t['text'] ?? ''));
      }
      case 'br':
        return void this.el(parent, 'br');
      case 'hr':
        return void this.el(parent, 'hr');
      case 'blockquote':
        return this.render(this.el(parent, 'blockquote'), t.tokens, depth + 1);
      case 'list': {
        const list = this.el(parent, t['ordered'] ? 'ol' : 'ul');
        const start = t['start'];
        if (t['ordered'] && typeof start === 'number' && start !== 1)
          list.setAttribute('start', String(Math.trunc(start)));
        for (const item of (t['items'] as Token[]) ?? [])
          this.token(list, item, depth + 1);
        return;
      }
      case 'list_item': {
        const li = this.el(parent, 'li');
        return this.render(li, t.tokens, depth + 1);
      }
      case 'table': {
        const table = this.el(parent, 'table');
        const head = this.el(this.el(table, 'thead'), 'tr');
        for (const cell of (t['header'] as Tokens.TableCell[]) ?? [])
          this.render(this.el(head, 'th'), cell.tokens, depth + 1);
        const body = this.el(table, 'tbody');
        for (const row of (t['rows'] as Tokens.TableCell[][]) ?? []) {
          const tr = this.el(body, 'tr');
          for (const cell of row)
            this.render(this.el(tr, 'td'), cell.tokens, depth + 1);
        }
        return;
      }
      case 'link': {
        const href = safeLinkTarget(t['href'] as string | undefined);
        if (!href) return this.render(parent, t.tokens, depth + 1);
        const a = this.el(parent, 'a');
        a.setAttribute('href', href);
        a.setAttribute('rel', 'noopener noreferrer nofollow');
        a.setAttribute('target', '_blank');
        return this.render(a, t.tokens, depth + 1);
      }
      case 'image':
        // Images never render; the alt text stays as plain text.
        return this.text(parent, String(t['text'] ?? ''));
      default:
        if (t.tokens?.length) return this.render(parent, t.tokens, depth + 1);
        if (typeof t['text'] === 'string') this.text(parent, t['text']);
    }
  }
}

/**
 * Renders markdown to DOM nodes with raw HTML disabled. The tree is built
 * from parsed tokens with `createElement`/`createTextNode` only, and
 * `{{parameterId}}` / `{{parameterId.column}}` placeholders are substituted
 * into text nodes after parsing, so a parameter value can never become
 * markup, a link or an image.
 */
export function renderSafeMarkdown(
  markdown: string,
  values: TextParameterValues,
  doc: Document,
): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  new Renderer(doc, values).render(
    fragment,
    lexer(markdown.slice(0, 100_000), { gfm: true, breaks: false }),
  );
  return fragment;
}
