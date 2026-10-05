import { vi } from 'vitest';
import profile from './native-graph-profile.json';
import metadataFixture from './native-graph-metadata-fixture.json';
import {
  parseNativeGraphEnvelope,
  type NativeStageId,
} from './native-graph-contract';
import type { NativeGraphPlan } from './native-graph-executor';
import type { BoundedRecord } from './bounded-federation';
import { RUNTIME_PIN_HEADERS } from './runtime-read-pins';
const records = (rows: readonly Record<string, unknown>[]): BoundedRecord[] =>
  rows.map((data, i) => ({ key: String(i), data }));
/** Hypothetical pinned mounts used only by low-level execution/storage fixtures. No canonical admission. */
export function graphFixturePlan(aliases = true, rows = 1000): NativeGraphPlan {
  const envelope = parseNativeGraphEnvelope(metadataFixture.envelope);
  return structuredClone({
    envelope,
    attachment: metadataFixture.attachment,
    references: metadataFixture.references,
    canonical: metadataFixture.canonical,
    aliases,
    selection: { offset: 0, rows, fingerprint: 'b'.repeat(64) },
    stages: Object.fromEntries(
      profile.stages.map((stage) => {
        const source = profile.sources[stage.source as 'ror' | 'geo'];
        const fields = [
          ...new Set([
            ...stage.grain,
            ...profile.edges
              .filter((e) => e.from === stage.id)
              .flatMap((e) => e.fields),
            ...profile.edges
              .filter((e) => e.to === stage.id)
              .map((e) => e.lookupField),
          ]),
        ];
        return [
          stage.id,
          {
            database: stage.source,
            collection: stage.entity,
            publisherManifest: metadataFixture.publishers[stage.source as 'ror' | 'geo'],
            nativeSnapshot: source.snapshot,
            nativeDataset: source.dataset,
            fields,
            grain: stage.grain,
            runtime: {
              providerRevision: source.model.revision,
              sourceSha256: source.dataset.sha256,
              servingSha256: 'c'.repeat(64),
              manifestSha256: 'd'.repeat(64),
            },
          },
        ];
      }),
    ) as unknown as NativeGraphPlan['stages'],
  });
}
export function graphFixtureTransport(
  p: NativeGraphPlan,
  input: Record<string, readonly Record<string, unknown>[]>,
) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const q = JSON.parse(String(init?.body)),
      id = profile.stages.find((s) => s.entity === q.from.name)
        ?.id as NativeStageId;
    const field = q.where.left.field,
      values = q.where.right.values as string[];
    const data = records(input[id] ?? [])
      .filter((r) => values.includes(r.data[field] as string))
      .slice(q.offset, q.offset + q.limit);
    const headers = Object.fromEntries(
      Object.entries(RUNTIME_PIN_HEADERS).map(([name, header]) => [
        header,
        p.stages[id].runtime[name as keyof typeof RUNTIME_PIN_HEADERS],
      ]),
    );
    return new Response(JSON.stringify({ records: data }), { headers });
  });
}

/** The fixture answers original bytes, through the production reader; it grants no admission. */
export const graphFixtureMetadataTransport: typeof fetch = async (url) => {
  const raw = (metadataFixture.metadata as Record<string, string>)[String(url)];
  return new Response(raw ?? 'missing', { status: raw === undefined ? 404 : 200 });
};
