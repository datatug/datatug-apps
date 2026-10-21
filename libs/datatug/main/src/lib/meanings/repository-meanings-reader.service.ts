import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { formatGithubProjectId } from '@datatug/project-address';
import type { Board } from '@datatug/board-models';
import type { IEntity } from '../models/definition/metapedia/entity';
import type { MeaningSource } from './project-meanings-contract';
import type { IProjectRef } from '../core/project-context';
import {
  ProjectAssetsReadService,
  githubProjectAddressForRef,
} from '../services/project/project-assets-read.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import {
  GithubProjectReaderService,
  parseGithubProjectId,
} from '../services/repo/github/github-project-reader.service';
import { PublicDataService } from '../queries/public-data/public-data.service';
import {
  CanonicalMetadataCache,
  CanonicalMetadataReader,
} from '../queries/public-data/canonical-metadata';
import {
  locatedMeaningQueries,
  type MeaningQueryFolder,
} from './project-meanings';
import type { ProjectMeaningsCatalog } from './project-meanings-contract';
import {
  enrichRepositoryMeanings,
  type MeaningRepository,
} from './repository-meanings';

const NATIVE_MEANINGS_REGISTRY = {
  repository: 'https://github.com/meaninggraph/registry',
  revision: 'ed1dd43027864889f8e887cdac3c505068792f93',
  path: 'index.json',
  sha256: '7f84e9a8664d1411328529975d39870108d5d90b30ba8eb3ee0127af068e7bd7',
};

