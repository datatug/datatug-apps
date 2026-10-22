import { Component, input, output } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter, type Params } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OvdbRow } from '../../ovdb/ovdb-records';
import { DemoLogsPageComponent } from './demo-logs-page.component';
import { LogSourceCatalogService } from './log-source-catalog.service';
import type { LogSource } from './log-source-declarations';
import { declaredShippingLogs } from './log-source-declarations.spec-helper';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- models AG Grid inputs and row activation
  selector: 'ag-grid-angular',
  template: `@for (row of rowData(); track $index) { <button class="grid-entry" (click)="selectionChanged.emit({ api: { getSelectedRows: selectedRows(row) } })">{{ row.message }}</button> }`,
})
class GridStubComponent {
  readonly rowData = input<Array<Record<string, unknown>>>([]);
  readonly columnDefs = input<unknown>();
  readonly defaultColDef = input<unknown>();
  readonly rowSelection = input<unknown>();
  selectedRows(row: Record<string, unknown>) { return () => [row]; }
  readonly selectionChanged = output<unknown>();
  readonly gridReady = output<unknown>();
  readonly cellKeyDown = output<unknown>();
}

const shippingDescriptor = { id: 'shipping-logs', collections: ['baseline', 'recovery11045example'], capabilities: { query: true, write: false, read: true } };
const shippingRow: OvdbRow = {
  key: 'baseline/attempt-11045-1-e4',
  data: { attempt_id: 'attempt-11045-1', event_id: 'attempt-11045-1-e4', kind: 'routing-blocked', occurred_at: '2018-05-20T09:00:03Z', order_id: 11045, sequence: 4, synthetic: true },
};
const northwindDescriptor = { id: 'northwind_evidence', collections: ['fulfillment_events'], capabilities: { query: true, write: false, read: false } };
const northwindRow: OvdbRow = {
  key: 'fulfillment_events/entry-1',
  data: {
    timestamp: '2018-04-21T09:13:05Z', severity: 'ERROR', service: 'carrier-gateway',
    message: 'Carrier returned HTTP 503', order_id: '11039',
    correlation_id: 'nw-11039-f1', source_ref: 'file:abc:10:200',
    raw: '2018-04-21T09:13:05Z ERROR carrier-gateway Carrier returned HTTP 503\n  at CarrierClient.createLabel',
    parse_status: 'parsed',
  },
};
const malformedRow: OvdbRow = {
  key: 'fulfillment_events/malformed-entry',
  data: { severity: 'WARN', service: 'carrier-gateway', message: 'Malformed line without structured identifiers', source_ref: 'file:abc:11:201', raw: 'unparsed carrier warning', parse_status: 'malformed' },
};

type Request = { url: string; method: string; body?: string; authorization?: string };

