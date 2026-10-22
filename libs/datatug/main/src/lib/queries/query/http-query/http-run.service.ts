import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DatatugApiService } from '../../../services/base/datatug-api.service';
import type {
  IHttpHeader,
  IHttpQueryRequest,
} from '../../../models/definition/query-def';

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
}

/** The fetch call failed before any response (network error, CORS block, abort). */
export class BrowserFetchFailedError extends Error {
  constructor(cause: unknown) {
    super(
      'The browser could not reach this URL. The API most likely blocks browser calls (CORS).',
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

/** Methods that carry no request body. */
const NO_BODY_METHODS = ['GET', 'HEAD'];

export function methodTakesBody(method: string | undefined): boolean {
  return !NO_BODY_METHODS.includes((method ?? 'GET').toUpperCase());
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
      | { error?: { message?: string } | string; message?: string }
      | string
      | null;
    if (typeof body === 'string' && body) return body;
    if (body && typeof body === 'object') {
      const nested = body.error;
      if (typeof nested === 'string' && nested) return nested;
      if (nested && typeof nested === 'object' && nested.message)
        return nested.message;
      if (body.message) return body.message;
    }
    return `DataTug server error (${error.status || 'no response'}).`;
  }
  return error instanceof Error ? error.message : 'DataTug server error.';
}

/**
 * Runs an HTTP query either from the browser (`fetch`) or through the DataTug
 * server proxy (`POST datatug/http/run`). Run headers may carry credentials:
 * they are sent, never stored or logged here.
 */
@Injectable({ providedIn: 'root' })
export class HttpRunService {
  private readonly api = inject(DatatugApiService);

  run(request: IHttpQueryRequest, via: HttpRunVia): Promise<IHttpRunResult> {
    return via === 'server'
      ? this.runViaServer(request)
      : this.runViaBrowser(request);
  }

  async runViaBrowser(request: IHttpQueryRequest): Promise<IHttpRunResult> {
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
    try {
      response = await fetch(request.url, {
        method,
        headers,
        ...(methodTakesBody(method) && request.body
          ? { body: request.body }
          : {}),
      });
    } catch (e) {
      throw new BrowserFetchFailedError(e);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const respHeaders: IHttpHeader[] = [];
    response.headers.forEach((value, name) => respHeaders.push({ name, value }));
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

  async runViaServer(request: IHttpQueryRequest): Promise<IHttpRunResult> {
    const method = (request.method ?? 'GET').toUpperCase();
    let response: IServerRunResponse;
    try {
      response = await firstValueFrom(
        this.api.post<IServerRunResponse>('datatug/http/run', {
          method,
          url: request.url,
          headers: runnableHeaders(request),
          body: methodTakesBody(method) ? (request.body ?? '') : '',
        }),
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
        response.sizeBytes ?? bytes?.byteLength ?? new TextEncoder().encode(rawBody).byteLength,
      durationMs: response.durationMs ?? 0,
    };
  }
}
