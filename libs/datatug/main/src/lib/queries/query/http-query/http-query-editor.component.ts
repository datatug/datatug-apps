import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonChip,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTextarea,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  closeOutline,
  lockClosedOutline,
  playCircleOutline,
} from 'ionicons/icons';
import { JsonTableComponent } from '../../../components/jsontug/json-table.component';
import type { HttpMethod } from '../../../models/definition/command-definition';
import type {
  IHttpHeader,
  IHttpQueryRequest,
} from '../../../models/definition/query-def';
import { isCredentialHttpHeader } from '../../http-credential-headers';
import {
  ABSOLUTE_URL_MESSAGE,
  MAX_HTTP_HEADERS,
  httpRequestSaveProblem,
  isAbsoluteHttpUrl,
  isBrowserForbiddenHeader,
  isHttpToken,
} from '../../http-request-rules';
import {
  BrowserFetchFailedError,
  HttpRunService,
  methodTakesBody,
  type HttpRunVia,
  type IHttpRunResult,
} from './http-run.service';
import { parseUrlParams, withUrlParams } from './http-url-params';

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const satisfies readonly HttpMethod[];

type RequestTab = 'params' | 'headers' | 'body';
type ResponseTab = 'headers' | 'body' | 'structured';

function eventText(event: Event): string {
  const detail = (event as CustomEvent<{ value?: string | null }>).detail;
  return detail?.value ?? '';
}

/**
 * Postman-like editor of one HTTP request. Controlled: the owner passes the
 * `request` and applies each `requestChange`. Running does not change it.
 */
@Component({
  selector: 'sneat-datatug-http-query-editor',
  templateUrl: 'http-query-editor.component.html',
  styleUrl: 'http-query-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonChip,
    IonIcon,
    IonInput,
    IonItem,
    IonLabel,
    IonNote,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonTextarea,
    JsonTableComponent,
  ],
})
export class HttpQueryEditorComponent {
  private readonly runService = inject(HttpRunService);

  readonly request = input.required<IHttpQueryRequest>();
  readonly requestChange = output<IHttpQueryRequest>();

  protected readonly methods = HTTP_METHODS;
  protected readonly requestTab = signal<RequestTab>('params');
  protected readonly responseTab = signal<ResponseTab>('body');
  protected readonly runVia = signal<HttpRunVia>('browser');
  protected readonly running = signal(false);
  protected readonly result = signal<IHttpRunResult | undefined>(undefined);
  protected readonly runError = signal<string | undefined>(undefined);
  /** The browser call failed before any response, so the server may succeed. */
  protected readonly offerServerRun = signal(false);
  /** The param rows being edited, kept while they still serialise to the URL (blank-name rows are not in it). */
  private readonly paramDraft = signal<IHttpHeader[] | undefined>(undefined);

  protected readonly method = computed(() => this.request().method ?? 'GET');
  protected readonly url = computed(() => this.request().url ?? '');
  protected readonly headers = computed(() => this.request().headers ?? []);
  protected readonly body = computed(() => this.request().body ?? '');
  protected readonly takesBody = computed(() => methodTakesBody(this.method()));
  /** Why the URL cannot be run, when something has been typed. */
  protected readonly urlProblem = computed(() =>
    this.url().trim() !== '' && !isAbsoluteHttpUrl(this.url())
      ? ABSOLUTE_URL_MESSAGE
      : undefined,
  );
  protected readonly canRun = computed(
    () => this.url().trim() !== '' && !this.urlProblem() && !this.running(),
  );
  protected readonly maxHeaders = MAX_HTTP_HEADERS;
  protected readonly canAddHeader = computed(
    () => this.headers().length < MAX_HTTP_HEADERS,
  );
  /** Blocks Save: the same rule the save path applies. */
  protected readonly saveProblem = computed(() =>
    httpRequestSaveProblem(this.request()),
  );
  /** Headers a browser run silently drops; only the DataTug server sends them. */
  protected readonly browserForbidden = computed(() =>
    this.runVia() === 'browser'
      ? this.headers()
          .map((h) => h.name.trim())
          .filter((n) => n !== '' && isBrowserForbiddenHeader(n))
      : [],
  );