/** Read-only discovery uses authorized asset providers; anonymous GitHub is used only in its existing public lane. */
@Injectable({ providedIn: 'root' })
export class RepositoryMeaningsReaderService {
  private readonly github = inject(GithubProjectReaderService);
  private readonly assets = inject(ProjectAssetsReadService);
  private readonly api = inject(ProjectQueryApiService);
  private readonly publicData = inject(PublicDataService);
  private readonly cache = new CanonicalMetadataCache();
  async enrich(
    ref: IProjectRef,
    catalog: ProjectMeaningsCatalog,
  ): Promise<ProjectMeaningsCatalog> {
    const notices: string[] = [];
    const publicGithub =
      ['github', 'github.com'].includes(ref.storeId) &&
      ref.projectApi === undefined;
    let pinned = ref,
      address = '',
      repository = `${catalog.scope.storage}:${catalog.scope.project}`,
      revision = catalog.scope.branch || 'current project',
      projectFolder = '';
    if (publicGithub) {
      address = githubProjectAddressForRef(ref);
      const info = await firstValueFrom(this.github.readInfo(address));
      if (!info.commit || !/^[a-f0-9]{40}$/.test(info.commit))
        throw new Error(
          'The repository revision could not be verified for meaning discovery.',
        );
      const parsed = parseGithubProjectId(address);
      revision = info.commit;
      repository = `https://github.com/${parsed.org}/${parsed.repo}`;
      projectFolder = parsed.folder;
      address = formatGithubProjectId({ ...parsed, ref: revision });
      pinned = { ...ref, projectId: address, branch: undefined };
    } else
      notices.push(
        'Repository MeaningGraph files could not be checked for this project source. Saved project definitions are shown below.',
      );
    let bytes = 0,
      files = 0,
      conceptCount = 0,
      capacityExceeded = false;
    const boundedText = async (root: string, path: string) => {
      if (capacityExceeded || files >= 96)
        throw new Error('Meaning discovery exceeds its file capacity bound.');
      const text = await firstValueFrom(this.github.getRawText(root, path));
      if (text !== undefined) {
        files++;
        bytes += new TextEncoder().encode(text).length;
        if (bytes > 2 * 1024 * 1024) {
          capacityExceeded = true;
          throw new Error('Meaning discovery exceeds its 2MiB bound.');
        }
      }
      return text;
    };
    const definitions = await (
      publicGithub
        ? firstValueFrom(this.github.listEntityIds(address)).then((ids) =>
            ids.map((id) => ({ id })),
          )
        : firstValueFrom(this.assets.entities(pinned))
    ).catch(() => {
      notices.push('Some project entity declarations could not be read.');
      return [];
    });
    if ((definitions?.length ?? 0) > 100)
      throw new Error('Project entity discovery exceeds its read bound.');
    const legacy: IEntity[] = [];
    const legacyPaths: Record<string, string> = {};
    for (const brief of definitions ?? []) {
      if (capacityExceeded) break;
      try {
        let definition: IEntity;
        if (publicGithub) {
          // Charge raw bytes before parsing or dual-layout reconciliation, including whitespace.
          for (const path of [
            `entities/${brief.id}/${brief.id}.entity.json`,
            `entities/${brief.id}.entity.json`,
          ])
            await boundedText(address, path);
          const path = await firstValueFrom(
            this.github.entityDefinitionPath(address, brief.id),
          );
          const text = await firstValueFrom(
            this.github.getRawText(address, path),
          );
          if (text === undefined)
            throw new Error('The project entity definition is unavailable.');
          definition = JSON.parse(text);
          legacyPaths[brief.id] = [projectFolder, path]
            .filter(Boolean)
            .join('/');
        } else {
          definition = await firstValueFrom(
            this.assets.entity(pinned, brief.id),
          );
          files++;
          bytes += new TextEncoder().encode(JSON.stringify(definition)).length;
          if (bytes > 2 * 1024 * 1024 || files > 96) {
            capacityExceeded = true;
            throw new Error(
              'Project entity discovery exceeds its capacity bound.',
            );
          }
        }
        conceptCount += 1 + (definition.fields?.length ?? 0);
        if (conceptCount > 4096) {
          capacityExceeded = true;
          throw new Error(
            'Project entity discovery exceeds its concept bound.',
          );
        }
        legacy.push({ ...definition, id: brief.id });
      } catch (error) {
        notices.push(
          `Project entity ${brief.id} could not be read: ${(error as Error).message}`,
        );
      }
    }
    let queries = locatedMeaningQueries({ id: '~' });
    const boards: Board[] = [];
    try {
      queries = locatedMeaningQueries(
        await firstValueFrom(
          publicGithub
            ? this.github.getQueriesFolder(address)
            : this.api.folder<MeaningQueryFolder>(pinned),
        ),
      );
    } catch {
      notices.push('Some saved query declarations could not be read.');
    }
    try {
      const list = await firstValueFrom(this.assets.boards(pinned));
      if (list.length > 100)
        throw new Error('Board discovery exceeds its read bound.');
      for (const brief of list)
        boards.push(await firstValueFrom(this.assets.board(pinned, brief.id)));
    } catch {
      notices.push('Some dashboard references could not be read.');
    }
    const databases: {
      environment: string;
      id: string;
      driver?: string;
      host?: string;
      port?: number;
    }[] = [];
    try {
      const environments = await firstValueFrom(
        this.assets.environments(pinned),
      );
      if (environments.length > 32)
        throw new Error('Environment discovery exceeds its bound.');
      for (const environment of environments) {
        const details = publicGithub
          ? await firstValueFrom(
              this.github.getEnvironmentSummary(address, environment.id),
            )
          : environment;
        for (const server of details.dbServers ??
          ('dbServer' in details ? details.dbServer : []) ??
          [])
          for (const id of server.catalogs ?? []) {
            if (databases.length >= 256)
              throw new Error('Database discovery exceeds its bound.');
            databases.push({
              environment: environment.id,
              id,
              driver: server.driver,
              host: server.host,
              port: server.port,
            });
          }
      }
    } catch {
      notices.push('Some database catalog references could not be read.');
    }
    const readRepository = async (
      repo: string,
      commit: string,
    ): Promise<MeaningRepository> => {
      const match =
        /^https:\/\/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)$/.exec(repo);
      if (!match || !/^[a-f0-9]{40}$/.test(commit))
        throw new Error(
          'Only immutable GitHub meaning repositories can be resolved.',
        );
      const root = formatGithubProjectId({
        org: match[1],
        repo: match[2],
        folder: '',
        ref: commit,
      });
      let paths = (await firstValueFrom(this.github.listDirectory(root, '')))
        .filter(
          (entry) =>
            entry.type === 'file' && entry.name.endsWith('.meaning.yaml'),
        )
        .map((entry) => entry.path);
      // Native root discovery is normative. Registered non-root files are admitted only by the pinned registry.
      if (!paths.length && repo !== repository) {
        this.cache.begin({
          ...this.publicData.currentPins,
          meanings: NATIVE_MEANINGS_REGISTRY,
        });
        const reader = new CanonicalMetadataReader(
          fetch,
          this.cache,
          AbortSignal.timeout(15000),
        );
        const registry = await reader.json(NATIVE_MEANINGS_REGISTRY);
        if (
          registry['format'] !== 'meaning-registry/draft-1' ||
          !Array.isArray(registry['graphs'])
        )
          throw new Error('Invalid pinned MeaningGraph registry.');
        const records = registry['graphs'].filter(
          (record) => record?.repository === repo && record?.commit === commit,
        );
        if (records.length !== 1 || !Array.isArray(records[0].meaning_files))
          throw new Error(
            'The non-root meaning graph has no exact pinned registry record.',
          );
        paths = records[0].meaning_files;
      }
      if (paths.length > 64)
        throw new Error('Meaning graph exceeds its file bound.');
      const result = [];
      for (const path of paths) {
        if (
          typeof path !== 'string' ||
          !path.endsWith('.meaning.yaml') ||
          path.split('/').some((part) => !part || part === '.' || part === '..')
        )
          throw new Error('Invalid registered meaning file path.');
        const text = await boundedText(root, path);
        if (text === undefined)
          throw new Error('A declared native meaning file is unavailable.');
        result.push({ path, text });
      }
      return { repository: repo, revision: commit, files: result };
    };
    let own: MeaningRepository = { repository, revision, files: [] },
      uses: unknown;
    if (publicGithub) {
      try {
        own = await readRepository(repository, revision);
      } catch (error) {
        notices.push((error as Error).message);
      }
      try {
        uses = await firstValueFrom(
          this.github.getRawJson(address, 'datatug-meaning-uses.json'),
        );
        if (
          uses !== undefined &&
          new TextEncoder().encode(JSON.stringify(uses)).length > 256 * 1024
        )
          throw new Error('Meaning uses exceed their byte bound.');
      } catch (error) {
        notices.push((error as Error).message);
      }
    }
    const legacyReads = new Map<
      string,
      Promise<{ source: MeaningSource; definition: IEntity }>
    >();
    const readLegacy = (url: string) => {
      let pending = legacyReads.get(url);
      if (!pending) {
        pending = (async () => {
          if (!publicGithub)
            throw new Error(
              'An external project definition could not be checked for this project source.',
            );
          // Deliberately accept only the existing public raw-GitHub declaration syntax.
          const match =
            /^https:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(.+)$/.exec(
              url,
            );
          if (
            !match ||
            /[%?#\\]/.test(url) ||
            match[4]
              .split('/')
              .some(
                (part) =>
                  !part || part === '.' || part === '..' || part === '.git',
              ) ||
            !match[4].endsWith('.json')
          )
            throw new Error(
              'A declared external project definition has an unsupported source URL.',
            );
          const [, org, repo, ref, path] = match;
          const root = formatGithubProjectId({ org, repo, ref, folder: '' });
          const info = await firstValueFrom(this.github.readInfo(root));
          if (!info.commit || !/^[a-f0-9]{40}$/.test(info.commit))
            throw new Error(
              'The external project definition revision could not be verified.',
            );
          const pinnedRoot = formatGithubProjectId({
            org,
            repo,
            ref: info.commit,
            folder: '',
          });
          const text = await boundedText(pinnedRoot, path);
          if (text === undefined)
            throw new Error(
              'A declared external project definition is unavailable.',
            );
          const definition = JSON.parse(text) as IEntity;
          if (
            !definition ||
            typeof definition !== 'object' ||
            Array.isArray(definition)
          )
            throw new Error('Invalid external project definition.');
          return {
            source: {
              repository: `https://github.com/${org}/${repo}`,
              revision: info.commit,
              path,
              kind: 'custom' as const,
            },
            definition,
          };
        })();
        legacyReads.set(url, pending);
      }
      return pending;
    };
    const result = await enrichRepositoryMeanings({
      catalog,
      own,
      projectFolder,
      legacy,
      legacyPaths,
      queries,
      boards,
      databases,
      uses,
      readRepository,
      readLegacy,
      queryBody: async (location) => {
        if (!publicGithub)
          throw new Error(
            'Native query uses cannot be resolved through this provider.',
          );
        const query = await firstValueFrom(
          this.github.getQuery(address, location),
        );
        if (!query || typeof query.text !== 'string')
          throw new Error('The saved query body is unavailable.');
        return {
          type: query.type,
          text: query.text,
          connectionId: query.connectionId,
          federation: query.federation,
        };
      },
    });
    return notices.length
      ? {
          ...result,
          discoveryComplete: false,
          notices: [...new Set([...(result.notices ?? []), ...notices])],
        }
      : result;
  }
}
