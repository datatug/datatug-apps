import { Injectable, inject } from '@angular/core';
import { firstValueFrom, fromEvent, takeUntil, type Observable } from 'rxjs';
import type { IProjectContext } from '../../nav/nav-models';
import { ProjectService } from '../../services/project/project.service';
import { EnvironmentService } from '../../services/unsorted/environment.service';
import { GithubProjectReaderService } from '../../services/repo/github/github-project-reader.service';
import {
  PublicDataService,
  type PublicDataDiscovery,
} from './public-data.service';
import {
  configuredFieldChoices,
  type ConfiguredFieldChoice,
  type ConfiguredPublicSource,
} from './configured-source';
import { object } from './canonical-metadata';
import { validateHttpsJsonCatalog } from '../../project-files/https-json-catalog';
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
  ): Promise<readonly ConfiguredPublicSource[]> {
    const summary =
      project.summary ??
      (await read(this.projects.getSummary(project.ref), signal));
    const github = ['github', 'github.com'].includes(project.ref.storeId);
    const envs =
      summary?.environments ??
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
        this.environments.getEnvSummary(project.ref, env.id),
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
}
