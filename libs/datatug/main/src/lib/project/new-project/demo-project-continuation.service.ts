import { Injectable } from '@angular/core';
import { findDemoSqliteDataset } from '../../queries/demo-sqlite-catalog';
import { equalProjectRef, type IProjectRef } from '../../core/project-context';
import type { QueryConnectionDescriptor } from '../../queries/query-dispatch';
import { readGithubProjectCopySource, type GithubProjectCopySource } from './github-project-copy-source';

export interface DemoProjectContinuation {
  readonly dataset: string;
  readonly canonicalSha256: string;
  readonly table?: string;
  readonly source: GithubProjectCopySource;
  readonly actorID?: string;
  readonly operationID?: string;
  readonly destination?: IProjectRef;
}
const prefix = 'datatug:demo-continuation:';
export const validContinuationToken = (token: unknown): token is string => typeof token === 'string' && /^[a-f0-9-]{36}$/.test(token);

export function readDemoProjectContinuation(value: unknown): DemoProjectContinuation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Partial<DemoProjectContinuation>;
  const entry = findDemoSqliteDataset(v.dataset);
  const source = readGithubProjectCopySource(v.source);
  if (!entry || !source || !/^[a-f0-9]{64}$/.test(v.canonicalSha256 ?? '') ||
    (v.table !== undefined && (typeof v.table !== 'string' || !v.table || v.table.length > 256)) ||
    (v.actorID !== undefined && (typeof v.actorID !== 'string' || v.actorID.length > 128)) ||
    (v.operationID !== undefined && (typeof v.operationID !== 'string' || v.operationID.length > 128))) return undefined;
  const destination = v.destination;
  if (destination && (destination.storeId !== 'github.com' || destination.projectApi !== 'cloud' ||
    typeof destination.projectId !== 'string' || !destination.projectId || typeof destination.branch !== 'string' || !destination.branch)) return undefined;
  return { dataset: entry.dataset, canonicalSha256: v.canonicalSha256 as string, source,
    ...(v.table ? { table: v.table } : {}), ...(v.actorID ? { actorID: v.actorID } : {}),
    ...(v.operationID ? { operationID: v.operationID } : {}), ...(destination ? { destination } : {}) };
}

export function matchingDemoConnection(continuation: DemoProjectContinuation, connections: readonly QueryConnectionDescriptor[]): QueryConnectionDescriptor {
  const matches = connections.filter(c => c.dataset === continuation.dataset && c.fixtureSha256 === continuation.canonicalSha256 && c.storage === 'sqlite');
  if (matches.length !== 1 || !matches[0].id) throw new Error('This copied project has no unique SQLite connection matching your edited database version. Return to the demo to keep your edits.');
  return matches[0];
}

/** Browser-only continuation: never include this record in a project API request. */
@Injectable({ providedIn: 'root' })
export class DemoProjectContinuationService {
  private readonly records = new Map<string, DemoProjectContinuation>();
  create(value: DemoProjectContinuation): string {
    const record = readDemoProjectContinuation(value);
    if (!record) throw new Error('The demo continuation could not be verified.');
    const token = crypto.randomUUID();
    this.write(token, record);
    return token;
  }
  read(token: string | undefined): DemoProjectContinuation | undefined {
    if (!validContinuationToken(token)) return undefined;
    const cached = this.records.get(token);
    if (cached) return cached;
    try {
      const raw = sessionStorage.getItem(prefix + token);
      return raw && raw.length < 8192 ? readDemoProjectContinuation(JSON.parse(raw)) : undefined;
    } catch { return undefined; }
  }
  bind(token: string, actorID: string, source: GithubProjectCopySource, operationID?: string, destination?: IProjectRef): DemoProjectContinuation | undefined {
    const record = this.read(token);
    if (!record || !actorID || (record.actorID && record.actorID !== actorID) ||
      JSON.stringify(record.source) !== JSON.stringify(readGithubProjectCopySource(source)) ||
      (record.operationID && operationID && record.operationID !== operationID) ||
      (record.destination && destination && !equalProjectRef(record.destination, destination))) return undefined;
    const bound = { ...record, actorID, ...(operationID ? { operationID } : {}), ...(destination ? { destination } : {}) };
    this.write(token, bound);
    return bound;
  }
  restart(token: string, actorID: string, operationID: string): void {
    const record = this.read(token);
    if (!record || record.actorID !== actorID || record.operationID !== operationID || record.destination) return;
    const { operationID: _operation, ...continued } = record;
    void _operation;
    this.write(token, continued);
  }
  find(actorID: string, operationID: string, source?: GithubProjectCopySource): string | undefined {
    const tokens = new Set(this.records.keys());
    try {
      for (let i = 0; i < Math.min(sessionStorage.length, 200); i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(prefix)) tokens.add(key.slice(prefix.length));
      }
    } catch { /* memory-only recovery remains available */ }
    return [...tokens].find(token => {
      const record = this.read(token);
      return record?.actorID === actorID && record.operationID === operationID &&
        !!source && JSON.stringify(record.source) === JSON.stringify(readGithubProjectCopySource(source));
    });
  }
  private write(token: string, record: DemoProjectContinuation): void {
    this.records.set(token, record);
    try { sessionStorage.setItem(prefix + token, JSON.stringify(record)); } catch { /* Keep this page open for memory-only continuation. */ }
  }
}
