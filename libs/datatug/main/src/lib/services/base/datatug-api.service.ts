import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { SneatApiAuthTokenBridge, SneatApiService } from '@sneat/api';
import { SneatUrlOperationBlocker } from '@sneat/core-public';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';

/**
 * Client for the DataTug API. It inherits the Sneat token bridge, the Bearer
 * header and the 401 refresh from `SneatApiService`, and differs only in the
 * base URL it is given (`DatatugApiBaseUrl`, which mirrors `SneatApiBaseUrl`).
 *
 * Decorators are not inherited, so this class declares its own `@Injectable`
 * and constructor.
 */
@Injectable({ providedIn: 'root' })
export class DatatugApiService extends SneatApiService {
  constructor() {
    super(
      inject(HttpClient),
      inject(SneatApiAuthTokenBridge),
      inject(DatatugApiBaseUrl),
      inject(SneatUrlOperationBlocker),
    );
  }
}
