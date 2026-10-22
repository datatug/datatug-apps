import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCAL_AGENT_SOURCE = {
  id: 'northwind-local', title: 'Northwind evidence (local agent)', synthetic: true,
  database: 'http://127.0.0.1:6832/v1/databases/northwind_evidence',
  collections: [
    { id: 'fulfillment_events', title: 'Fulfillment events' },
    { id: 'carrier_events', title: 'Carrier events' },
  ],
  fields: {
    timestamp: 'timestamp', severity: 'severity', service: 'service', origin: 'source', message: 'message',
    correlation: 'correlation_id', reference: 'source_ref', raw: 'raw', parser: 'parser',
    parseStatus: 'parse_status', structured: 'fields_json',
  },
  identifiers: [{ field: 'order_id', label: 'Order ID', param: 'order', type: 'string' }],
  window: { from: '2018-04-21T09:12:00Z', to: '2018-04-21T09:14:00Z' },
  records: [],
};

const SHIPPING_SOURCE = {
  id: 'shipping-logs', title: 'Shipping logs', synthetic: true,
  database: 'https://ovdb.demodb.dev/v1/databases/shipping-logs',
  collections: [{ id: 'baseline', title: 'Shipping events' }],
  fields: { timestamp: 'occurred_at', sequence: 'sequence', message: 'kind', reference: 'event_id' },
  identifiers: [{ field: 'order_id', label: 'Order ID', param: 'order', type: 'integer' }],
  window: { from: '2018-04-01T00:00:00Z', to: '2018-05-21T00:00:00Z' },
  records: [],
};

/**
 * A one-commit demo project for the fake GitHub. The public demo project no longer declares the loopback
 * `northwind-local` source (a hosted page must never call the visitor's machine); local runs of the viewer
 * against `datatug serve` need it, so the specs declare it here. `withShipping` adds the public source.
 */
export function demoProjectDeclaringLogs(options: { withShipping?: boolean } = {}): { dir: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'datatug-log-sources-'));
  const project = join(dir, 'demo-project-1');
  mkdirSync(join(project, 'connections'), { recursive: true });
  writeFileSync(join(project, 'datatug-project.json'), JSON.stringify({ id: 'datatug-demo-project', title: 'Log sources fixture' }));
  writeFileSync(join(project, 'connections/log-sources.json'), JSON.stringify({
    format: 'datatug-log-sources/v1',
    sources: [...(options.withShipping ? [SHIPPING_SOURCE] : []), LOCAL_AGENT_SOURCE],
  }));
  execFileSync('git', ['-C', dir, 'init', '--quiet']);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=E2E', '-c', 'user.email=e2e@example.test', 'commit', '--quiet', '-m', 'log sources']);
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}
