import { decodeTypedValue, type TypedValue } from '@sneat/datatug-semantic';
import {
  canonicalSet,
  detectiveParameterName,
  detectiveSlug,
} from '../detective/detective-forms';
import { DetectiveInputValue } from '../detective/models';
import { exact, object, nativeToken } from './native-semantic-contract';

export type NativePreflightState =
  | 'input-bindable'
  | 'missing/incompatible-input'
  | 'invalid/unavailable-definition'
  | 'deferred-row-binding';
export interface NativeCheckSuggestion {
  title: string;
  id: string;
  revision: string;
  definitionDigest: string;
  ready: boolean;
  bindings: Record<string, DetectiveInputValue>;
  preflight: { state: NativePreflightState; checkId: string; stepId?: string };
}
export interface NativeQuerySuggestion {
  id: string;
  revision: string;
  ready: boolean;
  bindings: Record<string, Exclude<DetectiveInputValue, { type: 'range' }>>;
  missingInputs: string[];
  unsupportedReason?: string;
}
export interface NativeApplicable {
  queries: NativeQuerySuggestion[];
  checks: NativeCheckSuggestion[];
}
export const nativePreflightLabels: Record<
  NativePreflightState,
  { label: string; detail: string }
> = {
  'input-bindable': {
    label: 'Inputs ready',
    detail:
      'Current inputs can bind. No Check result or permission to run is implied.',
  },
  'missing/incompatible-input': {
    label: 'Needs input',
    detail: 'Required input is missing or incompatible.',
  },
  'deferred-row-binding': {
    label: 'Needs row data',
    detail: 'Some bindings require rows from a later execution.',
  },
  'invalid/unavailable-definition': {
    label: 'Unavailable',
    detail: 'The saved definition or its dependencies are unavailable.',
  },
};
function unavailable(): never {
  throw new Error('Check suggestions are unavailable.');
}
function text(v: unknown, nonblank = false): string {
  if (
    typeof v !== 'string' ||
    new TextEncoder().encode(v).length > 4096 ||
    (nonblank && !v.trim())
  )
    unavailable();
  return v;
}
function list(v: unknown, max = 1000): unknown[] {
  if (!Array.isArray(v) || v.length > max) unavailable();
  return v;
}
function scalar(v: unknown): TypedValue {
  const value = decodeTypedValue(v);
  if (typeof value.value === 'string') text(value.value);
  return value;
}
// Compare decimal text without rounding large integers or close decimal bounds.
function decimalAfter(a: string, b: string): boolean {
  const digits = Math.max(
    a.split('.')[1]?.length || 0,
    b.split('.')[1]?.length || 0,
  );
  const scaled = (v: string) => {
    const [whole, fraction = ''] = v.split('.');
    return BigInt(whole + fraction.padEnd(digits, '0'));
  };
  return scaled(a) > scaled(b);
}
function timeKey(value: string): [number, string] {
  const [day, time] = value.split('T');
  if (!time) return [Date.parse(day), ''];
  const [clock, fraction = ''] = time.slice(0, -1).split(/[.,]/u);
  return [
    Date.parse(day + 'T' + clock.padStart(8, '0') + 'Z'),
    fraction.slice(0, 9).padEnd(9, '0'),
  ];
}
export function decodeNativeCheckInput(v: unknown): DetectiveInputValue {
  const o = object(v);
  if (o['type'] === 'set') {
    exact(o, ['type', 'values']);
    const values = list(o['values'], 500).map(scalar);
    const canonical = canonicalSet(values);
    if (JSON.stringify(canonical.values) !== JSON.stringify(values))
      unavailable();
    return canonical;
  }
  if (o['type'] !== 'range') return scalar(o);
  exact(o, ['type', 'start', 'end']);
  const start = scalar(o['start']),
    end = scalar(o['end']);
  if (start.type !== end.type) unavailable();
  switch (start.type) {
    case 'integer':
    case 'decimal':
      if (decimalAfter(String(start.value), String(end.value))) unavailable();
      break;
    case 'number':
      if (Number(start.value) > Number(end.value)) unavailable();
      break;
    case 'date':
    case 'datetime': {
      const a = timeKey(String(start.value)),
        b = timeKey(String(end.value));
      if (
        !Number.isFinite(a[0]) ||
        !Number.isFinite(b[0]) ||
        a[0] > b[0] ||
        (a[0] === b[0] && a[1] > b[1])
      )
        unavailable();
      break;
    }
    default:
      unavailable();
  }
  return { type: 'range', start, end };
}
function bindings(
  v: unknown,
  range: boolean,
): Record<string, DetectiveInputValue> {
  const entries = Object.entries(object(v));
  if (entries.length > 1000) unavailable();
  return Object.fromEntries(
    entries.map(([name, raw]) => {
      if (!detectiveParameterName.test(name)) unavailable();
      const value = decodeNativeCheckInput(raw);
      if (!range && value.type === 'range') unavailable();
      return [name, value];
    }),
  );
}
function check(v: unknown): NativeCheckSuggestion {
  const o = exact(v, [
    'title',
    'id',
    'revision',
    'definitionDigest',
    'ready',
    'bindings',
    'preflight',
  ]);
  const p = exact(o['preflight'], ['state', 'checkId'], ['stepId']);
  const state = p['state'];
  if (
    typeof state !== 'string' ||
    !Object.hasOwn(nativePreflightLabels, state) ||
    typeof o['ready'] !== 'boolean' ||
    o['ready'] !== (state === 'input-bindable') ||
    typeof o['id'] !== 'string' ||
    !detectiveSlug.test(o['id']) ||
    typeof p['checkId'] !== 'string' ||
    !detectiveSlug.test(p['checkId']) ||
    (p['stepId'] !== undefined &&
      (typeof p['stepId'] !== 'string' || !detectiveSlug.test(p['stepId']))) ||
    typeof o['revision'] !== 'string' ||
    !/^[1-9][0-9]{0,18}$/u.test(o['revision']) ||
    BigInt(o['revision']) > 9223372036854775807n ||
    !nativeToken(o['definitionDigest'])
  )
    unavailable();
  return {
    title: text(o['title'], true),
    id: o['id'],
    revision: o['revision'],
    definitionDigest: o['definitionDigest'],
    ready: o['ready'],
    bindings: bindings(o['bindings'], true),
    preflight: {
      state: state as NativePreflightState,
      checkId: p['checkId'],
      ...(p['stepId'] !== undefined ? { stepId: p['stepId'] as string } : {}),
    },
  };
}
function query(v: unknown): NativeQuerySuggestion {
  const o = exact(
    v,
    ['id', 'revision', 'ready', 'bindings', 'missingInputs'],
    ['unsupportedReason'],
  );
  const id = text(o['id'], true),
    revision = text(o['revision'], true);
  if (
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(id) ||
    !/^q1-[a-f0-9]{64}$/u.test(revision) ||
    typeof o['ready'] !== 'boolean'
  )
    unavailable();
  const missingInputs = list(o['missingInputs']).map((v) => {
    if (typeof v !== 'string' || !detectiveParameterName.test(v)) unavailable();
    return v;
  });
  if (new Set(missingInputs).size !== missingInputs.length) unavailable();
  return {
    id,
    revision,
    ready: o['ready'],
    bindings: bindings(
      o['bindings'],
      false,
    ) as NativeQuerySuggestion['bindings'],
    missingInputs,
    ...(o['unsupportedReason'] !== undefined
      ? { unsupportedReason: text(o['unsupportedReason']) }
      : {}),
  };
}
export function decodeNativeApplicable(v: unknown): NativeApplicable {
  const o = exact(v, ['queries', 'checks']);
  if (new TextEncoder().encode(JSON.stringify(o)).length > 150 * 1024)
    unavailable();
  const queries = list(o['queries']).map(query),
    checks = list(o['checks']).map(check);
  if (
    new Set(queries.map((q) => q.id)).size !== queries.length ||
    new Set(checks.map((c) => c.id)).size !== checks.length
  )
    unavailable();
  return { queries, checks };
}
