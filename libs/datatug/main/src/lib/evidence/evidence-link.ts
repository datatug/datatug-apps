import {
  decodeEvidenceArtifactRef,
  type ArtifactRef,
  type ExecutionRef,
} from '@sneat/datatug-semantic';
import { isSharedProjectRef, type IProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';

/**
 * evidence-records REQ:copyable-evidence-link. A link names one retained run of a native hosted (Space) project:
 * the project's overview route plus `#evidence=<payload>`, base64url JSON `{"v":1,"environment","target"}`. It
 * carries identifiers only, never a token, row value, fingerprint or query text, and lives only in the fragment.
 * Opening it reads through the ordinary rights-checked retained reads.
 */
export type EvidenceLinkTarget =
  | { readonly kind: 'execution'; readonly execution: ExecutionRef }
  | Extract<ArtifactRef, { kind: 'check-run' }>;
export interface EvidenceLink {
  readonly environment: string;
  readonly target: EvidenceLinkTarget;
}

export const EVIDENCE_LINK_PREFIX = 'evidence=';
const MAX_PAYLOAD = 2048;
const ENVIRONMENT = /^[A-Za-z0-9_-]{1,128}$/u;

function unsupported(): never {
  throw new Error('This evidence link cannot be opened.');
}

/** Only a native hosted project's own runs can be linked. */
export function linkableProject(ref: IProjectRef | undefined): boolean {
  return (
    !!ref &&
    isSharedProjectRef(ref) &&
    ref.branch === undefined &&
    ref.projectApi === undefined
  );
}

/** The closed decoder: exactly v/environment/target, kinds execution and check-run, same store and project. */
export function readEvidenceLink(
  value: unknown,
  ref: IProjectRef | undefined,
): EvidenceLink {
  if (!linkableProject(ref) || !ref) unsupported();
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== 'environment,target,v'
  )
    unsupported();
  const wire = value as Record<string, unknown>;
  if (
    wire['v'] !== 1 ||
    typeof wire['environment'] !== 'string' ||
    !ENVIRONMENT.test(wire['environment'])
  )
    unsupported();
  const environment = wire['environment'];
  let target: ArtifactRef;
  try {
    target = decodeEvidenceArtifactRef(wire['target']);
  } catch {
    unsupported();
  }
  if (target.kind === 'execution') {
    if (
      target.execution.storeId !== ref.storeId ||
      target.execution.projectId !== ref.projectId
    )
      unsupported();
    return {
      environment,
      target: { kind: 'execution', execution: target.execution },
    };
  }
  if (target.kind === 'check-run') {
    if (
      target.checkRun.storeId !== ref.storeId ||
      target.checkRun.projectId !== ref.projectId ||
      target.checkRun.environment !== environment ||
      !Number.isSafeInteger(target.checkRun.checkVersion) ||
      target.checkRun.checkVersion < 1
    )
      unsupported();
    return { environment, target };
  }
  unsupported();
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

function fromBase64Url(text: string): string {
  if (!text || text.length > MAX_PAYLOAD || !/^[A-Za-z0-9_-]+$/u.test(text))
    unsupported();
  try {
    const binary = atob(text.replace(/-/gu, '+').replace(/_/gu, '/'));
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
  } catch {
    unsupported();
  }
}

/** `evidence=<payload>` for a validated link. */
export function evidenceLinkFragment(
  link: EvidenceLink,
  ref: IProjectRef | undefined,
): string {
  const checked = readEvidenceLink(
    { v: 1, environment: link.environment, target: link.target },
    ref,
  );
  return (
    EVIDENCE_LINK_PREFIX +
    toBase64Url(
      JSON.stringify({
        v: 1,
        environment: checked.environment,
        target: checked.target,
      }),
    )
  );
}

/** The absolute link to copy; undefined when this evidence cannot be linked. */
export function evidenceLinkUrl(
  origin: string,
  ref: IProjectRef | undefined,
  link: EvidenceLink,
): string | undefined {
  try {
    const fragment = evidenceLinkFragment(link, ref);
    return origin + projectPageHref(ref, ['overview']) + '#' + fragment;
  } catch {
    return undefined;
  }
}

/** undefined: the fragment is not an evidence link at all. Throws: it is one, but cannot be opened. */
export function parseEvidenceFragment(
  fragment: string | null | undefined,
  ref: IProjectRef | undefined,
): EvidenceLink | undefined {
  if (!fragment || !fragment.startsWith(EVIDENCE_LINK_PREFIX)) return undefined;
  const json = fromBase64Url(fragment.slice(EVIDENCE_LINK_PREFIX.length));
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    unsupported();
  }
  return readEvidenceLink(value, ref);
}
