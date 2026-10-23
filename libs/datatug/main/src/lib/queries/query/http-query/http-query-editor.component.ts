import { NgTemplateOutlet } from '@angular/common';
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
  IonToggle,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  closeOutline,
  informationCircleOutline,
  lockClosedOutline,
  playCircleOutline,
  warningOutline,
} from 'ionicons/icons';
import type { IParameterDef } from '../../../models/definition/parameter';
import type { DataType } from '../../../models/definition/types';
import {
  HTTP_PARAMETER_TYPES,
  HttpTemplateError,
  httpTemplatePlaceholders,
  placeholderNames,
  substituteHttpTemplate,
  substituteHttpTemplateParts,
  type HttpSubstitutedPart,
  validateHttpTemplate,
  type HttpPlaceholder,
  type HttpRequestTemplate,
} from '../../http-template';
import {
  HTTP_VALUE_SOURCE_LABEL,
  httpRunParameterRecord,
  resolveHttpParameters,
  type HttpBagEntry,
  type HttpValueSource,
  type HttpRowBinding,
  type ResolvedHttpParameter,
} from '../../http-parameter-binding';
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
  type IHttpRunTemplate,
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

/** A default typed as text, as the JSON value the parameter type expects. */
export function parseDefault(type: string, text: string): IParameterDef['defaultValue'] {
  if (text === '') return undefined;
  switch (type) {
    case 'integer':
    case 'number':
    case 'bit': {
      const n = Number(text);
      return Number.isFinite(n) && text.trim() !== '' ? n : text;
    }
    case 'boolean':
      return text === 'true' ? true : text === 'false' ? false : text;
  }
  return text;
}

/**
 * Postman-like editor of one HTTP request. Controlled: the owner passes the
 * `request` and applies each `requestChange`. Running does not change it.
 */
/** A piece of a resolved request, marked with the source of the parameter that filled it. */
export interface PreviewSegment {
  readonly text: string;
  readonly id?: string;
  readonly source?: HttpValueSource;
}

@Component({
  selector: 'sneat-datatug-http-query-editor',
  templateUrl: 'http-query-editor.component.html',
  styleUrl: 'http-query-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
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
    IonToggle,
    JsonTableComponent,
  ],
})
export class HttpQueryEditorComponent {
  private readonly runService = inject(HttpRunService);

  readonly request = input.required<IHttpQueryRequest>();
  readonly requestChange = output<IHttpQueryRequest>();
  /** Declared parameters of the query (saved with it); `{id}` placeholders reference them. */
  readonly parameters = input<readonly IParameterDef[]>([]);
  readonly parametersChange = output<IParameterDef[]>();
  /** The one result row this run was launched from, if any. */
  readonly rowBinding = input<HttpRowBinding | undefined>(undefined);
  /** Board or card parameter values (delivered by the board feature). */
  readonly boardValues = input<Readonly<Record<string, unknown>> | undefined>(undefined);
  /** Applied session context bag entries. */
  readonly bagEntries = input<readonly HttpBagEntry[]>([]);
  /** False when the page offers the one primary Run (the semantic path): this editor then only authors the request. */
  readonly showRun = input(true);

  /** Columns picked in the run panel by parameter id (this run only). */
  protected readonly pickedColumns = signal<Readonly<Record<string, string>>>({});
  protected readonly rowColumnNames = computed(
    () => this.rowBinding()?.columns.map((c) => c.name) ?? [],
  );

  protected pickColumn(id: string, event: Event): void {
    const value = (event as CustomEvent<{ value?: string }>).detail?.value ?? '';
    const next = { ...this.pickedColumns() };
    if (value) next[id] = value;
    else delete next[id];
    this.pickedColumns.set(next);
  }

