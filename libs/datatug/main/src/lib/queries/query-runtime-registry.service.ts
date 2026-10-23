import { Injectable, signal } from '@angular/core';
import type { OvdbConnection } from '../ovdb/ovdb-connection';
import type { QueryConnectionDescriptor } from './query-dispatch';

export interface RegisteredQueryRuntime {
  readonly selectionId: string;
  readonly title: string;
  readonly connection: OvdbConnection;
}

export type QueryRuntimeOption = Pick<RegisteredQueryRuntime, 'selectionId' | 'title'>;

/** Live, provider-owned browser runtimes. Catalog metadata declares identity, never authority. */
@Injectable({ providedIn: 'root' })
export class QueryRuntimeRegistry {
  private readonly entries = new Map<string, RegisteredQueryRuntime>();
  readonly revision = signal(0);

  register(connection: OvdbConnection): { readonly selectionId: string; update(connection: OvdbConnection): void; dispose(): void } {
    // A URL can outlive this page. Never let a new registry reuse an old URL's ID.
    const selectionId = `runtime-${crypto.randomUUID()}`;
    const publish = (current: OvdbConnection): void => {
      this.entries.set(selectionId, { selectionId, title: current.title, connection: current });
      this.revision.update((value) => value + 1);
    };
    publish(connection);
    return {
      selectionId,
      update: (current) => { if (this.entries.has(selectionId)) publish(current); },
      dispose: () => { if (this.entries.delete(selectionId)) this.revision.update((value) => value + 1); },
    };
  }

  candidates(declaration: QueryConnectionDescriptor): readonly RegisteredQueryRuntime[] {
    const sha = declaration.fixtureSha256;
    if (!sha || !/^[a-f0-9]{64}$/u.test(sha)) return [];
    return [...this.entries.values()].filter(({ connection }) =>
      connection.descriptor.canonical?.sha256 === sha &&
      (connection.descriptor.capabilities.query === true || connection.descriptor.capabilities.tugql === true));
  }

  resolve(selectionId: string, declaration: QueryConnectionDescriptor): OvdbConnection | undefined {
    return this.candidates(declaration).find((entry) => entry.selectionId === selectionId)?.connection;
  }
}
