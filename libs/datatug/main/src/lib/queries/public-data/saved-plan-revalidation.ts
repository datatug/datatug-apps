import type { IQueryDef } from '../../models/definition/query-def';
import type { PublicDataDiscovery } from './public-data.service';
import type { PublicDataSuggestion } from './representation-discovery';
import type { ImmutableFile } from './canonical-metadata';
import type { PublicDataScenario } from './public-data-scenario';

/** A metadata observation; this is never serialized as execution authority. */
export interface SavedPlanRevalidation {
  readonly originalPlan: string;
  readonly fingerprint: string;
  readonly checkedAt: string;
  readonly compatible: boolean;
  readonly changes: readonly string[];
  readonly reason: string;
  readonly discovery: PublicDataDiscovery;
  readonly suggestion?: PublicDataSuggestion;
  readonly copy?: IQueryDef;
}
export function savedPlanIdentity(definition: IQueryDef): string {
  return JSON.stringify({
    publicData: definition.publicData,
    request: definition.request,
    federation: definition.federation,
  });
}
function sameFile(
  a: ImmutableFile | undefined,
  b: ImmutableFile | undefined,
): boolean {
  return a === undefined || b === undefined
    ? a === b
    : a.repository === b.repository &&
        a.revision === b.revision &&
        a.path === b.path &&
        a.sha256 === b.sha256;
}
export function savedPinChanges(
  saved: PublicDataScenario,
  fresh: PublicDataScenario,
): readonly string[] {
  const changes: string[] = [];
  if (
    JSON.stringify(saved.declaredSource) !==
    JSON.stringify(fresh.declaredSource)
  )
    changes.push('configured source/schema/data/mapping');
  for (const name of ['directory', 'models', 'meanings'] as const)
    if (!sameFile(saved.canonical[name], fresh.canonical[name]))
      changes.push(`canonical ${name}`);
  for (const name of [
    'attachment',
    'snapshot',
    'model',
    'meaning',
    'decision',
  ] as const)
    if (!sameFile(saved[name], fresh[name])) changes.push(name);
  for (const name of ['dataset', 'provenance'] as const)
    if (!sameFile(saved.native?.[name], fresh.native?.[name]))
      changes.push(`native ${name}`);
  if (JSON.stringify(saved.rights) !== JSON.stringify(fresh.rights))
    changes.push('licence/attribution');
  return changes;
}
