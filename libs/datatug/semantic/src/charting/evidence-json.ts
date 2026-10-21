import { verifyRowEvidence } from './row-evidence';
import { decodeResult } from '../contract/decoders';
import type { Result } from '../contract/types';

/** Preserve duplicate-key rejection before JSON.parse discards wire information. */
export async function decodeEvidenceResultJSON(raw: string): Promise<Result> {
  const stack: { keys?: Set<string>; key: boolean }[] = [];
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}[\],:]|[^\s{}[\],:"]+/g;
  for (const match of raw.matchAll(tokens)) {
    const token = match[0];
    const current = stack[stack.length - 1];
    if (token.startsWith('"') && current?.keys && current.key) {
      const name = JSON.parse(token) as string;
      if (current.keys.has(name))
        throw new Error('Duplicate evidence JSON member');
      current.keys.add(name);
      current.key = false;
    } else if (token === '{') stack.push({ keys: new Set(), key: true });
    else if (token === '[') stack.push({ key: false });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && current?.keys) current.key = true;
  }
  const result = decodeResult(JSON.parse(raw));
  if (result.rowEvidence) await verifyRowEvidence(result.rowEvidence, result);
  return result;
}
