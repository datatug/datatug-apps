import type { BoundedFederation, BoundedRecord } from './bounded-federation';
import type { CanonicalPins, ImmutableFile } from './canonical-metadata';
import type { VerifiedDeclaredSource } from './declared-source';
import type { SourceField, SourceFacts } from './representation-discovery';

export const SAVED_SCENARIO_PUBLICATION_BLOCKER =
  'Saved public-data execution awaits canonical companion publication and fresh metadata admission. A saved eligibility value does not authorize execution.';

/** Saved with the existing query; never refreshes or executes on reopening. */
export interface PublicDataScenario {
  readonly execution?: 'label-bridge' | 'native-identifier' | 'native-graph';
  readonly graph?: import('./native-graph-executor').NativeGraphPlan;
  readonly native?: {
    readonly dataset: ImmutableFile;
    readonly provenance: ImmutableFile;
  };
  readonly source: SourceField;
  /** Descriptive evidence observed at the saved pins; never execution authority. */
  readonly sourceFacts?: SourceFacts;
  readonly declaredSource?: VerifiedDeclaredSource;
  readonly canonical: CanonicalPins;
  readonly attachment: ImmutableFile;
  readonly snapshot: ImmutableFile;
  readonly model: ImmutableFile;
  readonly meaning: ImmutableFile;
  readonly decision: ImmutableFile;
  readonly decisionScope: string;
  readonly namespace: string;
  readonly projection: 'identity';
  readonly equality: 'utf8-byte-exact';
  readonly rights: {
    readonly source: string;
    readonly model: string;
    readonly meaning: string;
    readonly attribution: string;
  };
  readonly observedAt: string;
  readonly eligible: boolean;
  readonly unavailableReason: string;
}
export interface PublicDataExceptions {
  readonly denominator: number;
  readonly nonNull: number;
  readonly null: number;
  readonly empty: number;
  readonly invalid: number;
  readonly unmatched: number;
  readonly ambiguous: number;
  readonly matched: number;
  readonly multiplied: number;
  /** Truncated dependencies cannot establish absence or complete cardinality. */
  readonly unresolved?: number;
  readonly complete?: boolean;
  readonly details: readonly {
    readonly key: string;
    readonly raw: unknown;
    readonly projected: readonly string[];
    readonly status: string;
    readonly matches: number;
    readonly targetStatus?: string;
  }[];
}

/** Representation validity only; exact snapshot membership is a separate lookup. */
export function validNativeRorUrl(raw: string): boolean {
  if (!/^https:\/\/ror\.org\/0[0-9a-hj-km-np-tv-z]{6}[0-9]{2}$/.test(raw))
    return false;
  const token = raw.slice('https://ror.org/'.length);
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  let value = 0;
  for (const character of token.slice(0, 7))
    value = value * 32 + alphabet.indexOf(character);
  return Number(token.slice(7)) === 98 - ((value * 100) % 97);
}

/** Counts source rows/affiliations, never one affiliation once per location. */
export function publicDataExceptions(
  bounds: BoundedFederation,
  sources: ReadonlyMap<string, readonly BoundedRecord[]>,
  pages?: ReadonlyMap<
    string,
    import('./immutable-federation').OrdinaryPageReceipt
  >,
): PublicDataExceptions {
  const driver = bounds.sources[0];
  const reference = bounds.sources[1];
  const rows = sources.get(`${driver.database}.${driver.name}`) ?? [];
  const targets = sources.get(`${reference.database}.${reference.name}`) ?? [];
  const incomplete = bounds.sources.slice(1).some((source) => {
    const page = pages?.get(`${source.database}.${source.name}`);
    return page?.possiblyMore || page?.complete === false;
  });
  let unresolved = 0;
  const counts = {
    denominator: rows.length,
    nonNull: 0,
    null: 0,
    empty: 0,
    invalid: 0,
    unmatched: 0,
    ambiguous: 0,
    matched: 0,
    multiplied: 0,
  };
  const details = rows.map((row) => {
    const raw = row.data[reference.parent?.field ?? driver.keyField];
    let status: string;
    const bridgeMatches = targets.filter(
      (target) => target.data[reference.keyField] === raw,
    );
    let matches = bridgeMatches;
    for (const stage of bounds.sources.slice(2)) {
      const candidates = sources.get(`${stage.database}.${stage.name}`) ?? [];
      matches = matches.flatMap((parent) =>
        candidates.filter(
          (target) =>
            target.data[stage.keyField] ===
            parent.data[stage.parent?.field ?? ''],
        ),
      );
    }
    if (raw === null || raw === undefined) {
      counts.null++;
      status = 'NULL';
    } else {
      counts.nonNull++;
      if (raw === '') {
        counts.empty++;
        status = 'empty';
      } else if (
        typeof raw !== 'string' ||
        (bounds.identifierKind === 'ror' && !validNativeRorUrl(raw))
      ) {
        counts.invalid++;
        status = 'invalid';
      } else if (incomplete) {
        unresolved++;
        status = 'unresolved due to truncation';
      } else if (!matches.length) {
        counts.unmatched++;
        status = 'unmatched';
      } else if (matches.length > 1) {
        counts.ambiguous++;
        counts.multiplied += matches.length - 1;
        status = 'ambiguous';
      } else {
        counts.matched++;
        status = 'matched';
      }
    }
    const nextField = bounds.sources[2]?.parent?.field ?? reference.keyField;
    const projected = bridgeMatches
      .map((match) => match.data[nextField])
      .filter((value): value is string => typeof value === 'string');
    const targetStatus =
      bounds.identifierKind === 'ror' &&
      matches.length === 1 &&
      typeof matches[0].data['status'] === 'string'
        ? matches[0].data['status']
        : undefined;
    return {
      key: row.key,
      raw,
      projected,
      status,
      matches: matches.length,
      ...(targetStatus ? { targetStatus } : {}),
    };
  });
  return {
    ...counts,
    details,
    ...(pages
      ? {
          unresolved,
          complete: ![...pages.values()].some(
            (page) => page.possiblyMore || !page.complete,
          ),
        }
      : {}),
  };
}
export function scenarioRevisionChanges(
  saved: PublicDataScenario,
  current: CanonicalPins,
): readonly string[] {
  return (['directory', 'models', 'meanings'] as const).filter(
    (kind) =>
      JSON.stringify(saved.canonical[kind]) !== JSON.stringify(current[kind]),
  );
}
