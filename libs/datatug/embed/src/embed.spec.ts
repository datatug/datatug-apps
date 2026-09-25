import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectFormat, tableFromCsv, tableFromJson } from './data';
import './index';

const tick = async () => { await new Promise((resolve) => setTimeout(resolve, 20)); };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('source parsing', () => {
  it('parses arrays and OVDB records', () => {
    expect(tableFromJson([{ A: 1 }]).columns).toEqual(['A']);
    expect(tableFromJson({ records: [{ key: 'Album/1', data: { AlbumId: 1 } }] }).keys).toEqual(['Album/1']);
    expect(() => tableFromJson({ records: ['bad'] })).toThrow('object');
  });
  it('parses quoted CSV and rejects malformed rows', () => {
    expect(tableFromCsv('Id,Title\r\n1,"A, ""song"""\r\n').rows).toEqual([{ Id: '1', Title: 'A, "song"' }]);
    expect(() => tableFromCsv('A,B\n1')).toThrow('different number');
  });
  it('detects content type before extension and uses explicit fallback', () => {
    expect(detectFormat('text/csv', new URL('https://example.test/a.json'), 'json')).toBe('csv');
    expect(detectFormat(null, new URL('https://example.test/a.json'))).toBe('json');
    expect(detectFormat(null, new URL('https://example.test/data'), 'csv')).toBe('csv');
  });
});

