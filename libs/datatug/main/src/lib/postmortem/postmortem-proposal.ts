export interface ProposalFields {
  kind: 'query' | 'check' | 'watch';
  id: string;
  title: string;
  description: string;
  connection: string;
  queryType: string;
  queryText: string;
  queryId: string;
  environment: string;
  checkId: string;
  interval: number;
}
/** Patch common fields without dropping native validators, bindings or advanced settings. */
export function patchProposalDefinition(
  dto: Record<string, unknown>,
  fields: ProposalFields,
): Record<string, unknown> {
  const result = structuredClone(dto);
  result['title'] = fields.title;
  result['id'] = fields.id || String(result['id'] ?? crypto.randomUUID());
  if (fields.kind !== 'watch') result['description'] = fields.description;
  if (fields.kind === 'query') {
    result['connectionId'] = fields.connection;
    result['folderPath'] = result['folderPath'] ?? '/';
    result['request'] = {
      ...((result['request'] as object) ?? {}),
      queryType: fields.queryType,
      text: fields.queryText,
    };
  }
  if (fields.kind === 'check') {
    result['version'] = result['version'] ?? 1;
    result['inputs'] = result['inputs'] ?? [];
    if (fields.queryId) {
      const steps =
        (result['steps'] as Record<string, unknown>[] | undefined) ?? [];
      const index = steps.findIndex((step) => step['kind'] === 'query');
      result['steps'] =
        index < 0
          ? [...steps, { id: 'query', kind: 'query', queryId: fields.queryId }]
          : steps.map((step, i) =>
              i === index ? { ...step, queryId: fields.queryId } : step,
            );
    }
  }
  if (fields.kind === 'watch') {
    result['environment'] = fields.environment;
    result['checkId'] = fields.checkId;
    result['schedule'] = {
      ...((result['schedule'] as object) ?? {}),
      intervalSeconds: fields.interval,
    };
    result['enabled'] = false;
    result['lifecycle'] = 'paused';
    result['version'] = result['version'] ?? 0;
    result['visibility'] = result['visibility'] ?? 'shared';
    result['trigger'] = result['trigger'] ?? 'becomes_false';
    result['mode'] = result['mode'] ?? 'continuous';
    result['initialObservation'] = result['initialObservation'] ?? 'baseline';
    result['notificationPolicy'] = result['notificationPolicy'] ?? {
      recovery: true,
    };
  }
  return result;
}
