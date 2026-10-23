import { parseDocument as parseYamlDocument } from 'yaml';
import {
  QueryType,
  type IQueryRequest,
  type ITextQueryRequest,
} from '../models/definition/query-def';

/** A TugQL body is the structured YAML form only when its source positively names a
 * YAML or JSON query document. TugQL diagnostics are never evidence of a format switch.
 * Used when a request carries no explicit `representation`. */
export const isTugqlYamlSource = (source: string): boolean => {
  const normalized = source.replace(/^\uFEFF/u, '');
  const firstLine =
    normalized
      .split(/\r?\n/u)
      .find(
        (line) =>
          line.trim() &&
          !line.trimStart().startsWith('#') &&
          !/^(?:---|\.\.\.)(?:\s|$)/u.test(line.trimStart()) &&
          !/^%(?:YAML|TAG)\b/u.test(line.trimStart()),
      )
      ?.trimStart() ?? '';
  // All root keys accepted by @dalgo/core's TugQL document model. A known
  // mapping key keeps an incomplete YAML draft in its original editor.
  if (
    /^(?:from|where|orderBy|limit|offset|columns|groupBy|having|money):(?:\s|$)/u.test(
      firstLine,
    )
  )
    return true;
  try {
    // The actual YAML reader also accepts JSON and flow mappings. This only
    // identifies the saved source format; query validity remains the engine's job.
    const parsed = parseYamlDocument(normalized, {
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
    });
    if (parsed.errors.length) return false;
    const document: unknown = parsed.toJS();
    return (
      !!document &&
      typeof document === 'object' &&
      !Array.isArray(document) &&
      Object.hasOwn(document, 'from')
    );
  } catch {
    return false;
  }
};

/**
 * True when the request is a TugQL query written in the structured YAML form
 * (`<id>.query.tugql.yaml`). The request's explicit `representation` wins; a
 * request without one is sniffed from its body.
 */
export const isTugqlYamlRequest = (
  request: IQueryRequest | undefined,
): request is ITextQueryRequest => {
  if (request?.queryType !== QueryType.TugQL) return false;
  const { representation, text } = request as ITextQueryRequest;
  if (representation) return representation === 'yaml';
  return isTugqlYamlSource(text ?? '');
};
