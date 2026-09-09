import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable, throwError } from 'rxjs';
import { getAgentSessionToken } from './agent-session';
import {
  AuthorizationResult,
  EvidenceResponse,
  OpenVaultQueryResponse,
  OpenVaultTargetsResponse,
  UpdateResponse,
  isAuthorizationResult,
  isUpdateResponse,
} from './openvaultdb.models';

@Injectable({ providedIn: 'root' })
export class OpenVaultDBAgentService {
  private readonly http = inject(HttpClient);

  targets(agentId: string): Observable<OpenVaultTargetsResponse> {
    return this.post(agentId, 'targets', {});
  }

  query(
    agentId: string,
    target: string,
    dtql: string,
  ): Observable<OpenVaultQueryResponse> {
    return this.post(agentId, 'query', { target, dtql });
  }

  explain(
    agentId: string,
    target: string,
    request: unknown,
  ): Observable<AuthorizationResult> {
    return this.post<unknown>(agentId, 'explain', { target, request }).pipe(
      map((value) => requireResponse(value, isAuthorizationResult)),
    );
  }

  evidence(
    agentId: string,
    target: string,
    request: unknown,
  ): Observable<EvidenceResponse> {
    return this.post(agentId, 'evidence', { target, request });
  }

  update(
    agentId: string,
    target: string,
    request: unknown,
  ): Observable<UpdateResponse> {
    return this.post<unknown>(agentId, 'update', { target, request }).pipe(
      map((value) => requireResponse(value, isUpdateResponse)),
    );
  }

  private post<T>(
    agentId: string,
    operation: string,
    body: unknown,
  ): Observable<T> {
    const token = getAgentSessionToken();
    const origin = loopbackAgentOrigin(agentId);
    if (!token || !origin) {
      return throwError(
        () => new Error('Protected local agent session is unavailable'),
      );
    }
    return this.http.post<T>(`${origin}/datatug/ovdb/${operation}`, body, {
      headers: new HttpHeaders({ 'X-Datatug-Agent-Token': token }),
    });
  }
}

function requireResponse<T>(
  value: unknown,
  validator: (value: unknown) => value is T,
): T {
  if (!validator(value)) {
    throw new Error('The local agent returned an invalid response.');
  }
  return value;
}

export function loopbackAgentOrigin(agentId: string): string | undefined {
  if (
    !/^[A-Za-z0-9.:[\]-]+$/.test(agentId) ||
    agentId.includes('@') ||
    agentId.includes('/')
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(`http://${agentId}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}
