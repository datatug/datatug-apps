import { DEMO_LOG_SOURCE_ADAPTER, type DemoLogSourceAdapter } from './demo-log-source-adapter';
import { Component, input, output } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OvdbRow } from '../../ovdb/ovdb-records';
import { DemoLogsPageComponent } from './demo-logs-page.component';

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

const descriptor = {
  id: 'northwind_evidence',
  collections: ['fulfillment_events'],
  capabilities: { query: true, write: false, read: false },
};
const evidence = {
  key: 'fulfillment_events/entry-1',
  data: {
    timestamp: '2018-04-21T09:13:05Z', severity: 'ERROR', service: 'carrier-gateway',
    message: 'Carrier returned HTTP 503', order_id: '11039',
    correlation_id: 'nw-11039-f1', source_ref: 'file:abc:10:200',
    raw: '2018-04-21T09:13:05Z ERROR carrier-gateway Carrier returned HTTP 503\n  at CarrierClient.createLabel',
    parse_status: 'parsed',
  },
};

const malformedEvidence = {
  key: 'fulfillment_events/malformed-entry',
  data: {
    severity: 'WARN', service: 'carrier-gateway',
    message: 'Malformed line without structured identifiers',
    source_ref: 'file:abc:11:201', raw: 'unparsed carrier warning',
    parse_status: 'malformed',
  },
};

async function setup(queryRecords: readonly OvdbRow[] = [evidence], adapter?: DemoLogSourceAdapter) {
  const requests: Array<{ url: string; method: string; body?: string; authorization?: string }> = [];
  const orderParams = new BehaviorSubject(convertToParamMap({ order: '11039' }));
  const route = { snapshot: { queryParamMap: orderParams.value }, queryParamMap: orderParams.asObservable() };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? 'GET', body: init?.body?.toString(), authorization: new Headers(init?.headers).get('Authorization') ?? undefined });
    if (url.endsWith('/v1/databases/northwind_evidence')) return new Response(JSON.stringify(descriptor), { status: 200 });
    if (url.endsWith('/v1/databases/northwind_evidence/query')) return new Response(JSON.stringify({ records: queryRecords }), { status: 200 });
    return new Response('missing', { status: 404 });
  }));
  TestBed.overrideComponent(DemoLogsPageComponent, {
    remove: { imports: [AgGridAngular] }, add: { imports: [GridStubComponent] },
  });
  await TestBed.configureTestingModule({
    imports: [DemoLogsPageComponent],
    providers: [...(adapter ? [{ provide: DEMO_LOG_SOURCE_ADAPTER, useValue: adapter }] : []), provideRouter([]), {
      provide: ActivatedRoute,
      useValue: route,
    }],
  }).compileComponents();
  const fixture = TestBed.createComponent(DemoLogsPageComponent);
  fixture.detectChanges();
  await vi.waitFor(async () => {
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.grid-entry').length).toBe(1);
  });
  return { fixture, requests, el: fixture.nativeElement as HTMLElement, orderParams, route };
}

