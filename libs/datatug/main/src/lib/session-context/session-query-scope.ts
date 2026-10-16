import { IQueryDef } from '../models/definition/query-def';
import { PUBLIC_CHINOOK_FIXTURE_SHA256 } from '../queries/public-sqlite-source-identity';
import { ContextCapabilities, SessionScope } from './session-context-contract';

export type ContextQuerySource =
  | {
      readonly kind: 'public-sqlite';
      readonly connectionId: string;
      readonly databaseId: string;
      readonly fixtureSha256: string;
    }
  | {
      readonly kind: 'hosted-embedded';
      readonly origin: string;
      readonly databaseId: string;
      readonly fixtureSha256: string;
      readonly catalogRevision: string;
    };

/** Match source authority, never display labels, input names or table aliases. */
export function queryContextScope(
  caps: ContextCapabilities | undefined,
  environmentId: string,
  definition: IQueryDef | undefined,
): SessionScope | undefined {
  if (!caps || !definition) return undefined;
  const environmentScopes = caps.environments.filter(
    (scope) => scope.environmentId === environmentId,
  );
  const matches = caps.environments.filter(
    (scope) =>
      scope.environmentId === environmentId &&
      Array.isArray(scope.querySources) &&
      scope.querySources.some((source) => {
        if (
          !source ||
          typeof source !== 'object' ||
          !/^[a-f0-9]{64}$/.test(source.fixtureSha256)
        )
          return false;
        if (source.kind === 'public-sqlite')
          return (
            !definition.federation &&
            !definition.publicData &&
            definition.connectionId === 'chinook-sqlite' &&
            source.connectionId === definition.connectionId &&
            source.databaseId === 'chinook' &&
            source.fixtureSha256 === PUBLIC_CHINOOK_FIXTURE_SHA256
          );
        if (
          source.kind !== 'hosted-embedded' ||
          !definition.federation ||
          !/^[a-f0-9]{64}$/.test(source.catalogRevision)
        )
          return false;
        const federation = definition.federation;
        let origin: string;
        try {
          const url = new URL(federation.ovdbBaseUrl);
          if (url.username || url.password) return false;
          origin = url.origin;
        } catch {
          return false;
        }
        const databases = [
          ...new Set(
            federation.tables.map((table) => table.database).filter(Boolean),
          ),
        ];
        const pins = federation.bounds?.runtime?.databases[source.databaseId];
        // Without an exact fixture pin the saved federation has insufficient provenance.
        return (
          origin === source.origin &&
          databases.length === 1 &&
          databases[0] === source.databaseId &&
          !!pins &&
          pins.sourceSha256 === source.fixtureSha256
        );
      }),
  );
  // Compatibility with the pre-descriptor adapter contract: one explicitly
  // admitted domain for the selected environment. This is not source attestation.
  // An explicit empty descriptor list or failed attestation never takes this path.
  if (
    !matches.length &&
    environmentScopes.length === 1 &&
    environmentScopes[0].querySources === undefined
  ) {
    return {
      environmentId,
      identityDomain: environmentScopes[0].identityDomain,
    };
  }
  return matches.length === 1
    ? {
        environmentId: matches[0].environmentId,
        identityDomain: matches[0].identityDomain,
      }
    : undefined;
}
