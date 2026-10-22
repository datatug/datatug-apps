import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ABSOLUTE_URL_MESSAGE,
  httpMethodAllowsBody,
  isAbsoluteHttpUrl,
} from '../../http-request-rules';
import { DatatugApiService } from '../../../services/base/datatug-api.service';
import type {
  IHttpHeader,
  IHttpQueryRequest,
} from '../../../models/definition/query-def';
import { httpTemplateMessage } from '../../http-template-message';
import {
  httpTemplatePlaceholders,
  substituteHttpTemplate,
  type HttpParameterDecl,
} from '../../http-template';
import type { HttpRunParameterRecord } from '../../http-parameter-binding';

/**
 * The declared parameters of a parameterised HTTP query and the resolved,
 * coerced value of each for this run (http-query-parameters REQ:substitution-location).
 */
export interface IHttpRunTemplate {
  readonly parameters: readonly (HttpParameterDecl & { readonly type: string })[];
  readonly values: Readonly<Record<string, string>>;
  /** What history keeps of the run's parameters: no credential values. */
  readonly record?: readonly HttpRunParameterRecord[];
}

export type HttpRunVia = 'browser' | 'server';

export interface IHttpRunResult {
  readonly via: HttpRunVia;
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly IHttpHeader[];
  /** Decoded body text; undefined when the body is binary. */
  readonly bodyText?: string;
  readonly truncated: boolean;
  readonly sizeBytes: number;
  readonly durationMs: number;
  /** Parameter ids, sources and non-credential values of a parameterised run. */
  readonly parameters?: readonly HttpRunParameterRecord[];
}

/** The fetch call failed before any response (network error, CORS block, abort). */
export class BrowserFetchFailedError extends Error {
  constructor(cause: unknown) {
    super(
      'The browser could not complete this request. The API most likely blocks browser calls (CORS), or the connection dropped.',
      { cause },
    );
  }
}

/** The DataTug server could not run the request (blocked target, upstream failure, auth). */
export class ServerRunFailedError extends Error {}

interface IServerRunResponse {
  status: number;
  statusText?: string;
  headers?: IHttpHeader[];
  body?: string;
  bodyEncoding?: 'utf8' | 'base64';
  truncated?: boolean;
  sizeBytes?: number;
  durationMs?: number;
}

/** Only POST, PUT, PATCH and DELETE carry a body; GET, HEAD and OPTIONS do not. */
export function methodTakesBody(method: string | undefined): boolean {
  return httpMethodAllowsBody(method);
}

function assertRunnableUrl(url: string): void {
  if (!isAbsoluteHttpUrl(url))
    throw new ServerRunFailedError(ABSOLUTE_URL_MESSAGE);
}

function runnableHeaders(request: IHttpQueryRequest): IHttpHeader[] {
  return (request.headers ?? [])
    .filter((h) => h.name.trim() !== '')
    .map((h) => ({ name: h.name.trim(), value: h.value }));
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function base64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function serverErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as
      | {
          error?:
            | {
                message?: string;
                code?: string;
                templateCode?: string;
                parameter?: string;
                position?: string;
                header?: string;
              }
            | string;
          message?: string;
        }
      | string
      | null;
    if (typeof body === 'string' && body) return body;
    if (body && typeof body === 'object') {
      const nested = body.error;
      // A template problem arrives as fields; the words are written here.
      if (nested && typeof nested === 'object' && nested.code === 'http_template')
        return httpTemplateMessage(
          nested.templateCode ?? '',
          nested.parameter,
          nested.position,
          nested.header,
        );
      if (typeof nested === 'string' && nested) return nested;
      if (nested && typeof nested === 'object' && nested.message)
        return nested.message;
      if (body.message) return body.message;
    }
    return `DataTug server error (${error.status || 'no response'}).`;
  }
  return error instanceof Error ? error.message : 'DataTug server error.';
}

function templateOf(request: IHttpQueryRequest) {
  const method = (request.method ?? 'GET').toUpperCase();
  return {
    method,
    url: request.url,
    headers: runnableHeaders(request),
    body: methodTakesBody(method) ? (request.body ?? '') : '',
  };
}

