import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/provide';
import { QueryType, type IHttpQueryRequest } from '../../../models/definition/query-def';
import { HttpQueryEditorComponent } from './http-query-editor.component';
import {
  BrowserFetchFailedError,
  HttpRunService,
  ServerRunFailedError,
  type IHttpRunResult,
} from './http-run.service';

const baseRequest: IHttpQueryRequest = {
  queryType: QueryType.HTTP,
  url: 'https://api.github.com/repos/datatug/datatug',
  method: 'GET',
};

const okResult = (patch: Partial<IHttpRunResult> = {}): IHttpRunResult => ({
  via: 'browser',
  status: 200,
  statusText: 'OK',
  headers: [{ name: 'content-type', value: 'application/json' }],
  bodyText: '{"name":"datatug"}',
  truncated: false,
  sizeBytes: 18,
  durationMs: 12,
  ...patch,
});

describe('HttpQueryEditorComponent', () => {
  let fixture: ComponentFixture<HttpQueryEditorComponent>;
  let run: ReturnType<typeof vi.fn>;
  let emitted: IHttpQueryRequest[];

  async function create(request: IHttpQueryRequest = baseRequest) {
    fixture = TestBed.createComponent(HttpQueryEditorComponent);
    fixture.componentRef.setInput('request', request);
    emitted = [];
    fixture.componentInstance.requestChange.subscribe((r) => emitted.push(r));
    fixture.detectChanges();
    await fixture.whenStable();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const protectedApi = () =>
    fixture.componentInstance as unknown as Record<string, (...a: unknown[]) => unknown>;
  const ionEvent = (value: string) => new CustomEvent('ionInput', { detail: { value } });

  beforeEach(() => {
    run = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideIonicAngular(),
        { provide: HttpRunService, useValue: { run } },
      ],
    });
  });

  it('emits requestChange for method, URL, body and header edits', async () => {
    await create({ ...baseRequest, method: 'POST' });
    protectedApi()['onMethod'](new CustomEvent('ionChange', { detail: { value: 'PUT' } }));
    protectedApi()['onUrl'](ionEvent('https://x.test/y'));
    protectedApi()['onBody'](ionEvent('{"a":1}'));
    protectedApi()['addHeader']();
    expect(emitted.map((r) => [r.method, r.url, r.body, r.headers])).toEqual([
      ['PUT', baseRequest.url, undefined, undefined],
      ['POST', 'https://x.test/y', undefined, undefined],
      ['POST', baseRequest.url, '{"a":1}', undefined],
      ['POST', baseRequest.url, undefined, [{ name: '', value: '' }]],
    ]);
  });

  it('syncs params with the URL', async () => {
    await create({ ...baseRequest, url: 'https://x.test/a?b=1' });
    protectedApi()['setParam'](0, { value: '2' });
    protectedApi()['removeParam'](0);
    expect(emitted.map((r) => r.url)).toEqual([
      'https://x.test/a?b=2',
      'https://x.test/a',
    ]);
  });

  it('disables the body for GET and HEAD with a hint, enables it for POST', async () => {
    await create();
    protectedApi()['onRequestTab'](new CustomEvent('ionChange', { detail: { value: 'body' } }));
    fixture.detectChanges();
    await fixture.whenStable();
    let area = el().querySelector('ion-textarea') as HTMLElement & { disabled: boolean };
    expect(area.disabled).toBe(true);
    expect(text()).toContain('GET requests have no body.');

    fixture.componentRef.setInput('request', { ...baseRequest, method: 'POST' });
    fixture.detectChanges();
    await fixture.whenStable();
    area = el().querySelector('ion-textarea') as HTMLElement & { disabled: boolean };
    expect(area.disabled).toBe(false);
    expect(text()).not.toContain('requests have no body');
  });

  it('marks credential headers as not saved', async () => {
    await create({
      ...baseRequest,
      headers: [
        { name: 'Authorization', value: 'Bearer x' },
        { name: 'Accept', value: '*/*' },
      ],
    });
    protectedApi()['onRequestTab'](new CustomEvent('ionChange', { detail: { value: 'headers' } }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el().querySelectorAll('.http-credential-hint')).toHaveLength(1);
    expect(text()).toContain('not saved');
  });

  it('runs via the selected mode and renders status, size, duration and pretty JSON', async () => {
    run.mockResolvedValue(okResult({ via: 'server', truncated: true }));
    await create();
    protectedApi()['onRunVia'](new CustomEvent('ionChange', { detail: { value: 'server' } }));
    await (protectedApi()['run']() as Promise<void>);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(run).toHaveBeenCalledWith(baseRequest, 'server');
    expect(el().querySelector('.http-status')?.textContent).toBe('200 OK');
    expect(el().querySelector('.http-duration')?.textContent).toBe('12 ms');
    expect(el().querySelector('.http-size')?.textContent).toBe('18 B');
    expect(el().querySelector('.http-truncated')).toBeTruthy();
    expect(el().querySelector('.http-response-body')?.textContent).toContain('"name": "datatug"');
  });

  it('shows the CORS message with a server retry when the browser call fails', async () => {
    run.mockRejectedValueOnce(new BrowserFetchFailedError(new TypeError('Failed to fetch')));
    await create();
    await (protectedApi()['run']() as Promise<void>);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text()).toContain('CORS');
    const retry = Array.from(el().querySelectorAll('ion-button')).find((b) =>
      b.textContent?.includes('Run via DataTug server'),
    ) as HTMLElement;
    expect(retry).toBeTruthy();

    run.mockResolvedValueOnce(okResult({ via: 'server' }));
    retry.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(run).toHaveBeenLastCalledWith(baseRequest, 'server');
    expect(el().querySelector('.http-status')?.textContent).toBe('200 OK');
    expect(text()).not.toContain('CORS');
  });

  it('shows a server failure without offering a retry', async () => {
    run.mockRejectedValueOnce(new ServerRunFailedError('blocked target'));
    await create();
    await (protectedApi()['run']('server') as Promise<void>);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text()).toContain('blocked target');
    expect(text()).not.toContain('Run via DataTug server Run');
    expect(el().querySelectorAll('.http-error-message')).toHaveLength(1);
  });

  it('does not run an empty URL', async () => {
    await create({ ...baseRequest, url: ' ' });
    await (protectedApi()['run']() as Promise<void>);
    expect(run).not.toHaveBeenCalled();
  });
});
