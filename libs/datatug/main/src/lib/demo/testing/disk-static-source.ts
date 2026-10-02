// Test helpers: serve the demo's static data files from disk, and run the real federated executor over them.
import { readFileSync } from 'node:fs';
import { runFederatedQuery } from '../../queries/federated-query-executor';
import { createStaticOvdbFetch } from '../data/static-ovdb-fetch';
import { readCollection } from '../data/read-collection';
import type { DemoCollectionReader, DemoQueryRunner } from '../investigation/run-saved-plan';
import { demoSourceRuntime } from '../demo-project';
import { must } from './must';
import { assetsDirOnDisk } from './repo-root';

const assets = `${assetsDirOnDisk()}/`;

export const ORIGIN = 'https://demo.example.test';
export const staticRuntime = () => demoSourceRuntime({ kind: 'static' }, ORIGIN);

export function readAsset(database: string, name: string): unknown {
  return JSON.parse(readFileSync(`${assets}${database}/${name}.json`, 'utf8'));
}

/** What the browser would fetch from the published assets, read from the repository instead. */
export function diskFetch(requested: string[] = []): typeof fetch {
  return async (input) => {
    const url = String(input);
    requested.push(url);
    const match = /\/assets\/demo-data\/ovdb\/([^/]+)\/([^/?]+)\.json/.exec(url);
    if (!match) return new Response('not found', { status: 404 });
    try { return new Response(readFileSync(`${assets}${match[1]}/${match[2]}.json`, 'utf8'), { status: 200 }); }
    catch { return new Response('not found', { status: 404 }); }
  };
}

/** The real federated executor reading the static files: the production data path, in-process. */
export function staticRunner(requested: string[] = []): DemoQueryRunner {
  return {
    run: (definition, runtime, hooks) => runFederatedQuery(definition, hooks.onProgress, '', undefined, undefined, 'full', undefined, undefined, {
      fetch: createStaticOvdbFetch(must(runtime.staticSource, 'the static source'), diskFetch(requested)),
      ...(hooks.onSourceLoaded ? { onSourceLoaded: hooks.onSourceLoaded } : {}),
    }),
  };
}

export const staticReader = (requested: string[] = []): DemoCollectionReader => (runtime, database, name) =>
  readCollection({ baseUrl: runtime.baseUrl, ...(runtime.staticSource ? { staticSource: runtime.staticSource } : {}) }, database, name, diskFetch(requested));
