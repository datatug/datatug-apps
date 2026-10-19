import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { equalProjectRef, type IProjectRef } from '../core/project-context';
import { QueryType, type IQueryDef, type ITextQueryRequest } from '../models/definition/query-def';
import { ovdbCollections } from '../ovdb/ovdb-connection';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import type { QueryConnectionDescriptor } from './query-dispatch';
import { QueryRuntimeRegistry } from './query-runtime-registry.service';

interface DemoTableDraft {
  readonly actorID: string;
  readonly projectRef: IProjectRef;
  readonly connection: QueryConnectionDescriptor;
  readonly table: string;
  readonly runtimeSelectionId: string;
  readonly environment: string;
}
@Injectable({ providedIn: 'root' })
export class DemoTableDraftService {
  private readonly drafts = new Map<string, DemoTableDraft>();
  private readonly api = inject(ProjectQueryApiService);
  private readonly runtimes = inject(QueryRuntimeRegistry);
  create(draft: DemoTableDraft): string {
    const token = crypto.randomUUID();
    this.drafts.set(token, structuredClone(draft));
    return token;
  }
  /** Consume only after the current authenticated page applies the draft; failed reads remain retriable. */
  consume(token: string): void { this.drafts.delete(token); }
  async read(token: string, ref: IProjectRef, runtime: string | null, environment: string | null, actorID: string): Promise<IQueryDef> {
    const draft = this.drafts.get(token);
    if (!draft || !actorID || draft.actorID !== actorID || !equalProjectRef(draft.projectRef, ref) || draft.runtimeSelectionId !== runtime || draft.environment !== environment) throw new Error('The table draft is unavailable in this tab or project. Return to your browser database and choose Query this table again.');
    const catalog = await firstValueFrom(this.api.connectionCatalog<{ connections: readonly QueryConnectionDescriptor[] }>(ref));
    const matches = catalog.connections.filter(c => c.id === draft.connection.id && c.dataset === draft.connection.dataset && c.fixtureSha256 === draft.connection.fixtureSha256 && c.storage === 'sqlite');
    const declaration = matches.length === 1 ? matches[0] : undefined;
    const connection = declaration && this.runtimes.resolve(draft.runtimeSelectionId, declaration);
    const environments = declaration?.environment ? [declaration.environment] : declaration?.environments ?? [];
    if (!connection || !environments.includes(draft.environment) || !ovdbCollections(connection.descriptor).includes(draft.table) || !connection.descriptor.capabilities.dtql) throw new Error('The copied project or edited database changed. Return to your browser database and check its connection before querying.');
    return { id: '', title: `${draft.table} (browser copy)`, connectionId: declaration?.id,
      request: { queryType: QueryType.DTQL, text: `from:\n  name: ${JSON.stringify(draft.table)}\nlimit: 100\n` } as ITextQueryRequest };
  }
}