  protected readonly parameterTypes = HTTP_PARAMETER_TYPES;
  protected readonly sourceLabel = HTTP_VALUE_SOURCE_LABEL;
  /** Values typed in the run panel: this run only, never saved or written to the bag. */
  protected readonly typedValues = signal<Readonly<Partial<Record<string, string>>>>({});

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
  protected readonly urlProblem = computed(() => {
    const url = this.url();
    if (url.trim() === '') return undefined;
    if (!isAbsoluteHttpUrl(url.replace(/\{[a-zA-Z0-9_]+\}/g, 'x')))
      return ABSOLUTE_URL_MESSAGE;
    // A host is pinned to the saved query, so a placeholder there can never work.
    const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url.trim())?.[1] ?? '';
    return /\{[a-zA-Z0-9_]+\}/.test(host)
      ? "A placeholder can't be in the web address's host, so this request can never run. Use a separate query for each host."
      : undefined;
  });
  protected readonly canRun = computed(
    () =>
      this.url().trim() !== '' &&
      !this.urlProblem() &&
      !this.running() &&
      !this.templateProblem() &&
      !this.valueProblem() &&
      !this.preview()?.error,
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

  /** The request as a template: every named header, and the body only where the method sends one. */
  protected readonly template = computed<HttpRequestTemplate>(() => ({
    method: this.method(),
    url: this.url(),
    headers: this.headers()
      .filter((h) => h.name.trim() !== '')
      .map((h) => ({ name: h.name.trim(), value: h.value })),
    ...(this.takesBody() ? { body: this.body() } : {}),
  }));
  private readonly scan = computed<{ placeholders: HttpPlaceholder[]; error?: string }>(() => {
    try {
      return { placeholders: httpTemplatePlaceholders(this.template()) };
    } catch (e) {
      const t = this.template();
      const names = [t.url, t.body ?? '', ...(t.headers ?? []).flatMap((h) => [h.name, h.value])]
        .flatMap(placeholderNames);
      return {
        placeholders: names.map((name) => ({ name, position: 'path' as const })),
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
  /** Placeholder names in template order, once each. */
  protected readonly placeholderIds = computed(() => [
    ...new Set(this.scan().placeholders.map((p) => p.name)),
  ]);
  private readonly credentialIds = computed(
    () => new Set(this.scan().placeholders.filter((p) => p.credential).map((p) => p.name)),
  );
  protected readonly hasParameters = computed(() => this.parameters().length > 0);
  protected readonly undeclared = computed(() => {
    const ids = new Set(this.parameters().map((p) => p.id));
    return this.placeholderIds().filter((id) => !ids.has(id));
  });
  protected readonly unusedIds = computed(() => {
    const used = new Set(this.placeholderIds());
    return new Set(
      this.parameters().filter((p) => !p.isCredential && !used.has(p.id)).map((p) => p.id),
    );
  });
  /** Blocks save and run once a parameter is declared (REQ:placeholder-semantics). */
  protected readonly templateProblem = computed(() => {
    if (!this.hasParameters()) return undefined;
    try {
      validateHttpTemplate(this.template(), this.parameters());
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
  /** A legacy query with `{name}` text is sent literally, so this only warns (REQ:legacy-literal-braces). */
  protected readonly legacyPlaceholders = computed(() =>
    this.hasParameters() ? [] : this.placeholderIds(),
  );
  /** The CLI runs only the URL as a GET (REQ:cli-parity). */
  protected readonly cliIncompatible = computed(
    () =>
      this.method() !== 'GET' ||
      this.scan().placeholders.some((p) => p.position !== 'path' && p.position !== 'query'),
  );
  protected readonly resolved = computed<ResolvedHttpParameter[]>(() =>
    this.hasParameters()
      ? resolveHttpParameters(this.parameters(), {
          typed: this.typedValues(),
          row: this.rowBinding(),
          board: this.boardValues(),
          bag: this.bagEntries(),
          rowColumns: this.pickedColumns(),
        })
      : [],
  );
  protected readonly resolvedById = computed(
    () => new Map(this.resolved().map((r) => [r.id, r])),
  );
  /** The first reason the run is blocked by a parameter value. */
  protected readonly valueProblem = computed(
    () => this.resolved().find((r) => r.error)?.error,
  );
  /** The resolved request with credential header values masked (REQ:preview). */
  protected readonly preview = computed(() => {
    if (!this.hasParameters() || this.templateProblem() || this.valueProblem()) return undefined;
    try {
      const out = substituteHttpTemplate(this.template(), this.parameters(), this.runValues());
      const sources = new Map(this.resolved().map((r) => [r.id, r.source]));
      const parts = substituteHttpTemplateParts(
        this.template(),
        this.parameters(),
        this.runValues(),
      );
      const segs = (list: readonly HttpSubstitutedPart[]): PreviewSegment[] =>
        list.map((part) => {
          const source = part.name ? sources.get(part.name) : undefined;
          return {
            text: part.text,
            ...(part.name ? { id: part.name } : {}),
            ...(source ? { source } : {}),
          };
        });
      return {
        url: out.url,
        urlSegments: segs(parts.url),
        headers: (out.headers ?? []).map((h, i) => ({
          name: h.name,
          value: isCredentialHttpHeader(h.name) ? '••••••' : h.value,
          segments: isCredentialHttpHeader(h.name)
            ? [{ text: '••••••' }]
            : segs(parts.headers[i] ?? []),
        })),
        body: out.body,
        bodySegments:
          parts.body !== undefined ? segs(parts.body) : undefined,
      };
    } catch (e) {
      return { error: e instanceof HttpTemplateError ? e.message : String(e) };
    }
  });
  private readonly runValues = computed<Record<string, string>>(() =>
    Object.fromEntries(
      this.resolved()
        .filter((r) => r.rendered !== undefined)
        .map((r) => [r.id, r.rendered as string]),
    ),
  );

  protected readonly structured = computed(() => {
    const parsed = this.bodyJson()?.parsed;
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  });

  constructor() {
    addIcons({
      addOutline,
      closeOutline,
      informationCircleOutline,
      lockClosedOutline,
      playCircleOutline,
      warningOutline,
    });
  }

  protected segmentLabel(s: PreviewSegment): string {
    return s.source ? this.sourceLabel[s.source] : '';
  }

  protected segmentTitle(s: PreviewSegment): string {
    return s.id ? this.braced(s.id) + ' from ' + this.segmentLabel(s) : '';
  }

  protected braced(id: string): string {
    return '{' + id + '}';
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

  // Parameters (declarations are saved; typed values are for this run only)

  private emitParameters(params: IParameterDef[]): void {
    this.parametersChange.emit(params);
  }

  protected declare(id: string): void {
    if (this.parameters().some((p) => p.id === id)) return;
    this.emitParameters([
      ...this.parameters(),
      {
        id,
        type: 'string',
        isRequired: true,
        ...(this.credentialIds().has(id) ? { isCredential: true } : {}),
      },
    ]);
  }

  protected declareAll(): void {
    for (const id of this.undeclared()) this.declare(id);
  }

  protected removeParameter(id: string): void {
    this.emitParameters(this.parameters().filter((p) => p.id !== id));
    const rest = { ...this.typedValues() };
    delete rest[id];
    this.typedValues.set(rest);
  }

  protected updateParameter(id: string, patch: Partial<IParameterDef>): void {
    this.emitParameters(
      this.parameters().map((p) => {
        if (p.id !== id) return p;
        const next: Record<string, unknown> = { ...p, ...patch };
        for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
        return next as unknown as IParameterDef;
      }),
    );
  }

  protected setParameterType(id: string, event: Event): void {
    const type = eventText(event) as DataType;
    const p = this.parameters().find((x) => x.id === id);
    if (!type || !p || p.type === type) return;
    // A default typed for the old type would no longer match.
    this.updateParameter(id, { type, defaultValue: undefined });
  }

  protected setRequired(id: string, event: Event): void {
    const checked = !!(event as CustomEvent<{ checked?: boolean }>).detail?.checked;
    this.updateParameter(id, { isRequired: checked });
  }

  protected setCredential(id: string, event: Event): void {
    const checked = !!(event as CustomEvent<{ checked?: boolean }>).detail?.checked;
    this.updateParameter(
      id,
      checked
        ? { isCredential: true, isRequired: true, defaultValue: undefined, meta: undefined }
        : { isCredential: undefined },
    );
  }

  protected defaultText(p: IParameterDef): string {
    return p.defaultValue === undefined ? '' : String(p.defaultValue);
  }

  protected setDefault(id: string, event: Event): void {
    const p = this.parameters().find((x) => x.id === id);
    if (!p) return;
    const text = eventText(event);
    this.updateParameter(id, { defaultValue: parseDefault(p.type, text) });
  }

  protected metaText(p: IParameterDef): string {
    return p.meta ? `${p.meta.entity}.${p.meta.field}` : '';
  }

  protected setMeta(id: string, event: Event): void {
    const text = eventText(event).trim();
    const dot = text.lastIndexOf('.');
    this.updateParameter(id, {
      meta:
        text === ''
          ? undefined
          : { entity: dot < 0 ? text : text.slice(0, dot), field: dot < 0 ? '' : text.slice(dot + 1) },
    });
  }

  protected setTypedValue(id: string, event: Event): void {
    this.typedValues.set({ ...this.typedValues(), [id]: eventText(event) });
  }

  /** The value shown under a parameter: where it came from and what will be sent. */
  protected valueHint(p: IParameterDef): string {
    const r = this.resolvedById().get(p.id);
    // A typed value is already in its field; a credential is never echoed.
    if (!r?.source || r.source === 'typed' || p.isCredential) return '';
    const value = r.rendered ?? String(r.value);
    return r.source === 'row' && r.column ? `${r.column} = ${value}` : value;
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
      const result = await this.runService.run(this.request(), via, this.runTemplate());
      this.result.set(result);
    } catch (e) {
      this.result.set(undefined);
      this.runError.set(e instanceof Error ? e.message : 'The run failed.');
      this.offerServerRun.set(e instanceof BrowserFetchFailedError);
    } finally {
      this.running.set(false);
    }
  }

  private runTemplate(): IHttpRunTemplate | undefined {
    if (!this.hasParameters()) return undefined;
    return {
      parameters: this.parameters(),
      values: this.runValues(),
      record: httpRunParameterRecord(this.parameters(), this.resolved()),
    };
  }

  protected runViaServer(): Promise<void> {
    return this.run('server');
  }
}