  protected readonly paramRows = computed<IHttpHeader[]>(() => {
    const draft = this.paramDraft();
    return draft && withUrlParams(this.url(), draft) === this.url()
      ? draft
      : parseUrlParams(this.url());
  });

  protected readonly bodyJson = computed(() => {
    const text = this.result()?.bodyText;
    if (text === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      return { parsed, pretty: JSON.stringify(parsed, null, 2) };
    } catch {
      return undefined;
    }
  });

  protected readonly bodyDisplay = computed(() => {
    const r = this.result();
    if (!r) return '';
    if (r.bodyText === undefined) return `[binary body, ${r.sizeBytes} bytes]`;
    return this.bodyJson()?.pretty ?? r.bodyText;
  });

  protected readonly structured = computed(() => {
    const parsed = this.bodyJson()?.parsed;
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  });

  constructor() {
    addIcons({
      addOutline,
      closeOutline,
      lockClosedOutline,
      playCircleOutline,
    });
  }

  protected isCredential(name: string): boolean {
    return isCredentialHttpHeader(name);
  }

  private emit(patch: Partial<IHttpQueryRequest>): void {
    this.requestChange.emit({ ...this.request(), ...patch });
  }

  protected onMethod(event: Event): void {
    const method = eventText(event) as HttpMethod;
    if (method && method !== this.method()) this.emit({ method });
  }

  protected onUrl(event: Event): void {
    const url = eventText(event);
    if (url !== this.url()) this.emit({ url });
  }

  protected onBody(event: Event): void {
    const body = eventText(event);
    if (body !== this.body()) this.emit({ body });
  }

  // Params

  protected setParam(index: number, patch: Partial<IHttpHeader>): void {
    const rows = this.paramRows().map((row, i) =>
      i === index ? { ...row, ...patch } : row,
    );
    this.applyParams(rows);
  }

  protected addParam(): void {
    this.paramDraft.set([...this.paramRows(), { name: '', value: '' }]);
  }

  protected removeParam(index: number): void {
    this.applyParams(this.paramRows().filter((_, i) => i !== index));
  }

  private applyParams(rows: IHttpHeader[]): void {
    this.paramDraft.set(rows);
    const url = withUrlParams(this.url(), rows);
    if (url !== this.url()) this.emit({ url });
  }

  // Headers

  protected setHeader(index: number, patch: Partial<IHttpHeader>): void {
    this.emit({
      headers: this.headers().map((h, i) =>
        i === index ? { ...h, ...patch } : h,
      ),
    });
  }

  protected isInvalidHeaderName(name: string): boolean {
    return name.trim() !== '' && !isHttpToken(name.trim());
  }

  protected addHeader(): void {
    if (!this.canAddHeader()) return;
    this.emit({ headers: [...this.headers(), { name: '', value: '' }] });
  }

  protected removeHeader(index: number): void {
    this.emit({ headers: this.headers().filter((_, i) => i !== index) });
  }

  // Tabs and run mode

  protected onRequestTab(event: Event): void {
    const value = eventText(event) as RequestTab;
    if (value) this.requestTab.set(value);
  }

  protected onResponseTab(event: Event): void {
    const value = eventText(event) as ResponseTab;
    if (value) this.responseTab.set(value);
  }

  protected onRunVia(event: Event): void {
    const value = eventText(event) as HttpRunVia;
    if (value === 'browser' || value === 'server') this.runVia.set(value);
  }

  // Run

  protected async run(via: HttpRunVia = this.runVia()): Promise<void> {
    if (!this.canRun()) return;
    this.runVia.set(via);
    this.running.set(true);
    this.runError.set(undefined);
    this.offerServerRun.set(false);
    try {
      const result = await this.runService.run(this.request(), via);
      this.result.set(result);
    } catch (e) {
      this.result.set(undefined);
      this.runError.set(e instanceof Error ? e.message : 'The run failed.');
      this.offerServerRun.set(e instanceof BrowserFetchFailedError);
    } finally {
      this.running.set(false);
    }
  }

  protected runViaServer(): Promise<void> {
    return this.run('server');
  }
}
