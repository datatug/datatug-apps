import { parseTugQL } from '@dalgo/core';

export type AuthorInvoiceIdFilterEdit =
  | { readonly ok: true; readonly before: string; readonly after: string }
  | { readonly ok: false; readonly reason: string };

const record = (
  value: unknown,
): Readonly<Record<string, unknown>> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/** Change one admitted InvoiceId literal while retaining every other source byte. */
export function useInvoiceIdAsAuthorFilter(
  source: string,
  invoiceId: string,
): AuthorInvoiceIdFilterEdit {
  try {
    if (
      !/^[1-9]\d*$/u.test(invoiceId) ||
      !Number.isSafeInteger(Number(invoiceId))
    )
      throw new Error('Choose a positive, exactly representable Invoice ID.');
    const parsed = parseTugQL(source);
    const tree = parsed.document.tree;
    if (parsed.diagnostics.length || !tree)
      throw new Error(
        'This draft has TugQL diagnostics. Correct it before filtering.',
      );
    if (tree.definitions?.length)
      throw new Error(
        'This filter is available for a direct Invoice query, not a WITH or imported source.',
      );
    const query = record(tree.query);
    const from = record(query?.['from']);
    const alias = from?.['alias'] ?? from?.['name'];
    if (
      from?.['name'] !== 'Invoice' ||
      typeof alias !== 'string' ||
      !/^[A-Za-z_]\w*$/u.test(alias) ||
      from['database'] !== undefined ||
      (from['schema'] !== undefined && from['schema'] !== 'main')
    )
      throw new Error(
        'Only the admitted main.Invoice source can use this filter.',
      );
    const where = record(query?.['where']);
    const clauses = Array.isArray(where?.['and']) ? where['and'] : undefined;
    const guard = record(clauses ? clauses[0] : where);
    const left = record(guard?.['left']);
    const right = record(guard?.['right']);
    if (
      (clauses && clauses.length !== 2) ||
      (!clauses && where?.['and'] !== undefined) ||
      guard?.['op'] !== '==' ||
      left?.['field'] !== 'CustomerId' ||
      left['source'] !== alias ||
      right?.['param'] !== 'CustomerId'
    )
      throw new Error(
        'Keep the declared Invoice.CustomerId filter before using a row value.',
      );
    const previous = record(clauses?.[1]);
    if (
      clauses &&
      (Object.keys(where ?? {}).length !== 1 ||
        previous?.['op'] !== '==' ||
        record(previous['left'])?.['field'] !== 'InvoiceId' ||
        record(previous['left'])?.['source'] !== alias ||
        typeof record(previous['right'])?.['value'] !== 'number' ||
        !Number.isSafeInteger(record(previous['right'])?.['value']) ||
        (record(previous['right'])?.['value'] as number) <= 0)
    )
      throw new Error(
        'This draft has another predicate that cannot be replaced safely.',
      );
    if (
      !clauses &&
      Object.keys(where ?? {}).some(
        (key) => !['op', 'left', 'right'].includes(key),
      )
    )
      throw new Error(
        'This draft has another predicate that cannot be changed safely.',
      );

    const lines =
      source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)?.filter(Boolean) ?? [];
    const pattern = new RegExp(
      `^(\\s*where\\s+${alias}\\.CustomerId\\s*=\\s*@CustomerId)(\\s+and\\s+${alias}\\.InvoiceId\\s*=\\s*([1-9]\\d*))?(\\s*(?:--.*)?)$`,
      'iu',
    );
    const matches = lines.flatMap((line, index) => {
      const text = line.replace(/\r\n$|\n$|\r$/u, '');
      const match = pattern.exec(text);
      return match ? [{ index, match, line }] : [];
    });
    if (matches.length !== 1)
      throw new Error(
        'The exact WHERE line is unavailable. Edit this filter in TugQL Code.',
      );
    const { index, match, line } = matches[0];
    if (
      !!clauses !== !!match[2] ||
      (clauses && Number(match[3]) !== record(previous?.['right'])?.['value'])
    )
      throw new Error('The authored WHERE line differs from the parsed draft.');
    const ending = /\r\n$|\n$|\r$/u.exec(line)?.[0] ?? '';
    const condition = match[2]
      ? match[2].slice(0, -(match[3]?.length ?? 0)) + invoiceId
      : ` ${/\bWHERE\b/u.test(match[1]) ? 'AND' : 'and'} ${alias}.InvoiceId = ${invoiceId}`;
    lines[index] = `${match[1]}${condition}${match[4] ?? ''}${ending}`;
    const after = lines.join('');
    const next = parseTugQL(after);
    if (next.diagnostics.length || !next.document.tree)
      throw new Error('The proposed filter does not parse as TugQL.');
    const expected = structuredClone(tree) as unknown as Record<
      string,
      unknown
    >;
    const expectedQuery = expected['query'] as Record<string, unknown>;
    expectedQuery['where'] = {
      and: [
        structuredClone(guard),
        {
          op: '==',
          left: { field: 'InvoiceId', source: alias },
          right: { value: Number(invoiceId) },
        },
      ],
    };
    if (JSON.stringify(expected) !== JSON.stringify(next.document.tree))
      throw new Error(
        'The proposed edit changes more than the InvoiceId filter.',
      );
    return { ok: true, before: source, after };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? error.message
          : 'The filter could not be applied safely.',
    };
  }
}
