// What the page shows while a local DemoDB copy is prepared.
//
// `openDemoDb({ onProgress })` of @dalgo/sqlite-wasm/opfs reports the dataset worker's
// phases: `fetch` (with `loaded`/`total` bytes), then `verify`, `importPristine`,
// `importWorking` and `open` (which have no byte counts worth showing). DataTug
// shows the first as the download bar and the others as install steps.

/** The shape of `DemoDbProgressEvent` (structural, so this file imports nothing). */
export interface DemoDbProgressEventLike {
  readonly phase: string;
  readonly loaded?: number;
  readonly total?: number;
}

export type DemoDbInstallStep = 'verify' | 'importPristine' | 'importWorking' | 'open';

export type DemoDbProgress =
  /** `loaded` counts decoded bytes (after the browser undid gzip); `total` is absent when unknown. */
  | { readonly phase: 'download'; readonly loaded: number; readonly total?: number }
  | { readonly phase: 'install'; readonly step: DemoDbInstallStep };

const installSteps: readonly string[] = ['verify', 'importPristine', 'importWorking', 'open'];

/** The progress to show for an upstream event; undefined for a phase this version does not know. */
export function mapDemoDbProgress(event: DemoDbProgressEventLike): DemoDbProgress | undefined {
  if (event.phase === 'fetch') {
    return {
      phase: 'download',
      loaded: event.loaded ?? 0,
      ...(typeof event.total === 'number' ? { total: event.total } : {}),
    };
  }
  return installSteps.includes(event.phase) ? { phase: 'install', step: event.phase as DemoDbInstallStep } : undefined;
}