describe('DemoLogsPageComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('queries the ordinary OVDB collection and shows chronological evidence and raw multiline text', async () => {
    const { fixture, requests, el } = await setup();
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET http://127.0.0.1:6832/v1/databases/northwind_evidence',
      'POST http://127.0.0.1:6832/v1/databases/northwind_evidence/query',
    ]);
    const query = JSON.parse(requests[1].body ?? '{}') as { where: Array<{ field: string; value: string }> };
    expect(query.where).toContainEqual({ field: 'order_id', op: '==', value: '11039' });
    expect(el.textContent).toContain('Carrier returned HTTP 503');
    const entry = el.querySelector('.grid-entry') as HTMLButtonElement;
    entry.click();
    await fixture.whenStable();
    expect(el.querySelector('.entry-details')?.textContent).toContain('nw-11039-f1');
    expect(el.querySelector('pre')?.textContent).toContain('CarrierClient.createLabel');
    expect(el.querySelector('a[href*="record=11039"]')).not.toBeNull();
  });

  it('renders independent registered source labels and exact identifier mapping without business inference', async () => {
    const adapter: DemoLogSourceAdapter = {
      defaults: { baseUrl: 'http://127.0.0.1:6832', databaseId: 'northwind_evidence', collection: 'fulfillment_events', identifier: 'sample-7', from: '2018-04-21T09:12:00Z', to: '2018-04-21T09:14:00Z' },
      identifier: { label: 'Sample ID', field: 'sample_id', queryParam: 'sample' },
      detailFields: [{ label: 'Sample', field: 'sample_id' }],
      heading: () => ({ eyebrow: 'Registered samples', title: 'Calibration observations', description: 'Actual selected source configuration' }),
      relatedRecord: () => undefined,
      originalLabel: () => 'Original sample entry',
    };
    const { fixture, requests, el } = await setup([{ ...evidence, data: { ...evidence.data, sample_id: 'sample-7' } }], adapter);
    expect(el.querySelector('h1')?.textContent).toBe('Calibration observations');
    expect(el.textContent).toContain('Sample ID');
    expect(el.textContent).not.toContain('Order ID');
    expect(el.textContent).not.toContain('Northwind investigation');
    const query = JSON.parse(requests.at(-1)?.body ?? '{}');
    expect(query.where).toContainEqual({ field: 'sample_id', op: '==', value: 'sample-7' });
    expect(query.where.some((field: { field: string }) => field.field === 'order_id')).toBe(false);
    (el.querySelector('.grid-entry') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.entry-details')?.textContent).toContain('Original sample entry');
    expect(el.querySelector('a[href*="record="]')).toBeNull();
  });

  it('explains that identity filters still exclude malformed entries and can be cleared', async () => {
    const { fixture, requests, el } = await setup([malformedEvidence]);
    const component = fixture.componentInstance;
    expect(component.includeUntimed()).toBe(false);
    expect(component.identifier()).toBe('11039');

    component.includeUntimed.set(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('Identifier, correlation, and severity filters still apply.');
    expect(el.textContent).toContain('Malformed entries may not contain those fields.');
    expect(el.textContent).toContain('select All severity');
    const initialQuery = JSON.parse(requests.at(-1)?.body ?? '{}') as { where: Array<{ field: string; value: string }> };
    expect(initialQuery.where).toContainEqual({ field: 'order_id', op: '==', value: '11039' });

    (el.querySelector('button[type="button"]') as HTMLButtonElement).click();
    expect(component.identifier()).toBe('');
    expect(component.correlationId()).toBe('');
    await component.load();
    await fixture.whenStable();
    const clearedQuery = JSON.parse(requests.at(-1)?.body ?? '{}') as { where?: Array<{ field: string; value: string }> };
    expect((clearedQuery.where ?? []).some(({ field }) => ['order_id', 'correlation_id'].includes(field))).toBe(false);

    fixture.detectChanges();
    (el.querySelector('.grid-entry') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.entry-details')?.textContent).toContain('malformed');
    expect(el.querySelector('.entry-details')?.textContent).toContain('Not supplied');
  });

  it('keeps evidence visible and announces clipboard failures', async () => {
    const { fixture, el } = await setup();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    await fixture.componentInstance.copyReference(evidence);
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Clipboard access is unavailable');
    expect(el.querySelector('ag-grid-angular')).not.toBeNull();
    expect(fixture.componentInstance.state()).toBe('ready');
  });

  it('keeps a local source token in memory and refuses to send it to a remote URL', async () => {
    const { fixture, requests, el } = await setup();
    fixture.componentInstance.ownerToken.set('local-secret');
    await fixture.componentInstance.load();
    expect(requests.at(-2)?.authorization).toBe('Bearer local-secret');
    expect(requests.at(-1)?.authorization).toBe('Bearer local-secret');
    const count = requests.length;
    fixture.componentInstance.baseUrl.set('https://example.com');
    await fixture.componentInstance.load();
    expect(requests).toHaveLength(count);
    fixture.detectChanges();
    expect(el.textContent).toContain('only be used with an HTTP loopback source');
  });

  it('labels results from the applied source and keeps record links tied to returned evidence', async () => {
    const { fixture, el } = await setup();
    fixture.componentInstance.identifier.set('11040');
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toContain('11039');
    expect(el.querySelector('a[href*="record=11039"]')).not.toBeNull();
    (el.querySelector('.grid-entry') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('a[href*="record=11039"]').length).toBe(2);

    fixture.componentInstance.applied.set({ baseUrl: 'http://127.0.0.1:6832', databaseId: 'cloud_owned', collection: 'entries', identifier: '11039' });
    fixture.componentInstance.rows.set([{ ...evidence, data: { ...evidence.data, parser: 'google-cloud-logging' } }]);
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toBe('Log evidence timeline');
    expect(el.textContent).not.toContain('The database record is real');
    expect(el.querySelector('a[href*="record=11039"]')).toBeNull();
    expect(el.querySelector('.entry-details h3')?.textContent).toContain('SDK reconstruction');

    fixture.componentInstance.applied.set({ baseUrl: 'http://127.0.0.1:6832', databaseId: 'northwind_evidence', collection: 'carrier_events', identifier: '' });
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toBe('Northwind order evidence');
    expect(el.querySelector('a[href*="record=11039"]')).not.toBeNull();
  });

  it('reloads evidence for same-route order navigation and keeps submitted order in the URL', async () => {
    const { fixture, requests, orderParams, route, el } = await setup();
    route.snapshot.queryParamMap = convertToParamMap({ order: '11040' });
    orderParams.next(route.snapshot.queryParamMap);
    await vi.waitFor(async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('h1')?.textContent).toContain('11040');
      expect(el.querySelector('h1')?.textContent).not.toContain('unshipped');
      expect(requests.filter((request) => request.method === 'POST')).toHaveLength(2);
    });
    const secondQuery = JSON.parse(requests.at(-1)?.body ?? '{}') as { where: Array<{ field: string; value: string }> };
    expect(secondQuery.where).toContainEqual({ field: 'order_id', op: '==', value: '11040' });

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(async (_commands, extras) => {
      route.snapshot.queryParamMap = convertToParamMap({ order: String(extras?.queryParams?.['order']) });
      orderParams.next(route.snapshot.queryParamMap);
      return true;
    });
    fixture.componentInstance.identifier.set('11041');
    await fixture.componentInstance.load(new Event('submit'));
    await vi.waitFor(async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('h1')?.textContent).toContain('11041');
      expect(requests.filter((request) => request.method === 'POST')).toHaveLength(3);
    });
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { order: '11041' }, queryParamsHandling: 'merge' }));
    expect(fixture.componentInstance.applied()?.identifier).toBe('11041');
  });
});
