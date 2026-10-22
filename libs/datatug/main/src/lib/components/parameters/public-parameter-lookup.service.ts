import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SneatAuthStateService } from '@sneat/auth-core';
import { firstValueFrom, of } from 'rxjs';
import type { TypedValue } from '@sneat/datatug-semantic';
import type { IProjectRef } from '../../core/project-context';
import type { IParameterDef } from '../../models/definition/parameter';
import { QueryType, type IQueryDef, type ITextQueryRequest } from '../../models/definition/query-def';
import { QueryDispatchService } from '../../queries/query-dispatch.service';
import { BrowserSqliteSession } from '../../queries/browser-sqlite-query.service';
import { serverOwnsSourceAdmission, type QueryConnectionDescriptor } from '../../queries/query-dispatch';
import { ProjectAssetsReadService } from '../../services/project/project-assets-read.service';
import {
  LOOKUP_PAGE_SIZE,
  LOOKUP_SCHEMA_SQL,
  columnKeyKind,
  humanizeName,
  isScalarLookupParameter,
  lookupCandidates,
  lookupConnection,
  lookupDisplayColumns,
  lookupEnvironment,
  lookupRowsSql,
  orderCandidates,
  parameterAcceptsKey,
  resolveParameterMeaning,
  type LookupCandidate,
  type LookupColumn,
  type LookupEntity,
  type ParameterMeaning,
} from './parameter-lookup-model';
import type {
  ParameterLookupContext,
  ParameterLookupPage,
  ParameterLookupProvider,
} from './parameter-lookup-provider';

/** An eligible candidate bound to the browser-runnable connection that will read it. */
export interface PublicLookupSource extends LookupCandidate {
  readonly id: string;
  /** The meaning the source was resolved through: declared `meta`, or inferred from the name. */
  readonly meaning: ParameterMeaning;
  readonly connection: QueryConnectionDescriptor;
  readonly environment?: string;
}

interface SchemaProbe {
  readonly columns: readonly LookupColumn[];
  readonly primaryKey: readonly string[];
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function abortError(): Error {
  const error = new Error('The lookup was cancelled.');
  error.name = 'AbortError';
  return error;
}

function refKey(ref: IProjectRef): string {
  return JSON.stringify([ref.storeId, ref.projectId, ref.spaceID ?? '', ref.projectApi ?? '', ref.branch ?? '']);
}

/** Only public projects read in the browser take this path; agents and hosted projects need the server endpoint. */
export function isPublicBrowserProject(ref: IProjectRef | undefined): ref is IProjectRef {
  return !!ref && !serverOwnsSourceAdmission({
    projectRef: ref,
    definition: { id: '', request: { queryType: QueryType.SQL, text: '' } as ITextQueryRequest },
  });
}

/**
 * Meaning-keyed lookups for public projects (parameter-lookup
 * REQ:runtime-execution, public browser path): resolves the parameter's
 * meaning through the project's Core entity, binds each declared mapping to a
 * browser-runnable catalog connection, and reads the pinned SQLite fixture
 * through the existing query dispatcher and worker. Every identifier is
 * checked against the fixture's own catalog before it is quoted into SQL.
 */
@Injectable({ providedIn: 'root' })
export class PublicParameterLookupService {
  private readonly dispatch = inject(QueryDispatchService);
  private readonly assets = inject(ProjectAssetsReadService);
  private readonly entities = new Map<string, Promise<LookupEntity | undefined>>();
  // The guessed-columns note is for authors: anonymous visitors never see it.
  private readonly authState = toSignal(
    inject(SneatAuthStateService, { optional: true })?.authState ?? of({ status: 'notAuthenticated' as const }),
    { initialValue: undefined },
  );
  private readonly allEntities = new Map<string, Promise<readonly LookupEntity[] | undefined>>();
  private readonly catalogs = new Map<string, Promise<readonly QueryConnectionDescriptor[]>>();
  private readonly schemas = new Map<string, Promise<SchemaProbe>>();

  /**
   * The parameter's meaning (REQ:inferred-parameter-meaning): its declared
   * `meta`, else the one key field whose name patterns match its name. Only a
   * meta-less parameter reads the project's entity declarations, once per project.
   */
  async meaning(ref: IProjectRef, parameter: IParameterDef): Promise<ParameterMeaning | undefined> {
    if (parameter.meta?.entity && parameter.meta.field) return resolveParameterMeaning([], parameter);
    const entities = await this.projectEntities(ref);
    // An incomplete entity set could hide a second match and turn an ambiguous name into a guess.
    return entities ? resolveParameterMeaning(entities, parameter) : undefined;
  }