async function setup(params: Params, options: { rows?: readonly OvdbRow[]; sources?: readonly LogSource[] | Error; expectRows?: number } = {}) {
  const requests: Request[] = [];
  const paramMap = new BehaviorSubject(convertToParamMap(params));
  const route = { snapshot: { queryParamMap: paramMap.value }, queryParamMap: paramMap.asObservable() };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? 'GET', body: init?.body?.toString(), authorization: new Headers(init?.headers).get('Authorization') ?? undefined });
    if (url === 'https://ovdb.demodb.dev/v1/databases/shipping-logs') return new Response(JSON.stringify(shippingDescriptor), { status: 200 });
    if (url === 'http://127.0.0.1:6832/v1/databases/northwind_evidence') return new Response(JSON.stringify(northwindDescriptor), { status: 200 });
    if (url.endsWith('/query')) return new Response(JSON.stringify({ records: options.rows ?? [] }), { status: 200 });
    return new Response('missing', { status: 404 });
  }));
  const sources = options.sources ?? declaredShippingLogs;
  TestBed.overrideComponent(DemoLogsPageComponent, { remove: { imports: [AgGridAngular] }, add: { imports: [GridStubComponent] } });
  await TestBed.configureTestingModule({
    imports: [DemoLogsPageComponent],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: route },
      { provide: LogSourceCatalogService, useValue: { sources: () => sources instanceof Error ? Promise.reject(sources) : Promise.resolve(sources) } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(DemoLogsPageComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  await vi.waitFor(async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    expect(['ready', 'error']).toContain(fixture.componentInstance.state());
    if (options.expectRows !== undefined) expect(el.querySelectorAll('.grid-entry').length).toBe(options.expectRows);
  });
  return { fixture, requests, el, paramMap, route, component: fixture.componentInstance };
}
const where = (request?: Request) => (JSON.parse(request?.body ?? '{}') as { where?: unknown[] }).where ?? [];

describe('DemoLogsPageComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens the first declared source on a hosted visit and reads the public provider in place (Act 5)', async () => {
    const { requests, el, fixture } = await setup({ order: '11045' }, { rows: [shippingRow], expectRows: 1 });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET https://ovdb.demodb.dev/v1/databases/shipping-logs',
      'POST https://ovdb.demodb.dev/v1/databases/shipping-logs/query',
    ]);
    expect(requests.some((r) => r.url.includes('127.0.0.1'))).toBe(false);
    expect(where(requests[1])).toEqual(expect.arrayContaining([
      { field: 'occurred_at', op: '>=', value: '2018-04-01T00:00:00Z' },
      { field: 'occurred_at', op: '<=', value: '2018-05-21T00:00:00Z' },
      { field: 'order_id', op: '==', value: 11045 },
    ]));
    expect(el.querySelector('.eyebrow')?.textContent).toContain('Shipping logs · synthetic log evidence');
    expect(el.querySelector('h1')?.textContent).toBe('Shipping events · Order ID 11045');
    expect(el.textContent).toContain('These entries are synthetic');
    expect(el.textContent).not.toContain('Severity');
    expect(el.textContent).not.toContain('Correlation ID');
    expect(el.textContent).not.toContain('Include untimed');
    (el.querySelector('.grid-entry') as HTMLButtonElement).click();
    fixture.detectChanges();
    const details = el.querySelector('.entry-details')?.textContent ?? '';
    expect(details).toContain('baseline/attempt-11045-1-e4');
    expect(details).toContain('Stored record (the source keeps no original log line)');
    expect(details).toContain('"kind": "routing-blocked"');
    // Logs → record: the Northwind order has an app page; the Shipping request has none yet.
    const link = el.querySelector('.entry-details a') as HTMLAnchorElement;
    expect(link.textContent).toBe('Open Orders record 11045');
    expect(link.getAttribute('href')).toBe('/demo/sqlite/northwind/table/Orders?record=11045');
  });

  it('filters by attempt and orders by the declared sequence after the timestamp', async () => {
    const { requests } = await setup({ source: 'shipping-logs', attempt: 'attempt-11045-1' }, { rows: [shippingRow], expectRows: 1 });
    const query = JSON.parse(requests[1].body ?? '{}') as { where: unknown[]; orderBy?: unknown; orders?: unknown };
    expect(query.where).toContainEqual({ field: 'attempt_id', op: '==', value: 'attempt-11045-1' });
    expect(JSON.stringify(query)).toContain('sequence');
  });

  it('refuses an undeclared recovery collection named in the URL and reads nothing', async () => {
    const { requests, el } = await setup({ source: 'shipping-logs', collection: 'recovery11045example' });
    expect(requests).toEqual([]);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('“recovery11045example” is not a declared collection of Shipping logs. Nothing was read.');
  });

  it('refuses an unknown source and an unreadable declaration instead of falling back to another source', async () => {
    const unknown = await setup({ source: 'nope' });
    expect(unknown.requests).toEqual([]);
    expect(unknown.el.querySelector('[role="alert"]')?.textContent).toContain('There is no declared log source “nope”.');
    TestBed.resetTestingModule();
    const unreadable = await setup({}, { sources: new Error('The project’s log source declarations could not be read. Try again later.') });
    expect(unreadable.requests).toEqual([]);
    expect(unreadable.el.querySelector('[role="alert"]')?.textContent).toContain('could not be read');
  });

  it('marks a declared collection the provider does not list yet as unavailable', async () => {
    const { requests, el, component } = await setup({ source: 'shipping-logs', collection: 'carrierGateway' });
    expect(requests.map((r) => r.method)).toEqual(['GET']);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Carrier gateway calls is declared but not available from the source yet.');
    expect(component.unavailable()).toEqual(['carrierGateway']);
    expect(el.textContent).toContain('Carrier gateway calls (not available yet)');
  });

  it('refuses an integer identifier that does not parse', async () => {
    const { requests, el } = await setup({ order: '11045x' });
    expect(requests).toEqual([]);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Order ID must be a whole number.');
  });

  it('reads the declared loopback source with raw text, correlation and the untimed toggle (local agent path)', async () => {
    const { fixture, requests, el, component } = await setup({ source: 'northwind-local', order: '11039' }, { rows: [northwindRow], expectRows: 1 });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET http://127.0.0.1:6832/v1/databases/northwind_evidence',
      'POST http://127.0.0.1:6832/v1/databases/northwind_evidence/query',
    ]);
    expect(where(requests[1])).toContainEqual({ field: 'order_id', op: '==', value: '11039' });
    (el.querySelector('.grid-entry') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.entry-details')?.textContent).toContain('nw-11039-f1');
    expect(el.querySelector('pre')?.textContent).toContain('CarrierClient.createLabel');
    expect(el.querySelector('.entry-details a')).toBeNull();

    component.includeUntimed.set(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('Order ID, correlation, severity filters still apply.');
    (el.querySelector('form button[type="button"]') as HTMLButtonElement).click();
    expect(component.values()).toEqual({});
    await component.load();
    expect(where(requests.at(-1)).some((f) => ['order_id', 'correlation_id', 'timestamp'].includes((f as { field: string }).field))).toBe(false);
  });

  it('shows malformed entries honestly', async () => {
    const { fixture, el } = await setup({ source: 'northwind-local' }, { rows: [malformedRow], expectRows: 1 });
    (el.querySelector('.grid-entry') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.entry-details')?.textContent).toContain('malformed');
    expect(el.querySelector('.entry-details')?.textContent).toContain('Not supplied');
  });

  it('reads an ad hoc source from the settings without touching the URL, and keeps the token loopback-only', async () => {
    const { requests, el, fixture, component } = await setup({}, { rows: [northwindRow] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    component.baseUrl.set('http://127.0.0.1:6832');
    component.databaseId.set('northwind_evidence');
    component.adhocCollection.set('fulfillment_events');
    component.ownerToken.set('local-secret');
    component.fromTime.set('2018-04-21T09:12:00Z');
    component.toTime.set('2018-04-21T09:14:00Z');
    component.readAdhoc();
    await vi.waitFor(() => expect(component.state()).toBe('ready'));
    fixture.detectChanges();
    expect(navigate).not.toHaveBeenCalled();
    expect(requests.at(-1)?.authorization).toBe('Bearer local-secret');
    expect(el.querySelector('.eyebrow')?.textContent).toContain('Ad hoc OVDB source · ad hoc source');
    const count = requests.length;
    component.baseUrl.set('https://example.com');
    await component.load();
    fixture.detectChanges();
    expect(requests).toHaveLength(count);
    expect(el.textContent).toContain('only be used with an HTTP loopback source');
  });

  it('writes declared filters into the URL and reloads when the URL changes', async () => {
    const { component, route, paramMap, requests } = await setup({ order: '11045' }, { rows: [shippingRow], expectRows: 1 });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(async (_commands, extras) => {
      route.snapshot.queryParamMap = convertToParamMap(extras?.queryParams ?? {});
      paramMap.next(route.snapshot.queryParamMap);
      return true;
    });
    component.setValue('order', '11038');
    await component.submit(new Event('submit'));
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: {
      source: 'shipping-logs', collection: 'baseline', from: '2018-04-01T00:00:00Z', to: '2018-05-21T00:00:00Z', order: '11038', attempt: '',
    } }));
    await vi.waitFor(() => expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2));
    expect(where(requests.at(-1))).toContainEqual({ field: 'order_id', op: '==', value: 11038 });
  });
});
