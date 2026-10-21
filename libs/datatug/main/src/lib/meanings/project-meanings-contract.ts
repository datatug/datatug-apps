import type { SemanticMeaningScope } from '../queries/semantic-mapping';
/** Shared provider contract; scope uses the existing ProjectQuery API envelope. */
export interface MeaningIdentity {
  readonly documentId: string;
  readonly conceptId: string;
}
export interface MeaningResource {
  readonly kind: 'query' | 'board' | 'database';
  readonly id: string;
  readonly title: string;
  readonly environment?: string;
}
export interface MeaningField extends MeaningIdentity {
  readonly name: string;
  readonly description: string;
  readonly resources: readonly MeaningResource[];
}
export interface MeaningEntity extends MeaningIdentity {
  readonly name: string;
  readonly description: string;
  readonly origin: 'project' | 'query';
  readonly fields: readonly MeaningField[];
  readonly resources: readonly MeaningResource[];
}
export interface ProjectMeaningsCatalog {
  readonly version: 1;
  readonly scope: SemanticMeaningScope;
  readonly revision: string;
  /** True only after provider authorizes this principal for durable standalone changes. */
  readonly writable: boolean;
  /** Informational read state only; mutation must independently recompute. */
  readonly referencesComplete: boolean;
  readonly entities: readonly MeaningEntity[];
  /** Read-only discovery notes, never mutation authority. */
  readonly notices?: readonly string[];
}
export type ProjectMeaningAction =
  | {
      readonly action: 'add-entity';
      readonly conceptId: string;
      readonly name: string;
      readonly description: string;
    }
  | {
      readonly action: 'add-field';
      readonly entity: MeaningIdentity;
      readonly conceptId: string;
      readonly name: string;
      readonly description: string;
    }
  | { readonly action: 'delete-entity'; readonly entity: MeaningIdentity }
  | {
      readonly action: 'delete-field';
      readonly entity: MeaningIdentity;
      readonly field: MeaningIdentity;
    };
export interface ProjectMeaningWrite {
  readonly operationId: string;
  readonly ifMatch: string;
  readonly change: ProjectMeaningAction;
}
export interface ProjectMeaningAck {
  readonly receipt: string;
  readonly catalog: ProjectMeaningsCatalog;
}

export class ProjectMeaningsCapacityError extends Error {
  constructor() {
    super(
      'This project exceeds the supported meanings catalog capacity. Narrow the project before loading meanings.',
    );
  }
}

/** Strict admission at the read boundary; malformed responses cannot authorize mutations. */
export function validateProjectMeaningsCatalog(
  value: unknown,
): asserts value is ProjectMeaningsCatalog {
  const fail = (): never => {
    throw new Error('The project meanings response is invalid or unsupported.');
  };
  const object = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail();
    return v as Record<string, unknown>;
  };
  const text = (v: unknown, max = 4096): v is string =>
    typeof v === 'string' &&
    v.length > 0 &&
    v.length <= max &&
    !Array.from(v).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    });
  const list = (v: unknown): unknown[] => {
    if (!Array.isArray(v)) fail();
    if ((v as unknown[]).length > 4096)
      throw new ProjectMeaningsCapacityError();
    return v as unknown[];
  };
  const identity = (v: Record<string, unknown>): void => {
    if (
      !text(v['documentId'], 1024) ||
      !text(v['conceptId'], 80) ||
      !/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/.test(v['conceptId'] as string)
    )
      fail();
  };
  const resources = (v: unknown): void => {
    for (const item of list(v)) {
      const r = object(item);
      if (
        !['query', 'board', 'database'].includes(r['kind'] as string) ||
        !text(r['id'], 512) ||
        !text(r['title'], 512)
      )
        fail();
      if (r['environment'] !== undefined && !text(r['environment'], 128))
        fail();
      if (r['kind'] === 'database' && !text(r['environment'], 128)) fail();
    }
  };
  if (new TextEncoder().encode(JSON.stringify(value)).length > 8 * 1024 * 1024)
    throw new ProjectMeaningsCapacityError();
  const root = object(value);
  if (
    root['version'] !== 1 ||
    !text(root['revision'], 512) ||
    typeof root['writable'] !== 'boolean' ||
    typeof root['referencesComplete'] !== 'boolean'
  )
    fail();
  const scope = object(root['scope']);
  if (
    !['local', 'github.com', 'firestore'].includes(
      scope['storage'] as string,
    ) ||
    !text(scope['project'], 1024) ||
    (scope['branch'] !== undefined && !text(scope['branch'], 256)) ||
    (scope['spaceID'] !== undefined && !text(scope['spaceID'], 256)) ||
    (scope['storage'] === 'local' && !text(scope['branch'], 256)) ||
    (scope['storage'] === 'firestore'
      ? !text(scope['spaceID'], 256) || scope['branch'] !== undefined
      : scope['spaceID'] !== undefined)
  )
    fail();
  const keys = new Set<string>();
  let conceptCount = 0;
  for (const item of list(root['entities'])) {
    if (++conceptCount > 4096) throw new ProjectMeaningsCapacityError();
    const entity = object(item);
    identity(entity);
    const key = JSON.stringify([entity['documentId'], entity['conceptId']]);
    if (
      keys.has(key) ||
      !['project', 'query'].includes(entity['origin'] as string) ||
      !text(entity['name'], 512) ||
      typeof entity['description'] !== 'string' ||
      (entity['description'] as string).length > 4096
    )
      fail();
    if (
      (entity['origin'] === 'project') !==
      (entity['documentId'] === 'project')
    )
      fail();
    keys.add(key);
    resources(entity['resources']);
    const fields = new Set<string>();
    for (const item of list(entity['fields'])) {
      if (++conceptCount > 4096) throw new ProjectMeaningsCapacityError();
      const field = object(item);
      identity(field);
      if (
        field['documentId'] !== entity['documentId'] ||
        fields.has(field['conceptId'] as string) ||
        !text(field['name'], 512) ||
        typeof field['description'] !== 'string' ||
        (field['description'] as string).length > 4096
      )
        fail();
      fields.add(field['conceptId'] as string);
      resources(field['resources']);
    }
  }
}
