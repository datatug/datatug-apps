import { InjectionToken } from '@angular/core';
import type { SourceDetails } from '../source-workspace/source-workspace-contract';
export interface OriginalEvidencePresentation {
  readonly status: 'available' | 'unavailable';
  readonly reason?: string;
  readonly summary?: string;
  readonly notices?: readonly string[];
  readonly emptyMessage?: string;
  readonly records?: readonly {
    readonly title: string;
    readonly facts: readonly {
      readonly label: string;
      readonly value: string;
      readonly emphasized?: boolean;
    }[];
    readonly fields: readonly {
      readonly label: string;
      readonly value: string;
    }[];
  }[];
  readonly log?: {
    readonly artifact: string;
    readonly byteStart: number;
    readonly byteEnd: number;
    readonly artifactBytes: number;
    readonly parser: string;
    readonly parseStatus: string;
    readonly artifactSHA256: string;
    readonly sourceRef: string;
    readonly text?: string;
    readonly rawBase64: string;
  };
}
/** Deployment adapters project validated source records. Descriptors grant no read rights. */
export interface SourceEvidencePresenter {
  readonly sourceId: string;
  operation(value: unknown): SourceDetails;
  original(value: unknown): OriginalEvidencePresentation;
}
export const SOURCE_EVIDENCE_PRESENTERS = new InjectionToken<
  readonly SourceEvidencePresenter[]
>('source evidence presentation adapters', {
  providedIn: 'root',
  factory: () => [],
});
export function sourceEvidencePresenter(
  presenters: readonly SourceEvidencePresenter[],
  sourceId: string,
): SourceEvidencePresenter | undefined {
  const matches = presenters.filter((item) => item.sourceId === sourceId);
  return matches.length === 1 ? matches[0] : undefined;
}
