/** Shared with datatug-core: ASCII normalization, Unicode scalar comparison. */
export function normalizedEnvironmentId(id: string): string {
  assertScalarString(id);
  return id.replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/[ ._-]/g, '');
}

export function assertScalarString(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Invalid Unicode environment ID');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error('Invalid Unicode environment ID');
    }
  }
}

export function scalarCompare(a: string, b: string): number {
  assertScalarString(a);
  assertScalarString(b);
  const left = Array.from(a, (c) => c.codePointAt(0)!);
  const right = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

const stages = [
  ['local', 'localhost', 'sandbox'],
  ['dev', 'development', 'demo'],
  ['qa', 'test', 'testing', 'qualityassurance'],
  ['uat', 'useracceptance', 'stage', 'staging', 'preprod', 'preproduction'],
  [],
  ['prod', 'production', 'live'],
];
const stage = (id: string): number => {
  const rank = stages.findIndex((aliases) => aliases.includes(id));
  return rank < 0 ? 4 : rank;
};

export function compareEnvironmentIds(a: string, b: string): number {
  const left = normalizedEnvironmentId(a);
  const right = normalizedEnvironmentId(b);
  return stage(left) - stage(right) || scalarCompare(left, right) || scalarCompare(a, b);
}

/** Never drops a live ID; saved order is exact/case-sensitive project metadata. */
export function resolveEnvironmentOrder<T extends { readonly id: string }>(
  environments: readonly T[],
  savedOrder?: readonly string[] | null,
): { items: T[]; order: string[]; needsRepair: boolean } {
  const byId = new Map<string, T>();
  for (const environment of environments) {
    assertScalarString(environment.id);
    if (byId.has(environment.id)) throw new Error('Duplicate live environment ID');
    byId.set(environment.id, environment);
  }
  const items: T[] = [];
  for (const id of savedOrder || []) {
    assertScalarString(id);
    const item = byId.get(id);
    if (item) { items.push(item); byId.delete(id); }
  }
  const missing = [...byId.values()].sort((a, b) => compareEnvironmentIds(a.id, b.id));
  items.push(...missing);
  const order = items.map((item) => item.id);
  const needsRepair = savedOrder != null &&
    (savedOrder.length !== order.length || savedOrder.some((id, i) => id !== order[i]));
  return { items, order, needsRepair };
}