describe('plain HTML custom elements', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

  it('loads direct JSON, sorts, selects and updates data-url', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(json([{ AlbumId: 2, Title: 'B' }, { AlbumId: 1, Title: 'A' }]));
    const grid = document.createElement('datatug-grid');
    grid.setAttribute('data-url', 'https://example.test/albums.json');
    document.body.append(grid);
    await tick();
    expect(grid.shadowRoot?.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(grid.shadowRoot?.textContent).toContain('Title');
    expect(grid.shadowRoot?.querySelector('th button')).not.toBeNull();
    (grid.shadowRoot?.querySelector('th button') as HTMLButtonElement)?.click();
    expect(grid.shadowRoot?.querySelector('th button')?.textContent).toContain('↑');
    expect(grid.shadowRoot?.querySelector('tbody tr td')?.textContent).toBe('1');
    const selected = vi.fn(); grid.addEventListener('datatug-select', selected);
    const row = grid.shadowRoot?.querySelector('tbody tr') as HTMLTableRowElement;
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(selected.mock.calls[0][0].detail.row.AlbumId).toBe(1);
    expect(grid.shadowRoot?.activeElement).toBe(row);
    const search = grid.shadowRoot?.querySelector('input') as HTMLInputElement;
    search.focus(); search.value = 'AB'; search.setSelectionRange(1, 1);
    search.dispatchEvent(new InputEvent('input'));
    const replacement = grid.shadowRoot?.querySelector('input') as HTMLInputElement;
    expect(replacement.selectionStart).toBe(1);
    expect(grid.shadowRoot?.activeElement).toBe(replacement);
    fetcher.mockResolvedValueOnce(json([]));
    grid.setAttribute('data-url', 'https://example.test/empty.json');
    await tick();
    expect(grid.shadowRoot?.textContent).toContain('No rows found');
  });

  it('reports conflicting and missing source settings', async () => {
    const grid = document.createElement('datatug-grid');
    document.body.append(grid); await tick();
    expect(grid.shadowRoot?.querySelector('[role=alert]')?.textContent).toContain('exactly one');
    grid.setAttribute('connection', 'https://example.test/ovdb/dbs/a');
    grid.setAttribute('data-url', 'https://example.test/data.json');
    await tick();
    expect(grid.shadowRoot?.querySelector('[role=alert]')?.textContent).toContain('exactly one');
  });

  it('discovers the API and sends arbitrarily named parameters as data', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openvaultdb')) return json({ databases: [{ id: 'chinook', url: 'https://example.test/ovdb/dbs/chinook', apiUrl: '/ovdb/v1/databases/chinook' }] });
      if (url.endsWith('/ovdb/v1/databases/chinook')) return json({ capabilities: { dtql: true }, endpoints: { dtql: '/ovdb/v1/databases/chinook/dtql' }, queryFormat: 'dtql-yaml+json' });
      if (url.endsWith('/ovdb/v1/databases/chinook/dtql')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ query: 'from: {name: Album}\nwhere: {op: "==", left: {field: ArtistId}, right: {param: ArtistID}}\nlimit: 10', parameters: { ArtistID: 456, 'user.choice': 'a' } });
        return json({ records: [{ key: 'Album/1', data: { AlbumId: 1, Title: '<script>alert(1)</script>' } }] });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const grid = document.createElement('datatug-grid');
    grid.setAttribute('connection', 'https://example.test/ovdb/dbs/chinook');
    grid.innerHTML = '<dtql-query>from: {name: Album}\nwhere: {op: "==", left: {field: ArtistId}, right: {param: ArtistID}}\nlimit: 10</dtql-query><dtql-param name="ArtistID" value="123" type="number"></dtql-param><dtql-param name="user.choice" value="a"></dtql-param>';
    document.body.append(grid);
    (grid.querySelector('dtql-param') as HTMLElement & { value: unknown }).value = 456;
    await tick();
    expect(grid.shadowRoot?.textContent).toContain('<script>alert(1)</script>');
    expect(grid.shadowRoot?.querySelector('script')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('renders chart from the same direct source and handles errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([{ Name: 'A', Total: 4 }]));
    const chart = document.createElement('datatug-chart'); chart.setAttribute('data-url', 'https://example.test/chart.json'); document.body.append(chart);
    await tick(); expect(chart.shadowRoot?.querySelector('.fill')).not.toBeNull();
    const loaded = vi.fn(), failed = vi.fn();
    chart.addEventListener('datatug-data-loaded', loaded);
    chart.addEventListener('datatug-error', failed);
    chart.setAttribute('type', 'pie');
    vi.mocked(fetch).mockResolvedValueOnce(json([{ Name: 'A', Total: 4 }]));
    await tick(); expect(chart.shadowRoot?.textContent).toContain('Unsupported chart type');
    expect(failed).toHaveBeenCalledOnce();
    expect(loaded).not.toHaveBeenCalled();
  });

  it('renders CSV and pages a larger result without mounting every row', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Id,Name\n' + Array.from({ length: 120 }, (_, i) => `${i},Row ${i}`).join('\n'), { headers: { 'Content-Type': 'text/csv' } }));
    const grid = document.createElement('datatug-grid'); grid.setAttribute('data-url', 'https://example.test/rows');
    document.body.append(grid); await tick();
    expect(grid.shadowRoot?.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(grid.shadowRoot?.textContent).toContain('120 of 120 rows');
    (grid.shadowRoot?.querySelector('.pager button:last-child') as HTMLButtonElement).click();
    expect(grid.shadowRoot?.querySelector('tbody tr td')?.textContent).toBe('50');
  });

  it('refreshes on parameter attribute and query text changes and rejects unsupported binding', async () => {
    const fetcher = vi.mocked(fetch);
    const calls: string[] = [];
    fetcher.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openvaultdb')) return json({ databases: [{ url: 'https://example.test/ovdb/dbs/a', apiUrl: '/api/a' }] });
      if (url.endsWith('/api/a')) return json({ capabilities: { dtql: true }, endpoints: { dtql: '/api/a/dtql' }, queryFormat: 'dtql-yaml+json' });
      calls.push(String(init?.body)); return json({ records: [] });
    });
    const grid = document.createElement('datatug-grid'); grid.setAttribute('connection', 'https://example.test/ovdb/dbs/a');
    grid.innerHTML = '<dtql-query>from: {name: Album}</dtql-query><dtql-param name="x" value="1" type="number"></dtql-param>';
    document.body.append(grid); await tick();
    expect(JSON.parse(calls.at(-1) ?? '{}').parameters.x).toBe(1);
    grid.querySelector('dtql-param')?.setAttribute('value', '2'); await tick();
    expect(JSON.parse(calls.at(-1) ?? '{}').parameters.x).toBe(2);
    const query = grid.querySelector('dtql-query');
    if (query) query.textContent = 'from: {name: Artist}';
    await tick();
    expect(JSON.parse(calls.at(-1) ?? '{}').query).toBe('from: {name: Artist}');
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('passes a parameter literally named __proto__', async () => {
    const fetcher = vi.mocked(fetch);
    let body = '';
    fetcher.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openvaultdb')) return json({ databases: [{ url: 'https://example.test/ovdb/dbs/a', apiUrl: '/api/a' }] });
      if (url.endsWith('/api/a')) return json({ capabilities: { dtql: true }, endpoints: { dtql: '/api/a/dtql' }, queryFormat: 'dtql-yaml+json' });
      body = String(init?.body); return json({ records: [] });
    });
    const grid = document.createElement('datatug-grid'); grid.setAttribute('connection', 'https://example.test/ovdb/dbs/a');
    grid.innerHTML = '<dtql-query>from: {name: Album}</dtql-query><dtql-param name="__proto__" value="safe"></dtql-param>';
    document.body.append(grid); await tick();
    expect(body).toContain('"__proto__":"safe"');
  });

  it('shows discovery, capability and HTTP failures without stale rows', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(json({ databases: [] }));
    const grid = document.createElement('datatug-grid'); grid.setAttribute('connection', 'https://example.test/ovdb/dbs/missing');
    grid.innerHTML = '<dtql-query>from: {name: Album}</dtql-query>';
    document.body.append(grid); await tick();
    expect(grid.shadowRoot?.querySelector('[role=alert]')?.textContent).toContain('does not list');
    fetcher.mockResolvedValueOnce(json({ databases: [{ url: 'https://example.test/ovdb/dbs/missing', apiUrl: '/api/db' }] }));
    fetcher.mockResolvedValueOnce(json({ capabilities: { read: true } }));
    await (grid as HTMLElement & { refresh(): Promise<void> }).refresh();
    expect(grid.shadowRoot?.querySelector('[role=alert]')?.textContent).toContain('does not advertise DTQL');
    fetcher.mockResolvedValueOnce(json({ error: { code: 'denied', message: 'Denied' } }, 403));
    await (grid as HTMLElement & { refresh(): Promise<void> }).refresh();
    expect(grid.shadowRoot?.querySelector('[role=alert]')?.textContent).toContain('403): Denied');
  });
});
