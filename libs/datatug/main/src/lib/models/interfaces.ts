import { IUserRecord } from '@sneat/auth-models';
import { IProjectRef } from '../core/project-context';
import {
  IStoreRef,
  STORE_ID_GITHUB_COM,
  STORE_TYPE_GITHUB,
  StoreType,
} from '@sneat/core';
import { ProjectAccess } from './definition/project';

// export interface IRecord<T> { // TODO: duplicate name
//   id: string;
//   state?: RecordState;
//   data?: T;
// }

export interface IDatatugUser extends IUserRecord {
  datatug?: IDatatugBriefForUser;
}

export type IDatatugStoreBriefsById = Record<string, IDatatugStoreBrief>;

export interface IDatatugBriefForUser {
  stores?: IDatatugStoreBriefsById;
}

export interface IDatatugStoreBrief {
  readonly title: string;
  readonly type: DatatugProjStoreType;
  readonly url?: string;
  readonly projects?: Record<string, IProjectBrief>;
}

export interface IDatatugStoreBriefWithId extends IDatatugStoreBrief {
  id: string;
}

export interface IProjectAndStore {
  ref: IProjectRef;
  store: IDatatugStoreBrief;
  project: IProjectBrief;
}

export const cloudStoreId = 'firestore';
export const cloudStoreTitle = 'DataTug cloud';
export const cloudStoreEmoji = '☁️';
export const cloudStoreTitleWithIcon = `${cloudStoreEmoji} ${cloudStoreTitle}`;

/**
 * Store id of the default local `datatug serve` agent, in the app's
 * canonical dash-prefixed form (`http-<host>:<port>`, exactly what
 * `datatug serve` prints and what `parseDatatugStoreRef()` in
 * `nav/nav-models.ts` accepts). It used to be the full URL
 * (`http://localhost:8989`), which `parseDatatugStoreRef()` rejects with
 * `unsupported format of store id`, so picking "localhost:8989" on the home
 * page threw instead of navigating (founder, 2026-09-10).
 */
export const LOCALHOST_AGENT_URL = 'http://localhost:8989';
export const LOCALHOST_AGENT_STORE_ID = 'http-localhost:8989';

/**
 * True for any spelling of a localhost agent store id a user record may
 * hold: the canonical `http-localhost:<port>`, the bare `localhost:<port>`,
 * or the legacy full URL `http://localhost:<port>`.
 */
export function isLocalhostAgentStoreId(storeId: string): boolean {
  return /^(https?-|https?:\/\/)?localhost:\d+$/.test(storeId);
}

export function allUserStoresAsFlatList(
  stores?: IDatatugStoreBriefsById,
): IDatatugStoreBriefWithId[] {
  const result: IDatatugStoreBriefWithId[] = [];
  stores = stores || {};
  if (!stores[cloudStoreId]) {
    stores[cloudStoreId] = {
      type: cloudStoreId,
      title: cloudStoreTitleWithIcon,
    };
  }
  if (!stores[STORE_ID_GITHUB_COM]) {
    stores[STORE_ID_GITHUB_COM] = {
      type: STORE_TYPE_GITHUB,
      title: 'GitHub.com',
    };
  }

  const hasLocalhost = Object.keys(stores).some(isLocalhostAgentStoreId);
  if (!hasLocalhost) {
    stores = {
      ...stores,
      [LOCALHOST_AGENT_STORE_ID]: {
        type: 'agent',
        url: LOCALHOST_AGENT_URL,
        title: 'localhost:8989',
      },
    };
  }

  for (const id in stores) {
    const store: IDatatugStoreBriefWithId = { ...stores[id], id };
    result.push({
      ...store,
      title:
        ((store.id === cloudStoreId || store.type === 'firestore') &&
          cloudStoreTitle) ||
        store.title ||
        id,
    });
  }
  return result;
}

export function allUserProjectsAsFlatList(
  stores?: IDatatugStoreBriefsById,
): IProjectAndStore[] {
  const projects: IProjectAndStore[] = [];
  if (!stores) {
    return projects;
  }
  for (const storeId in stores) {
    const store = { id: storeId, ...stores[storeId] };
    for (const projectId in store.projects) {
      const project = { id: projectId, ...store.projects[projectId] };
      projects.push({ ref: { projectId, storeId }, store, project });
    }
  }
  return projects;
}

export function projectsBriefFromDictToFlatList(
  projects?: Record<string, IProjectBrief>,
): IDatatugProjectBriefWithId[] {
  const result: IDatatugProjectBriefWithId[] = [];
  if (projects) {
    for (const id in projects) {
      result.push({ ...projects[id], id });
    }
  }
  return result;
}

export type DatatugProjStoreType = StoreType;

export interface IProjStoreRef extends IStoreRef {
  type: DatatugProjStoreType;
  url?: string;
}

export interface IProjectBrief {
  readonly access?: ProjectAccess;
  readonly title: string;
  readonly titleOverride?: string;
}

export interface IDatatugProjectBriefWithId extends IProjectBrief {
  readonly id: string;
}

export interface IDatatugProjectBriefWithIdAndStoreRef extends IDatatugProjectBriefWithId {
  readonly store: { ref: IProjStoreRef };
}