  /** The eligible sources of a parameter; empty means no pick button. Never downloads a fixture. */
  async sources(parameter: IParameterDef, context: ParameterLookupContext): Promise<PublicLookupSource[]> {
    const ref = context.projectRef;
    if (!isScalarLookupParameter(parameter) || !isPublicBrowserProject(ref)) return [];
    const meaning = await this.meaning(ref, parameter);
    if (!meaning) return [];
    const meant: IParameterDef = { ...parameter, meta: { entity: meaning.entity, field: meaning.field } };
    const [entity, catalog] = await Promise.all([this.entity(ref, meaning.entity), this.catalog(ref)]);
    const environment = context.environment ?? undefined;
    const hostSource = context.hostConnectionId
      ? catalog.find((c) => c.id === context.hostConnectionId)?.dataset ?? context.hostConnectionId
      : undefined;
    const result: PublicLookupSource[] = [];
    for (const candidate of orderCandidates(lookupCandidates(entity, meant), hostSource)) {
      const connection = lookupConnection(catalog, candidate.source, context.hostConnectionId, environment);
      if (!connection?.id) continue;
      result.push({
        ...candidate,
        id: `${candidate.source}\u0000${candidate.collection}`,
        meaning,
        connection,
        environment: lookupEnvironment(connection, environment),
      });
    }
    return result;
  }

  /** A dialog provider over already-resolved sources. */
  provider(parameter: IParameterDef, context: ParameterLookupContext, sources: readonly PublicLookupSource[], entity: LookupEntity | undefined): ParameterLookupProvider {
    const ref = context.projectRef as IProjectRef;
    // One fixture download and one SQLite worker for the whole dialog.
    const session = new BrowserSqliteSession();
    const hostSources = sources.filter((s) => !!context.hostConnectionId && s.connection.id === context.hostConnectionId);
    const preselected = sources.length === 1
      ? sources[0].id
      : hostSources.length === 1 ? hostSources[0].id : undefined;
    return {
      subject: entity?.title || parameter.meta?.entity || parameter.title || parameter.id,
      sources: sources.map((s) => ({ id: s.id, label: `${s.collection} · ${s.source}` })),
      preselectedSourceId: preselected,
      sourceNote: `${[...new Set(sources.map((s) => humanizeName(s.connection.dataset || s.source)))].join(', ')} sample, pinned · read in your browser.`,
      ...(sources[0]?.meaning.provenance === 'inferred' ? {
        meaningNote: `Meaning guessed from the name ${parameter.id}: ${sources[0].meaning.entity}.${sources[0].meaning.field}. Declare meta on this parameter to confirm it.`,
      } : {}),
      ...(sources.length > 1 ? {
        // Several mappings: keep only those whose fixture key really is the mapped column.
        prepare: async (signal: AbortSignal) => {
          const checks = await Promise.all(sources.map(async (source) => ({
            source,
            problem: this.keyProblem(parameter, source, await this.schema(ref, source, session, signal)),
          })));
          const usable = checks.filter((c) => !c.problem).map((c) => c.source);
          const preselectedUsable = usable.length === 1
            ? usable[0].id
            : usable.find((s) => s.id === preselected)?.id;
          return {
            sources: usable.map((s) => ({ id: s.id, label: `${s.collection} · ${s.source}` })),
            ...(preselectedUsable ? { preselectedSourceId: preselectedUsable } : {}),
            ...(usable.length ? {} : { unavailable: `No table can be used for this lookup: ${checks.map((c) => `${c.source.collection} ${c.problem}`).join('; ')}.` }),
          };
        },
      } : {}),
      search: (sourceId, filter, signal) => {
        const source = sources.find((s) => s.id === sourceId);
        if (!source) return Promise.reject(new Error('Unknown lookup source.'));
        return this.search(ref, parameter, entity ?? {}, source, session, filter, signal);
      },
      dispose: () => session.close(),
    };
  }

  /** The entity a meaning names, read once per project. */
  entity(ref: IProjectRef, entityId: string): Promise<LookupEntity | undefined> {
    const key = `${refKey(ref)}\u0000${entityId}`;
    let entity = this.entities.get(key);
    if (!entity) {
      entity = firstValueFrom(this.assets.entity(ref, entityId))
        .then((e): LookupEntity => e)
        .catch(() => {
          // A transient read failure must not hide the button for the whole session.
          this.entities.delete(key);
          return undefined;
        });
      this.entities.set(key, entity);
    }
    return entity;
  }

  /**
   * Every entity declaration of the project, read once per project, for
   * name-pattern inference. Undefined, and not cached, when the set is
   * incomplete: a failed listing, a failed or empty entity read, or more than
   * 100 entities. Inference then fails closed (REQ:inferred-parameter-meaning).
   */
  private projectEntities(ref: IProjectRef): Promise<readonly LookupEntity[] | undefined> {
    const key = refKey(ref);
    let all = this.allEntities.get(key);
    if (!all) {
      all = firstValueFrom(this.assets.entities(ref))
        .then(async (briefs) => {
          if (!briefs || briefs.length > 100) throw new Error('The entity set cannot be read completely.');
          const entities = await Promise.all(briefs.map((b) => this.entity(ref, b.id)));
          if (entities.some((e) => !e)) throw new Error('An entity declaration could not be read.');
          return entities as LookupEntity[];
        })
        .catch(() => {
          this.allEntities.delete(key);
          return undefined;
        });
      this.allEntities.set(key, all);
    }
    return all;
  }

