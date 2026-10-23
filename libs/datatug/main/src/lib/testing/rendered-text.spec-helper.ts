/**
 * The visible text of a rendered element, with whitespace collapsed.
 *
 * Ionic's scoped-slot patch overrides `textContent` and `childNodes` on its
 * host elements so that light-DOM text is hidden in the test DOM. This walks
 * the tree through the unpatched `Node.prototype` accessor instead, and
 * collects text nodes only: comments and attributes are skipped by node type
 * and entities are already decoded, so nothing is pattern-matched out of HTML.
 */
const nativeChildNodes = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes')?.get;

export function renderedText(el: Element): string {
  const parts: string[] = [];
  const collect = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? '');
      return;
    }
    const children = (nativeChildNodes?.call(node) ?? node.childNodes) as NodeListOf<ChildNode>;
    children.forEach(collect);
  };
  collect(el);
  return ` ${parts.join(' ')} `.replace(/\s+/g, ' ');
}
