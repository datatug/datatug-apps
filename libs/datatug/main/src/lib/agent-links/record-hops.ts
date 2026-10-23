import type { ProjectRouterCommand } from '../nav/project-page-href';
import {
  AgentCell,
  AgentForeignKey,
  AgentTableRef,
} from './agent-link-api.service';
import { projectPageCommands } from './link-route';

/**
 * A foreign-key hop of a record (Feature claude-mod-web-links, plan Task 9): the record of `refTable` that a foreign
 * key of this record points at, opened by the same record route, its key built from this record's typed values.
 */
export interface RecordHop {
  readonly fk: AgentForeignKey;
  /** The router commands of the referenced record's page (no key in them). */
  readonly commands: readonly ProjectRouterCommand[];
  readonly schema: string;
  /** `pk=<JSON>`: the key, only ever in the fragment. */
  readonly fragment: string;
}

const INTEGER_TEXT = /^-?(?:0|[1-9]\d*)$/;

/**
 * A JSON string literal with `&` written as `\u0026`: the router serializes the fragment with encodeURI, which
 * leaves `&` bare, and a bare `&` would split the fragment's `pk=` part. JSON decodes the escape back to `&`.
 */
function jsonText(value: string): string {
  return JSON.stringify(value).replace(/&/g, '\\u0026');
}

/** A typed cell as a JSON key value: an integer as its exact digits (never through a number), a string as JSON. */
function keyLiteral(cell: AgentCell | undefined): string | undefined {
  if (!cell) return undefined;
  if (
    cell.type === 'integer' &&
    INTEGER_TEXT.test(cell.text) &&
    cell.text !== '-0'
  )
    return cell.text;
  // At most 256 bytes, as the agent's lookup counts them.
  if (
    cell.type === 'string' &&
    new TextEncoder().encode(cell.text).length <= 256
  )
    return jsonText(cell.text);
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
      parts.push(`${jsonText(fk.refColumns[i])}:${literal}`);
    }
    if (parts.length !== fk.columns.length) continue;
    const commands = projectPageCommands(
      { storeId: ref.storeId, projectId: ref.project },
      ['env', ref.env, 'db', ref.source, 'table', fk.refTable.name, 'record'],
    );
    if (!commands) continue;
    hops.push({
      fk,
      commands,
      schema: fk.refTable.schema,
      fragment: `pk={${parts.join(',')}}`,
    });
  }
  return hops;
}