  private catalog(ref: IProjectRef): Promise<readonly QueryConnectionDescriptor[]> {
    const key = refKey(ref);
    let catalog = this.catalogs.get(key);
    if (!catalog) {
      catalog = this.dispatch.connectionCatalog({ projectRef: ref }).catch(() => {
        this.catalogs.delete(key);
        return [];
      });
      this.catalogs.set(key, catalog);
    }
    return catalog;
  }

  private async run(ref: IProjectRef, source: PublicLookupSource, session: BrowserSqliteSession, sql: string, parameters: IQueryDef['parameters'], values: Record<string, TypedValue>, signal: AbortSignal) {
    const definition: IQueryDef = {
      id: 'parameter-lookup',
      title: 'Parameter lookup',
      connectionId: source.connection.id,
      request: { queryType: QueryType.SQL, text: sql } as ITextQueryRequest,
      ...(parameters?.length ? { parameters } : {}),
    };
    return this.dispatch.execute({
      projectRef: ref,
      definition,
      target: { kind: 'browser-sqlite' },
      ...(source.environment ? { environment: source.environment } : {}),
      ...(Object.keys(values).length ? { parameters: values } : {}),
      browserSqliteSession: session,
      signal,
    });
  }

  /**
   * The cached catalog probe of a collection. It runs on its own controller, not
   * the first caller's, so a cancelled search never leaves later searches waiting
   * on an aborted probe; each caller only stops waiting when its own signal aborts.
   */
  private schema(ref: IProjectRef, source: PublicLookupSource, session: BrowserSqliteSession, signal: AbortSignal): Promise<SchemaProbe> {
    const key = `${refKey(ref)}\u0000${source.connection.id}\u0000${source.collection}`;
    let probe = this.schemas.get(key);
    if (!probe) {
      probe = this.run(ref, source, session, LOOKUP_SCHEMA_SQL, [{ id: 'collection', type: 'string', isRequired: true }],
        { collection: { type: 'string', value: source.collection } }, new AbortController().signal)
        .then((result) => {
          const rows = result.recordset.rows;
          const columns = rows.map((row) => ({ name: String(row[0]?.value ?? ''), type: String(row[1]?.value ?? '') }));
          const primaryKey = rows
            .filter((row) => Number(row[2]?.value ?? 0) > 0)
            .sort((a, b) => Number(a[2]?.value) - Number(b[2]?.value))
            .map((row) => String(row[0]?.value ?? ''));
          return { columns, primaryKey };
        });
      probe.catch(() => this.schemas.delete(key));
      this.schemas.set(key, probe);
    }
    return untilAborted(probe, signal);
  }

  /** Why a source's fixture key cannot serve this parameter, or undefined when it can. */
  private keyProblem(parameter: IParameterDef, source: PublicLookupSource, schema: SchemaProbe): string | undefined {
    if (!schema.columns.length) return 'it is not in this sample';
    if (schema.primaryKey.length !== 1 || schema.primaryKey[0] !== source.keyColumn)
      return `it has no single-column primary key on ${source.keyColumn}`;
    const keyKind = columnKeyKind(schema.columns.find((c) => c.name === source.keyColumn)?.type);
    if (!keyKind) return `its key ${source.keyColumn} is neither integer nor text`;
    if (!parameterAcceptsKey(parameter.type, keyKind))
      return `its key is ${keyKind === 'string' ? 'text' : 'integer'} but this input expects ${parameter.type}`;
    return undefined;
  }

  private async search(ref: IProjectRef, parameter: IParameterDef, entity: LookupEntity, source: PublicLookupSource, session: BrowserSqliteSession, filter: string, signal: AbortSignal): Promise<ParameterLookupPage> {
    const schema = await this.schema(ref, source, session, signal);
    const collection = source.collection;
    const problem = this.keyProblem(parameter, source, schema);
    if (problem) return {
      collection, columns: [], rows: [], limited: false,
      unavailable: `${collection} cannot be used for this lookup: ${problem}.`,
    };
    const display = lookupDisplayColumns(entity, source, schema.columns);
    const { sql, parameters, values } = lookupRowsSql(collection, source.keyColumn, display.columns.map((c) => c.column), filter);
    const result = await this.run(ref, source, session, sql, parameters, values, signal);
    const rows = result.recordset.rows;
    const entityLabel = entity.id || parameter.meta?.entity || 'this entity';
    return {
      collection,
      columns: [
        { name: source.keyColumn, label: humanizeName(source.keyColumn), key: true },
        ...display.columns.map((c) => ({ name: c.column, label: c.label, key: false })),
      ],
      rows: rows.slice(0, LOOKUP_PAGE_SIZE),
      limited: rows.length > LOOKUP_PAGE_SIZE,
      ...(display.inferred && this.authState()?.status === 'authenticated' ? { inferredNote: `Columns guessed: declare display on entity ${entityLabel} to choose them.` } : {}),
      // Only limitations that change what the list shows; chart-rights notes do not apply to a pick list.
      ...(result.limitations?.some((l) => l.rowsFiltered || l.hiddenColumns?.length)
        ? { limitations: result.limitations.filter((l) => l.rowsFiltered || l.hiddenColumns?.length).map((l) => l.policy) }
        : {}),
    };
  }
}
