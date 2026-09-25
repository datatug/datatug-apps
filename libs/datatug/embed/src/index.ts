import { loadConnection, loadDirect, type Row, type TableData } from './data';

type State = 'loading' | 'ready' | 'empty' | 'error';
const styles = `
:host{display:block;box-sizing:border-box;color:var(--datatug-fg,#18304a);font:var(--datatug-font,14px/1.45 system-ui,sans-serif);background:var(--datatug-bg,#fff);border:1px solid var(--datatug-border,#dce5ee);border-radius:var(--datatug-radius,10px);overflow:hidden;min-width:0}
*{box-sizing:border-box}button,input,select{font:inherit;color:inherit}button{cursor:pointer;background:var(--datatug-button-bg,#f5f8fb);border:1px solid var(--datatug-border,#dce5ee);border-radius:5px;padding:.25rem .55rem}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,th button:focus-visible{outline:2px solid var(--datatug-accent,#2879b9);outline-offset:2px}
.toolbar{display:flex;align-items:center;justify-content:space-between;gap:.65rem;padding:.7rem .85rem;border-bottom:1px solid var(--datatug-border,#dce5ee);flex-wrap:wrap}.brand{font-weight:700;letter-spacing:.01em}.tools{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap}.tools input{max-width:13rem;min-width:7rem;border:1px solid var(--datatug-border,#dce5ee);border-radius:5px;padding:.26rem .45rem}.status{padding:.8rem;color:var(--datatug-muted,#587087)}.error{color:var(--datatug-error,#ab2e39)}.scroller{overflow:auto;max-height:var(--datatug-max-height,32rem)}table{border-collapse:collapse;min-width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:.46rem .7rem;border-bottom:1px solid var(--datatug-border,#dce5ee);vertical-align:top;white-space:nowrap;max-width:32rem;overflow:hidden;text-overflow:ellipsis}th{position:sticky;top:0;background:var(--datatug-header-bg,#f4f8fb);color:var(--datatug-muted,#587087);font-size:.84em;font-weight:650}th button{border:0;background:none;padding:0;font-weight:inherit;color:inherit}tbody tr:hover{background:var(--datatug-hover,#f5f9fc)}tbody tr[aria-selected=true]{background:var(--datatug-selected,#e7f3fc)}.footer{display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.55rem .85rem;color:var(--datatug-muted,#587087);font-size:.85em}.pager{display:flex;gap:.35rem;align-items:center}.chart{padding:.8rem}.bar{display:grid;grid-template-columns:minmax(5rem, 30%) 1fr auto;gap:.6rem;align-items:center;margin:.38rem 0}.track{height:.8rem;border-radius:3px;background:var(--datatug-header-bg,#f4f8fb);overflow:hidden}.fill{height:100%;background:var(--datatug-accent,#2879b9)}.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function typedValue(raw: string, type: string | null): unknown {
  if (type === 'string' || !type) return raw;
  if (type === 'number') {
    if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error('Invalid number parameter.');
    return Number(raw);
  }
  if (type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') throw new Error('Boolean parameter must be true or false.');
    return raw === 'true';
  }
  if (type === 'null') return null;
  throw new Error(`Unsupported DTQL parameter type: ${type}.`);
}

export class DtqlQuery extends HTMLElement {
  private observer?: MutationObserver;
  connectedCallback(): void {
    this.style.display = 'none';
    this.observer = new MutationObserver(() => this.notify());
    this.observer.observe(this, { childList: true, characterData: true, subtree: true });
  }
  disconnectedCallback(): void { this.observer?.disconnect(); }
  private notify(): void { this.dispatchEvent(new Event('dtql-change', { bubbles: true })); }
}

export class DtqlParam extends HTMLElement {
  static get observedAttributes(): string[] { return ['name', 'value', 'type']; }
  private propertyValue: unknown;
  private propertySet = false;
  get value(): unknown { return this.propertySet ? this.propertyValue : typedValue(this.getAttribute('value') ?? '', this.getAttribute('type')); }
  set value(value: unknown) {
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new TypeError('DTQL parameter value must be a JSON scalar.');
    this.propertySet = true;
    this.propertyValue = value;
    this.notify();
  }
  attributeChangedCallback(name: string): void {
    if (name === 'value' || name === 'type') this.propertySet = false;
    this.notify();
  }
  connectedCallback(): void { this.style.display = 'none'; this.notify(); }
  private notify(): void { this.dispatchEvent(new Event('dtql-change', { bubbles: true })); }
}

abstract class DataTugView extends HTMLElement {
  static get observedAttributes(): string[] { return ['connection', 'data-url', 'format', 'type', 'page-size']; }
  protected readonly root = this.attachShadow({ mode: 'open' });
  protected data?: TableData;
  protected state: State = 'loading';
  protected message = '';
  private controller?: AbortController;
  private observer?: MutationObserver;
  private scheduled = false;
  private revision = 0;

  constructor() { super(); this.root.append(element('style', styles)); }
  connectedCallback(): void {
    this.addEventListener('dtql-change', this.onChildChange);
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(this, { childList: true, subtree: false });
    this.schedule();
  }
  disconnectedCallback(): void {
    this.removeEventListener('dtql-change', this.onChildChange);
    this.observer?.disconnect();
    this.controller?.abort();
    this.revision++;
  }
  attributeChangedCallback(): void { this.schedule(); }
  private readonly onChildChange = (): void => this.schedule();
  private schedule(): void {
    if (!this.isConnected || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; if (this.isConnected) void this.refresh(); });
  }
  async refresh(): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const revision = ++this.revision;
    this.state = 'loading'; this.message = 'Loading data…'; this.render();
    try {
      const connection = this.getAttribute('connection');
      const dataUrl = this.getAttribute('data-url');
      const queries = [...this.children].filter((child) => child.localName === 'dtql-query');
      const queryNode = queries[0];
      const params = [...this.children].filter((child) => child.localName === 'dtql-param') as DtqlParam[];
      if (Boolean(connection) === Boolean(dataUrl)) throw new Error('Set exactly one of connection or data-url.');
      if (dataUrl && (queries.length || params.length)) throw new Error('data-url cannot be combined with DTQL query or parameters.');
      if (connection && (queries.length !== 1 || !queryNode?.textContent?.trim())) throw new Error('A connection requires one nonempty <dtql-query>.');
      const parameters: Row = Object.create(null) as Row;
      for (const param of params) {
        const name = param.getAttribute('name');
        if (!name || Object.hasOwn(parameters, name)) throw new Error('Every <dtql-param> needs a unique nonempty name.');
        parameters[name] = param.value;
      }
      if (!dataUrl && (!connection || !queryNode?.textContent)) throw new Error('A connection requires one nonempty <dtql-query>.');
      const data = dataUrl
        ? await loadDirect(dataUrl, this.getAttribute('format'), controller.signal)
        : await loadConnection(connection as string, queryNode?.textContent?.trim() ?? '', parameters, controller.signal);
      if (controller.signal.aborted || revision !== this.revision) return;
      this.validateData(data);
      this.data = data;
      this.state = data.rows.length ? 'ready' : 'empty';
      this.message = data.rows.length ? '' : 'No rows found.';
      this.render();
      this.dispatchEvent(new CustomEvent('datatug-data-loaded', { detail: { rows: data.rows.length, columns: data.columns, metadata: data.metadata }, bubbles: true }));
    } catch (error) {
      if (controller.signal.aborted || revision !== this.revision) return;
      this.data = undefined; this.state = 'error';
      this.message = error instanceof Error ? error.message : 'Could not load data.';
      this.render();
      this.dispatchEvent(new CustomEvent('datatug-error', { detail: { message: this.message }, bubbles: true }));
    }
  }
  reload(): Promise<void> { return this.refresh(); }
  protected validateData(data: TableData): void {
    if (!Array.isArray(data.rows)) throw new Error('The source did not return rows.');
  }
  protected shell(title: string): HTMLElement {
    [...this.root.children].filter((child) => child.localName !== 'style').forEach((child) => child.remove());
    const container = element('div');
    const toolbar = element('div'); toolbar.className = 'toolbar';
    const brand = element('span', title); brand.className = 'brand';
    toolbar.append(brand);
    container.append(toolbar);
    this.root.append(container);
    return container;
  }
  protected statusNode(container: HTMLElement): boolean {
    if (this.state === 'ready') return false;
    const status = element('div', this.message); status.className = `status ${this.state === 'error' ? 'error' : ''}`;
    status.setAttribute('role', this.state === 'error' ? 'alert' : 'status');
    container.append(status);
    return true;
  }
  protected abstract render(): void;
}

export class DataTugGrid extends DataTugView {
  private search = '';
  private sortColumn?: string;
  private sortDesc = false;
  private page = 0;
  private selected?: number;
  protected render(): void {
    const container = this.shell('DataTug');
    const toolbar = container.firstElementChild as HTMLElement;
    const tools = element('div'); tools.className = 'tools';
    const search = element('input'); search.type = 'search'; search.placeholder = 'Search rows'; search.setAttribute('aria-label', 'Search rows'); search.value = this.search;
    const updateSearch = () => {
      const start = search.selectionStart, end = search.selectionEnd;
      this.search = search.value; this.page = 0; this.render();
      const replacement = this.root.querySelector('input');
      replacement?.focus();
      if (start !== null && end !== null) replacement?.setSelectionRange(start, end);
    };
    search.addEventListener('input', (event) => { if (!(event as InputEvent).isComposing) updateSearch(); });
    search.addEventListener('compositionend', updateSearch);
    const reload = element('button', 'Refresh'); reload.type = 'button'; reload.addEventListener('click', () => void this.refresh());
    tools.append(search, reload); toolbar.append(tools);
    if (this.statusNode(container)) return;
    const data = this.data;
    if (!data) return;
    const searchText = this.search.toLocaleLowerCase();
    const indexed = data.rows.map((row, index) => ({ row, index })).filter(({ row }) => !searchText || data.columns.some((column) => display(row[column]).toLocaleLowerCase().includes(searchText)));
    if (this.sortColumn) {
      const column = this.sortColumn;
      indexed.sort((a, b) => {
        const left = a.row[column], right = b.row[column];
        const comparison = typeof left === 'number' && typeof right === 'number' ? left - right : display(left).localeCompare(display(right), undefined, { numeric: true });
        return (this.sortDesc ? -comparison : comparison) || a.index - b.index;
      });
    }
    const requested = Number(this.getAttribute('page-size'));
    const pageSize = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 500) : 50;
    const pageCount = Math.max(1, Math.ceil(indexed.length / pageSize));
    this.page = Math.min(this.page, pageCount - 1);
    const visible = indexed.slice(this.page * pageSize, (this.page + 1) * pageSize);
    const scroller = element('div'); scroller.className = 'scroller';
    const table = element('table');
    const header = element('thead'), headerRow = element('tr');
    for (const column of data.columns) {
      const th = element('th'); th.scope = 'col';
      const button = element('button', `${column}${this.sortColumn === column ? this.sortDesc ? ' ↓' : ' ↑' : ''}`);
      button.type = 'button'; button.addEventListener('click', () => { this.sortDesc = this.sortColumn === column && !this.sortDesc; this.sortColumn = column; this.page = 0; this.render(); });
      th.append(button); headerRow.append(th);
    }
    header.append(headerRow); table.append(header);
    const body = element('tbody');
    for (const { row, index } of visible) {
      const tr = element('tr'); tr.tabIndex = 0; tr.setAttribute('aria-selected', String(this.selected === index));
      const select = () => {
        this.selected = index;
        body.querySelectorAll('tr').forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === tr)));
        this.dispatchEvent(new CustomEvent('datatug-select', { detail: { row, index, key: data.keys?.[index] }, bubbles: true }));
      };
      tr.addEventListener('click', select);
      tr.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
      for (const column of data.columns) tr.append(element('td', display(row[column])));
      body.append(tr);
    }
    table.append(body); scroller.append(table); container.append(scroller);
    const footer = element('div'); footer.className = 'footer';
    footer.append(element('span', `${indexed.length} of ${data.rows.length} rows`));
    const pager = element('div'); pager.className = 'pager';
    const previous = element('button', 'Previous'); previous.disabled = this.page === 0; previous.addEventListener('click', () => { this.page--; this.render(); });
    const next = element('button', 'Next'); next.disabled = this.page >= pageCount - 1; next.addEventListener('click', () => { this.page++; this.render(); });
    pager.append(previous, element('span', `${this.page + 1} / ${pageCount}`), next); footer.append(pager); container.append(footer);
  }
}

export class DataTugChart extends DataTugView {
  protected override validateData(data: TableData): void {
    const kind = this.getAttribute('type') ?? 'auto';
    if (kind !== 'auto' && kind !== 'bar') throw new Error(`Unsupported chart type: ${kind}.`);
    if (!data.rows.length) return;
    const numeric = data.columns.find((column) => data.rows.some((row) => typeof row[column] === 'number'));
    const label = data.columns.find((column) => column !== numeric);
    if (!numeric || !label) throw new Error('Chart needs one numeric and one label column.');
  }
  protected render(): void {
    const container = this.shell('DataTug chart');
    if (this.statusNode(container)) return;
    const data = this.data;
    if (!data) return;
    const numeric = data.columns.find((column) => data.rows.some((row) => typeof row[column] === 'number'));
    const label = data.columns.find((column) => column !== numeric);
    if (!numeric || !label) return;
    const shown = data.rows.slice(0, 20);
    const maximum = Math.max(0, ...shown.map((row) => Number(row[numeric]) || 0));
    const chart = element('div'); chart.className = 'chart'; chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', `Bar chart of ${numeric} by ${label}`);
    for (const row of shown) {
      const value = Number(row[numeric]) || 0;
      const bar = element('div'); bar.className = 'bar';
      const name = element('span', display(row[label])); name.className = 'label';
      const track = element('div'); track.className = 'track';
      const fill = element('div'); fill.className = 'fill'; fill.style.width = `${Math.max(0, maximum ? value / maximum * 100 : 0)}%`;
      track.append(fill); bar.append(name, track, element('span', display(value))); chart.append(bar);
    }
    container.append(chart);
  }
}

if (!customElements.get('dtql-query')) customElements.define('dtql-query', DtqlQuery);
if (!customElements.get('dtql-param')) customElements.define('dtql-param', DtqlParam);
if (!customElements.get('datatug-grid')) customElements.define('datatug-grid', DataTugGrid);
if (!customElements.get('datatug-chart')) customElements.define('datatug-chart', DataTugChart);
