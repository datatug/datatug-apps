import { Injectable, inject } from '@angular/core';
import { ISneatApiService, SneatApiService } from '@sneat/api';
import { Observable } from 'rxjs';

export const DEMO_DB_IDS = [
  'chinook',
  'northwind',
  'pubs',
  'sakila',
  'adventureworks',
  'employees',
] as const;

export type DemoDbId = (typeof DEMO_DB_IDS)[number];
export type SandboxSqlArgument = string | number | boolean | null;

export interface WritableSandboxInfo {
  readonly databases: readonly DemoDbId[];
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly idleExpiresAt: string;
  readonly sampleDatabaseBytes: number;
  readonly sampleGrowthLimitBytes: number;
  readonly branchLogicalBytes: number;
}

export interface SandboxQueryRequest {
  readonly database: DemoDbId;
  readonly sql: string;
  readonly args: readonly SandboxSqlArgument[];
}

export interface SandboxQueryResult {
  readonly columns: readonly {
    readonly name: string;
    readonly typeOid: number;
  }[];
  readonly rows: readonly (readonly unknown[])[];
  readonly command: string;
}

/** Authenticated client for the private, per-user OpenVaultDB sandbox API. */
@Injectable({ providedIn: 'root' })
export class DemoDbSandboxService {
  private readonly api: ISneatApiService = inject(SneatApiService);

  get(): Observable<WritableSandboxInfo> {
    return this.api.get<WritableSandboxInfo>('ovdb/sandbox');
  }

  create(requestId: string): Observable<WritableSandboxInfo> {
    return this.api.post<{ requestId: string }, WritableSandboxInfo>(
      'ovdb/sandbox',
      { requestId },
    );
  }

  delete(): Observable<Record<string, never>> {
    return this.api.delete<Record<string, never>>('ovdb/sandbox');
  }

  query(request: SandboxQueryRequest): Observable<SandboxQueryResult> {
    return this.api.post<SandboxQueryRequest, SandboxQueryResult>(
      'ovdb/sandbox/query',
      request,
    );
  }
}
