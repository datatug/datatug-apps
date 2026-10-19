import { Injectable, inject } from '@angular/core';
import { DatatugApiService } from '../../../services/base/datatug-api.service';

export interface GoogleLogGrant {
  readonly id: string;
  readonly email: string;
  readonly state: 'active' | 'revocation_pending' | 'retired';
}

export interface PersonalLogConnection {
  readonly id: string;
  readonly grantId: string;
  readonly projectId: string;
  readonly logViewId: string;
  readonly active: boolean;
}

export interface PersonalLogConnections {
  readonly grants: readonly GoogleLogGrant[];
  readonly connections: readonly PersonalLogConnection[];
}

export interface PersonalLogEntry {
  readonly timestamp?: string;
  readonly severity: string;
  readonly source: string;
  readonly message: string;
  readonly service?: string;
  readonly correlationId?: string;
  readonly orderId?: string;
  readonly traceId?: string;
  readonly parseStatus?: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly raw?: unknown;
  readonly sourceRef?: string;
}

export interface PersonalLogQuery {
  readonly connectionId: string;
  readonly from: string;
  readonly to: string;
  readonly severity?: string;
  readonly correlationId?: string;
  readonly orderId?: string;
  readonly service?: string;
}

export interface PersonalLogQueryResult {
  readonly entries: readonly PersonalLogEntry[];
  readonly capped: boolean;
  readonly morePossible: boolean;
}

export type PersonalLogDisconnectResult =
  | { readonly state: 'revocation_pending' }
  | { readonly state: 'retired'; readonly revocationConfirmed: boolean };

export type PersonalLogErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'not_found'
  | 'account_unavailable'
  | 'reconnect_required'
  | 'permission_denied'
  | 'unsupported_query'
  | 'throttled'
  | 'unavailable';

export interface GoogleLogAuthorizationStart {
  readonly authorizationUrl: string;
  readonly finishKey: string;
}

const endpoint = 'datatug/me';

@Injectable({ providedIn: 'root' })
export class CloudLogsApiService {
  private readonly api = inject(DatatugApiService);

  startGoogleAuthorization() {
    return this.api.post<GoogleLogAuthorizationStart>(
      `${endpoint}/google-log-grants/oauth/start`,
      {},
    );
  }

  finishGoogleAuthorization(request: { receipt: string; finishKey: string }) {
    return this.api.post<GoogleLogGrant>(
      `${endpoint}/google-log-grants/oauth/finish`,
      request,
    );
  }

  list() {
    return this.api.get<PersonalLogConnections>(`${endpoint}/log-connections`);
  }

  connect(request: { grantId: string; projectId: string; logViewId: string }) {
    return this.api.post<PersonalLogConnection>(
      `${endpoint}/log-connections`,
      request,
    );
  }

  remove(connectionId: string) {
    return this.api.post<{ removed: true }>(
      `${endpoint}/log-connections/remove`,
      { connectionId },
    );
  }

  disconnect(grantId: string) {
    return this.api.post<PersonalLogDisconnectResult>(
      `${endpoint}/google-log-grants/disconnect`,
      { grantId, confirm: true },
    );
  }

  query(request: PersonalLogQuery) {
    return this.api.post<PersonalLogQueryResult>(
      `${endpoint}/log-connections/query`,
      request,
    );
  }
}
