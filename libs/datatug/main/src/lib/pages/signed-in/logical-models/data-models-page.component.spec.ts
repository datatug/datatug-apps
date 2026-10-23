import {CUSTOM_ELEMENTS_SCHEMA} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {provideRouter, type Routes} from '@angular/router';
import {RouterTestingHarness} from '@angular/router/testing';
import {Subject, finalize, of, throwError} from 'rxjs';
import {DataModelsPageComponent} from './data-models-page.component';
import {NativeDataModelsService, MEANINGGRAPH_CATALOG_FETCH, MEANINGGRAPH_CATALOG_PIN, type DataModelDetail, type DataModelSummary} from '../../../logical-models/native-data-models.service';
import {modelAST, nativeFixture} from '../../../logical-models/native-data-models.spec-helper';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const summary: DataModelSummary = {
  id: 'chinook',
  title: 'Chinook',
  address: 'modelspec://github.com/demo-db/chinook/chinook',
  revisionId: 'c'.repeat(64),
  commit: COMMIT_A,
  moduleId: 'github.com/demo-db/chinook/chinook',
  moduleVersion: '1.0.0',
};
const detail: DataModelDetail = {
  ...summary,
  records: [{
    name: 'Invoice',
    key: ['InvoiceId'],
    uses: ['AuditFields'],
    fields: [{name: 'Total', type: 'decimal', required: true, constraints: {minimum: '0.00', maximum: '999999999999999999.99'}, origin: 'Common.Money'}, {name: 'Total', type: 'decimal', required: true, constraints: {}, origin: 'InvoiceExtras'}],
  }],
  components: [{name: 'AuditFields', key: [], uses: [], fields: [{name: 'CreatedAt', type: 'datetime', constraints: {}}]}],
  enums: [{name: 'InvoiceStatus', values: ['open', 'paid']}],
  sourceFiles: [{name: 'model/chinook.modelspec.json', url: 'https://github.com/demo-db/chinook/blob/a/model/chinook.modelspec.json'}],
};

const routes: Routes = [
  {path: 'data-models', component: DataModelsPageComponent},
  {path: 'data-models/:modelId/versions/:commit', component: DataModelsPageComponent},
];

async function setup(service: Record<string, unknown>) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      {provide: NativeDataModelsService, useValue: service},
    ],
  })
    .overrideComponent(DataModelsPageComponent, {
      set: {
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
      },
    })
    .compileComponents();
  return RouterTestingHarness.create();
}