/** The request with every placeholder substituted (the browser run). Throws a ServerRunFailedError naming the parameter. */
export function substitutedRequest(
  request: IHttpQueryRequest,
  template: IHttpRunTemplate,
): IHttpQueryRequest {
  try {
    const out = substituteHttpTemplate(
      templateOf(request),
      template.parameters,
      template.values,
    );
    return {
      ...request,
      url: out.url,
      headers: out.headers ?? [],
      ...(out.body !== undefined ? { body: out.body } : {}),
    };
  } catch (e) {
    throw new ServerRunFailedError(e instanceof Error ? e.message : 'The request template is not valid.');
  }
}

/** Template-mode parameters: only those the sent request uses, with their coerced text. */
function serverParameters(
  runRequest: ReturnType<typeof templateOf>,
  template: IHttpRunTemplate,
): { id: string; type: string; value: string }[] {
  const used = new Set(httpTemplatePlaceholders(runRequest).map((p) => p.name));
  return template.parameters
    .filter((p) => used.has(p.id))
    .map((p) => ({ id: p.id, type: p.type, value: template.values[p.id] ?? '' }));
}

/**
 * Runs an HTTP query either from the browser (`fetch`) or through the DataTug
 * server proxy (`POST datatug/http/run`). Run headers may carry credentials:
 * they are sent, never stored or logged here.
 */
@Injectable({ providedIn: 'root' })
export class HttpRunService {
  private readonly api = inject(DatatugApiService);

  async run(
    request: IHttpQueryRequest,
    via: HttpRunVia,
    template?: IHttpRunTemplate,
  ): Promise<IHttpRunResult> {
    const result =
      via === 'server'
        ? await this.runViaServer(request, template)
        : await this.runViaBrowser(
            template ? substitutedRequest(request, template) : request,
          );
    return template?.record ? { ...result, parameters: template.record } : result;
  }

  async runViaBrowser(request: IHttpQueryRequest): Promise<IHttpRunResult> {
    assertRunnableUrl(request.url);
    const method = (request.method ?? 'GET').toUpperCase();
    const headers = new Headers();
    try {
      for (const h of runnableHeaders(request)) headers.append(h.name, h.value);
    } catch (e) {
      throw new ServerRunFailedError(
        e instanceof Error ? e.message : 'Invalid header.',
      );
    }
    const started = performance.now();
    let response: Response;
    let bytes: Uint8Array;
    try {
      response = await fetch(request.url.trim(), {
        method,
        headers,
        ...(methodTakesBody(method) && request.body
          ? { body: request.body }
          : {}),
      });
      // A failure mid-body (dropped connection) is as retryable via the server as a CORS block.
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (e) {
      throw new BrowserFetchFailedError(e);
    }
    const respHeaders: IHttpHeader[] = [];
    response.headers.forEach((value, name) =>
      respHeaders.push({ name, value }),
    );
    return {
      via: 'browser',
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      bodyText: decodeUtf8(bytes),
      truncated: false,
      sizeBytes: bytes.byteLength,
      durationMs: Math.round(performance.now() - started),
    };
  }

  /**
   * Runs through the DataTug server. A parameterised request goes in template
   * mode: the server substitutes it itself and checks the FINAL URL.
   */
  async runViaServer(
    request: IHttpQueryRequest,
    template?: IHttpRunTemplate,
  ): Promise<IHttpRunResult> {
    if (template) assertRunnableUrl(substitutedRequest(request, template).url);
    else assertRunnableUrl(request.url);
    const method = (request.method ?? 'GET').toUpperCase();
    const runRequest = {
      method,
      url: request.url.trim(),
      headers: runnableHeaders(request),
      body: methodTakesBody(method) ? (request.body ?? '') : '',
    };
    let response: IServerRunResponse;
    try {
      response = await firstValueFrom(
        this.api.post<IServerRunResponse>(
          'datatug/http/run',
          template
            ? { ...runRequest, parameters: serverParameters(runRequest, template) }
            : runRequest,
        ),
      );
    } catch (e) {
      throw new ServerRunFailedError(serverErrorMessage(e));
    }
    const rawBody = response.body ?? '';
    const bytes =
      response.bodyEncoding === 'base64' ? base64ToBytes(rawBody) : undefined;
    return {
      via: 'server',
      status: response.status,
      statusText: response.statusText ?? '',
      headers: response.headers ?? [],
      bodyText: bytes ? decodeUtf8(bytes) : rawBody,
      truncated: !!response.truncated,
      sizeBytes:
        response.sizeBytes ??
        bytes?.byteLength ??
        new TextEncoder().encode(rawBody).byteLength,
      durationMs: response.durationMs ?? 0,
    };
  }
}
