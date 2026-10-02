import type { ProvenanceClass } from '../../chat/chat-trace.types';

// One distinct silhouette per provenance class, so meaning never rests on colour alone.
// Ported from the DataTug.ai site kit (datatug/datatug-io, packages/site-kit/src/provenance.ts) so the
// product and the site show the same markers. 16x16 viewBox.
export const PROVENANCE_GLYPH: Readonly<Record<ProvenanceClass, { readonly d: string; readonly fill: boolean; readonly dash?: boolean }>> = {
  schema: { d: 'M3.5 3.5h9v9h-9z', fill: true },
  declared: { d: 'M8 2l6 6-6 6-6-6z', fill: true },
  'human-confirmed': { d: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zm-1.1 8.6L4.6 8.1l1-1 1.3 1.3 3.5-3.5 1 1z', fill: true },
  verified: { d: 'M8 1.6l5.3 3v6.8L8 14.4l-5.3-3V4.6z', fill: true },
  observed: { d: 'M8 2a6 6 0 1 0 0 12V2z', fill: true },
  'inferred-from-data': { d: 'M2.4 13.6V2.4a11.2 11.2 0 0 1 11.2 11.2z', fill: true },
  'ai-suggested': { d: 'M8 2.2l6 10.6H2z', fill: false },
  hypothesis: { d: 'M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', fill: false, dash: true },
};
