import { decodeTypedValue, type TypedValue } from '@sneat/datatug-semantic';
import {
  ContextCapabilities,
  ContextSnapshot,
  SessionScope,
  sameContextScope,
  sameContextSubject,
} from '../session-context/session-context-contract';

export interface AppliedEvidenceRequest {
  readonly retention: 'project-pinned';
  readonly incidentRef: string;
  readonly caseId?: string;
  readonly context: {
    readonly sessionId: string;
    readonly expectedSessionVersion: number;
    readonly expectedContextSetId: string;
    readonly scope: SessionScope;
    readonly bindings: readonly {
      readonly inputName: string;
      readonly entryId: string;
      readonly revisionId: string;
    }[];
  };
}
export interface AppliedEvidenceChoice {
  readonly evidence: AppliedEvidenceRequest;
  readonly value: TypedValue;
  readonly bagId: string;
  readonly label: string;
}
/** Selection is only a request for server admission. No manifest or provenance
 * is synthesized here; the server re-reads all native revisions and rights. */
export function appliedEvidenceChoices(
  capabilities: ContextCapabilities,
  snapshot: ContextSnapshot,
  environment: string,
  incidentRef: string,
  caseId?: string,
): readonly AppliedEvidenceChoice[] {
  if (
    snapshot.session.databaseId !== capabilities.databaseId ||
    snapshot.session.projectId !== capabilities.projectId ||
    snapshot.session.owner !== capabilities.actorId ||
    snapshot.session.state !== 'active' ||
    !snapshot.contextSet.enabled ||
    !incidentRef
  )
    return [];
  const choices: AppliedEvidenceChoice[] = [];
  for (const slot of snapshot.contextSet.slots) {
    if (slot.scope.environmentId !== environment) continue;
    const bag = snapshot.bags.find((item) => item.id === slot.bagId);
    if (
      !bag ||
      !sameContextScope(bag.scope, slot.scope) ||
      bag.version !== slot.bagVersion
    )
      continue;
    for (const ref of slot.entries) {
      const revision = snapshot.revisions.find(
        (item) =>
          item.entryId === ref.entryId &&
          item.id === ref.revisionId &&
          item.bagId === bag.id,
      );
      const entry = snapshot.entries.find(
        (item) => item.id === ref.entryId && item.bagId === bag.id,
      );
      if (
        !revision ||
        !entry ||
        revision.value.kind !== 'scalar' ||
        !revision.value.scalar
      )
        continue;
      const subject = capabilities.subjects?.find(
        (item) =>
          sameContextScope(item.scope, slot.scope) &&
          sameContextSubject(item.subject, revision.subject) &&
          item.shape === 'scalar' &&
          item.type === revision.value.scalar?.type,
      );
      if (!subject) continue;
      const value = decodeTypedValue(revision.value.scalar);
      choices.push({
        value,
        bagId: bag.id,
        label: `${snapshot.session.title} · ${bag.title} · ${subject.label} (${subject.subject.fieldId}) · ${String(value.value)} · revision ${revision.id}`,
        evidence: {
          retention: 'project-pinned',
          incidentRef,
          ...(caseId ? { caseId } : {}),
          context: {
            sessionId: snapshot.session.id,
            expectedSessionVersion: snapshot.session.version,
            expectedContextSetId: snapshot.contextSet.id,
            scope: {
              environmentId: slot.scope.environmentId,
              identityDomain: slot.scope.identityDomain,
            },
            bindings: [
              {
                inputName: subject.subject.fieldId,
                entryId: entry.id,
                revisionId: revision.id,
              },
            ],
          },
        },
      });
    }
  }
  return choices;
}
export function requireAppliedInputMatch(
  choice: AppliedEvidenceChoice,
  inputs: Readonly<Record<string, unknown>>,
): void {
  const binding = choice.evidence.context.bindings[0];
  if (
    !binding ||
    Object.keys(inputs).length !== 1 ||
    JSON.stringify(inputs[binding.inputName]) !== JSON.stringify(choice.value)
  )
    throw new Error(
      'The displayed input differs from the selected applied revision. Review the input or explicitly Apply a matching revision in Sessions.',
    );
}
