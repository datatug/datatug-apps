import { Injectable, inject } from '@angular/core';
import { firstValueFrom, fromEvent, last, takeUntil, type Observable } from 'rxjs';
import type { IProjectContext } from '../../nav/nav-models';
import { ProjectService } from '../../services/project/project.service';
import { EnvironmentService } from '../../services/unsorted/environment.service';
import {
  GithubProjectReaderService,
  buildGithubRawUrl,
  parseGithubProjectId,
} from '../../services/repo/github/github-project-reader.service';
import {
  PublicDataService,
  type PublicDataDiscovery,
} from './public-data.service';
import {
  configuredFieldChoices,
  type ConfiguredFieldChoice,
  type ConfiguredPublicSource,
} from './configured-source';
import {
  immutableDataFile,
  type DeclaredCatalogContext,
  type VerifiedDeclaredSource,
} from './declared-source';
import { sha256, object } from './canonical-metadata';
import {
  parseHttpsJsonCatalog,
  validateHttpsJsonCatalog,
} from '../../project-files/https-json-catalog';
import type { ITableFull } from '../../models/definition/apis/database';

async function read<T>(
  observable: Observable<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  try {
    return await firstValueFrom(
      observable.pipe(takeUntil(fromEvent(signal, 'abort'))),
    );
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
}

@Injectable({ providedIn: 'root' })
export class ConfiguredPublicDataSourcesService {
  private readonly projects = inject(ProjectService);
  private readonly environments = inject(EnvironmentService);
  private readonly github = inject(GithubProjectReaderService);
  private readonly metadata = inject(PublicDataService);

  async list(
    project: IProjectContext,
    signal: AbortSignal = new AbortController().signal,
    fresh = false,
  ): Promise<readonly ConfiguredPublicSource[]> {
    const summary =
      project.summary ??
      (await read(this.projects.getSummary(project.ref), signal));
    const github = ['github', 'github.com'].includes(project.ref.storeId);
    const envs = fresh && github
      ? await read(this.environments.listEnvironments(project.ref.projectId), signal)
      : summary?.environments ??
      (github
        ? await read(
            this.environments.listEnvironments(project.ref.projectId),
            signal,
          )
        : []);
    if (envs.length > 16)
      throw new Error(
        'Select a project with at most 16 configured environments for bounded discovery.',
      );
    const result: ConfiguredPublicSource[] = [];
    for (const env of envs) {
      const detail = await read(
        this.environments.getEnvSummary(project.ref, env.id, fresh).pipe(last()),
        signal,
      );
      for (const server of detail.dbServers ?? [])
        for (const catalog of server.catalogs ?? []) {
          if (
            ![env.id, catalog].every(
              (value) =>
                /^[A-Za-z0-9_.-]{1,128}$/.test(value) &&
                value !== '.' &&
                value !== '..',
            )
          )
            throw new Error('Unsafe configured source metadata path.');
          if (result.length >= 32)
            throw new Error('Configured source discovery exceeds 32 catalogs.');
          let declaration: DeclaredCatalogContext | undefined;
          let upstream: ConfiguredPublicSource['upstream'];
          let sourceTables: readonly ITableFull[] | undefined;
          if (github) {
            const file = await read(
              this.github.getRawJson<unknown>(
                project.ref.projectId,
                `environments/${env.id}/catalogs/${catalog}/${catalog}.db.json`,
              ),
              signal,
            );
            if (
              file &&
              typeof file === 'object' &&
              'driver' in file &&
              file.driver === 'https-json'
            ) {
              const parsed = validateHttpsJsonCatalog(file, {
                trust: 'untrusted',
              });
              if (
                parsed.ok &&
                parsed.value.sourceModel &&
                server.driver === 'https-json'
              ) {
                const path = `environments/${env.id}/catalogs/${catalog}/${catalog}.db.json`;
                const text = await read(
                  this.github.getRawText(project.ref.projectId, path),
                  signal,
                );
                const info = await read(
                  this.github.readInfo(project.ref.projectId),
                  signal,
                );
                if (!text || !info.commit || info.mayBeStale || info.fromMirror)
                  throw new Error(
                    'The declared source requires freshly resolved exact public GitHub configuration bytes.',
                  );
                const checked = parseHttpsJsonCatalog(text, {
                  trust: 'untrusted',
                });
                if (!checked.ok || !checked.value.sourceModel)
                  throw new Error('Invalid declared source configuration.');
                declaration = {
                  configuration: immutableDataFile(
                    buildGithubRawUrl(project.ref.projectId, path, info.commit),
                    await sha256(text),
                  ),
                  connection: {
                    storeId: project.ref.storeId,
                    projectId: project.ref.projectId,
                    id: `${env.id}/${server.id}/${catalog}`,
                  },
                  catalog: checked.value,
                };
              }
              if (parsed.ok)
                sourceTables = Object.keys(parsed.value.keys).map((name) => ({
                  schema: '',
                  name,
                  dbType: 'BASE TABLE',
                }));
            }
            if (
              file &&
              typeof file === 'object' &&
              'upstream' in file &&
              file.upstream
            ) {
              const raw = object(file.upstream, 'configured upstream');
              if (
                typeof raw['repository'] === 'string' &&
                typeof raw['revision'] === 'string'
              )
                upstream = {
                  repository: raw['repository'],
                  revision: raw['revision'],
                };
            }
          }
          result.push({
            id: `${env.id}/${server.id}/${catalog}`,
            title: `${detail.title} · ${catalog}`,
            environment: env.id,
            catalog,
            driver: server.driver,
            host: server.host,
            ...(upstream ? { upstream } : {}),
            ...(declaration ? { declaration } : {}),
            ...(sourceTables ? { tables: sourceTables } : {}),
          });
        }
    }
    return result;
  }

  async inspect(
    project: IProjectContext,
    connection: ConfiguredPublicSource,
    signal: AbortSignal,
  ): Promise<{
    discovery: PublicDataDiscovery;
    fields: readonly ConfiguredFieldChoice[];
  }> {
    const tables = await read(
      this.environments.getCatalogTables(
        project.ref,
        connection.environment,
        connection.catalog,
      ),
      signal,
    );
    signal.throwIfAborted();
    const listed = [...tables.tables, ...tables.views];
    const all = listed.length ? listed : (connection.tables ?? []);
    if (all.length > 128)
      throw new Error('Configured table discovery exceeds 128 tables/views.');
    if (connection.declaration) {
      const discovery = await this.metadata.discoverDeclared(
        connection.declaration,
        signal,
      );
      const fields = (discovery.declaredSources ?? []).map(
        (context): ConfiguredFieldChoice => {
          const tables = all.filter(
            (table) =>
              table.name === context.table.name &&
              table.schema === context.table.schema,
          );
          const table = tables[0] ?? {
            name: context.table.name,
            schema: context.table.schema,
            dbType: 'BASE TABLE',
          };
          const mapped =
            tables.length === 1 &&
            (!table.columns ||
              table.columns.some(
                (column) => column.name === context.field.name,
              ));
          return {
            id: `${context.table.schema}.${context.table.name}.${context.field.name}`,
            table,
            property: context.field.name,
            ...(mapped ? { source: context.source, context } : {}),
            reason: mapped
              ? 'Source schema, immutable data pin and explicit physical field mapping are verified. Canonical target publication and execution admission remain unavailable.'
              : 'Configured table/field metadata differs from the explicit checked source mapping.',
          };
        },
      );
      return { discovery, fields };
    }
    const discovery = await this.metadata.discoverAll(signal);
    return {
      discovery,
      fields: configuredFieldChoices(
        connection,
        all,
        discovery.indexes,
        discovery.suggestions,
      ),
    };
  }
  async resolveSaved(
    project: IProjectContext,
    saved: VerifiedDeclaredSource,
    signal: AbortSignal,
  ): Promise<DeclaredCatalogContext> {
    if (
      saved.connection.storeId !== project.ref.storeId ||
      saved.connection.projectId !== project.ref.projectId ||
      !['github', 'github.com'].includes(project.ref.storeId)
    )
      throw new Error(
        'Saved source belongs to a different project connection.',
      );
    const id = parseGithubProjectId(project.ref.projectId);
    await this.github.forget(id.org, id.repo);
    const sources = await this.list(project, signal, true);
    const matches = sources.filter(
      (source) => source.id === saved.connection.id && source.declaration,
    );
    if (matches.length !== 1 || !matches[0].declaration)
      throw new Error(
        'Saved declared connection is unavailable or ambiguous in current project configuration.',
      );
    return matches[0].declaration;
  }
}