describe('DataModelsPageComponent', () => {
  it('browses a pinned model-only list and exact detail through the real reader service', async () => {
    const source = await nativeFixture();
    await source.retain({alias: 'Chinook', original: modelAST('Chinook', {
      Artist: {key: ['ArtistId'], fields: {ArtistId: {type: 'int', required: true}}},
      Album: {fields: {ArtistId: {record: 'Artist'}}},
    })});
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({providers: [
      provideRouter(routes),
      {provide: MEANINGGRAPH_CATALOG_PIN, useValue: await source.publish()},
      {provide: MEANINGGRAPH_CATALOG_FETCH, useValue: source.http},
    ]}).overrideComponent(DataModelsPageComponent, {set: {schemas: [CUSTOM_ELEMENTS_SCHEMA]}}).compileComponents();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/data-models', DataModelsPageComponent);
    await vi.waitFor(() => expect(harness.routeNativeElement?.textContent).toContain('Chinook model'));
    await harness.navigateByUrl(`/data-models/chinook/versions/${COMMIT_A}`, DataModelsPageComponent);
    await vi.waitFor(() => expect(harness.routeNativeElement?.textContent).toContain('record Artist'));
    expect(harness.routeNativeElement?.textContent).toContain(COMMIT_A);
    expect(harness.routeNativeElement?.textContent).toContain('ArtistId');
    expect(source.http.mock.calls.some(([url]) => String(url).includes('/revisions/$records/'))).toBe(true);
    expect(source.http.mock.calls.every(([url]) => String(url).startsWith('https://raw.githubusercontent.com/meaninggraph/registry/'))).toBe(true);
  });
  it('shows an explicit not-configured message and no invented models', async () => {
    const service = {configured: false, list: vi.fn(), detail: vi.fn()};
    const harness = await setup(service);
    await harness.navigateByUrl('/data-models', DataModelsPageComponent);
    const page = harness.routeNativeElement;
    if (!page) throw new Error('DataModelsPageComponent did not render');
    expect(page.textContent).toContain('Data model catalog not configured');
    expect(page.querySelector('a[href^="https://meaninggraph.io/registry/models/"]')).toBeTruthy();
    expect(page.querySelectorAll('.data-model-list li')).toHaveLength(0);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.detail).not.toHaveBeenCalled();
  });

  it('renders a late list emission after the first render without another detectChanges call', async () => {
    const models$ = new Subject<readonly DataModelSummary[]>();
    const service = {configured: true, list: vi.fn(() => models$.asObservable()), detail: vi.fn()};
    const harness = await setup(service);
    await harness.navigateByUrl('/data-models', DataModelsPageComponent);
    expect(harness.routeNativeElement?.textContent).toContain('Loading DataModels');

    models$.next([summary]);
    await harness.fixture.whenStable();

    expect(harness.routeNativeElement?.textContent).toContain('Chinook');
    expect(harness.routeNativeElement?.textContent).toContain(COMMIT_A);
    expect(harness.routeNativeElement?.querySelector('a')?.getAttribute('href')).toBe(`/data-models/chinook/versions/${COMMIT_A}`);
  });

  it('shows a real empty state and an observable error state', async () => {
    // A synchronous observable keeps this test independent of change-detection timing.
    const harness = await setup({configured: true, list: () => of([]), detail: vi.fn()});
    await harness.navigateByUrl('/data-models', DataModelsPageComponent);
    expect(harness.routeNativeElement?.textContent).toContain('No DataModels are registered');

    const errorHarness = await setup({configured: true, list: () => throwError(() => new Error('Catalog checksum mismatch')), detail: vi.fn()});
    await errorHarness.navigateByUrl('/data-models', DataModelsPageComponent);
    expect(errorHarness.routeNativeElement?.textContent).toContain('Catalog checksum mismatch');
    expect(errorHarness.routeNativeElement?.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('cancels the prior detail request on route changes and renders keys, components, enums, constraints and origins', async () => {
    const first$ = new Subject<DataModelDetail>();
    let firstUnsubscribed = false;
    const second$ = new Subject<DataModelDetail>();
    const service = {
      configured: true,
      list: vi.fn(() => new Subject<readonly DataModelSummary[]>().asObservable()),
      detail: vi.fn((id: string) => id === 'first'
        ? first$.pipe(finalize(() => { firstUnsubscribed = true; }))
        : second$.asObservable()),
    };
    const harness = await setup(service);
    await harness.navigateByUrl(`/data-models/first/versions/${COMMIT_A}`, DataModelsPageComponent);
    expect(harness.routeNativeElement?.textContent).toContain(`commit ${COMMIT_A}`);
    await harness.navigateByUrl(`/data-models/chinook/versions/${COMMIT_B}`, DataModelsPageComponent);
    expect(firstUnsubscribed).toBe(true);
    expect(service.detail).toHaveBeenLastCalledWith('chinook', COMMIT_B);

    const sharedArtifactUrl = 'https://raw.githubusercontent.com/meaninggraph/registry/' + COMMIT_B + '/artifacts/sha256/aa/' + 'a'.repeat(64);
    second$.next({...detail, commit: COMMIT_B, sourceFiles: [
      ...detail.sourceFiles,
      {name: 'LICENSE', url: sharedArtifactUrl},
      {name: 'data-source/LICENSE.txt', url: sharedArtifactUrl},
    ]});
    await harness.fixture.whenStable();

    const text = harness.routeNativeElement?.textContent ?? '';
    expect(text).toContain(COMMIT_B);
    expect(text).toContain('Invoice');
    expect(text).toContain('InvoiceId');
    expect(text).toContain('AuditFields');
    expect(text).toContain('InvoiceStatus');
    expect(text).toContain('999999999999999999.99');
    expect(text).toContain('Common.Money');
    expect(Array.from(harness.routeNativeElement?.querySelectorAll('a') ?? []).some((link) => link.textContent?.includes('model/chinook.modelspec.json'))).toBe(true);
    expect(Array.from(harness.routeNativeElement?.querySelectorAll('a') ?? []).filter((link) => link.href === sharedArtifactUrl).map(link => link.textContent?.trim())).toEqual(['LICENSE', 'data-source/LICENSE.txt']);
  });
  it('renders punctuation and Unicode names, source types and exact origins verbatim', async () => {
    const recordName = 'Record/100%Δ',
      fieldName = 'field/100%Δ',
      fieldType = 'component Component/100%Δ',
      fieldOrigin = 'modelspec://github.com/acme/sourcenames/SourceNames@' + COMMIT_A
        + ' records.Record/100%Δ.field/100%Δ; references component Component/100%Δ => '
        + 'modelspec://github.com/acme/sourcenames/SourceNames@' + COMMIT_A,
      edgeDetail: DataModelDetail = {
        ...detail,
        records: [{
          name: recordName,
          key: [fieldName],
          uses: [],
          fields: [{name: fieldName, type: fieldType, constraints: {}, origin: fieldOrigin}],
        }],
        components: [],
        enums: [],
      };
    const harness = await setup({
      configured: true,
      list: () => of([]),
      detail: vi.fn(() => of(edgeDetail)),
    });
    await harness.navigateByUrl(
      `/data-models/chinook/versions/${COMMIT_A}`,
      DataModelsPageComponent,
    );
    const page = harness.routeNativeElement;
    expect(page?.querySelector('.data-model-declaration h3')?.textContent).toBe(recordName);
    const field = Array.from(page?.querySelectorAll('.data-model-fields li') ?? [])
      .find((item) => item.querySelector('strong')?.textContent === fieldName);
    expect(field?.querySelector('code')?.textContent).toBe(fieldType);
    expect(field?.querySelector('small')?.textContent).toBe(`Declared in ${fieldOrigin}`);
  });
});
