import { AgentCell, AgentForeignKey, AgentTableRef } from './agent-link-api.service';

/**
 * A foreign-key hop of a record (Feature claude-mod-web-links, plan Task 9): the record of `refTable` that a foreign
 * key of this record points at, opened by the same record route, its key built from this record's typed values.
 */
export interface RecordHop {
  readonly fk: AgentForeignKey;
  /** The router commands of the referenced record's page (no key in them). */
  readonly commands: readonly string[];
  readonly schema: string;
  /** `pk=<JSON>`: the key, only ever in the fragment. */
  readonly fragment: string;
}

const INTEGER_TEXT = /^-?(?:0|[1-9]\d*)$/;

/** A typed cell as a JSON key value: an integer as its exact digits (never through a number), a string as JSON. */
function keyLiteral(cell: AgentCell | undefined): string | undefined {
  if (!cell) return undefined;
  if (cell.type === 'integer' && INTEGER_TEXT.test(cell.text) && cell.text !== '-0') return cell.text;
  if (cell.type === 'string' && cell.text.length <= 256) return JSON.stringify(cell.text);
  return undefined; // null, decimal, date, bytes…: the record lookup takes integer and string keys only
}

/**
 * The hops of a record: one per foreign key whose every column holds an integer or string value. A key with a null
 * or another type of value has no hop. The referenced record is named by the referenced columns and these values,
 * in the order of the key.
 */
export function recordHops(
  ref: AgentTableRef,
  foreignKeys: readonly AgentForeignKey[],
  columns: readonly string[],
  cells: readonly AgentCell[],
): RecordHop[] {
  const hops: RecordHop[] = [];
  for (const fk of foreignKeys) {
    const parts: string[] = [];
    for (let i = 0; i < fk.columns.length; i++) {
      const literal = keyLiteral(cells[columns.indexOf(fk.columns[i])]);
      if (literal === undefined) break;
      parts.push(`${JSON.stringify(fk.refColumns[i])}:${literal}`);
    }
    if (parts.length !== fk.columns.length) continue;
    hops.push({
      fk,
      commands: ['/store', ref.storeId, 'project', ref.project, 'env', ref.env, 'db', ref.source, 'table', fk.refTable.name, 'record'],
      schema: fk.refTable.schema,
      fragment: `pk={${parts.join(',')}}`,
    });
  }
  return hops;
}
