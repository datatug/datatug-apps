export interface IAstRecordset {
  schema?: string;
  name: string;
  alias?: string;
}

type JoinType = 'inner' | 'left' | 'right' | 'cross';

export interface IAstJoin extends IAstRecordset {
  side: JoinType;
  comment?: string;
  disabled?: boolean;
  match: RegExpMatchArray;
}

export interface IAstQuery {
  readonly from?: IAstRecordset;
  readonly joins?: IAstJoin[];
  readonly orderBy?: string[];
}

export class SqlParser {
  // private readonly reFrom = .compile();
  // private readonly reJoin = .compile();
  //a = //
  // This is a global regex - be careful
  private readonly reJoin =
    /((?:--*\s*)?)(?:(INNER|LEFT|RIGHT|CROSS)\s+?)JOIN\s+(?:(?:(\w+)\.)?(\w+))(?:(?:\s+AS)?\s+(\w+))(?:\s+ON\s+(.+?\n))?/gi;
  // private readonly reJoin = /(?<=\s+)(--+\s*)?(?:(INNER|LEFT|RIGHT|CROSS)\s+?)JOIN\s+(?:(?:(\w+)\.)(\w+))(?:(?:\s+AS)?\s+(\w+))?(?:\s+ON\s+(.+?\n))?/ig;
  private readonly reFrom =
    /FROM\s+(?:(?:(\w+)\.)(\w+))(?:(?:\s+AS)?\s+(\w+))?/i;
  private readonly reOrderBy = /ORDER\s+BY\s+(.+)$/i;

  public parseQuery(text: string): IAstQuery {
    if (!text && text !== '') {
      throw new Error('text is a required parameter');
    }
    let q: IAstQuery = { joins: [], orderBy: [] };
    const from = text.match(this.reFrom);
    if (from) {
      q = {
        ...q,
        from: {
          schema: from[1] || 'dbo',
          name: from[2],
          alias: from[3],
        },
      };
    }
    let m: RegExpMatchArray | null;
    while ((m = this.reJoin.exec(text)) !== null) {
      if (m) {
        q.joins?.push({
          match: m,
          comment: m[1],
          disabled: !!m[1],
          side: m[2] as JoinType,
          schema: m[3] || 'dbo',
          name: m[4],
          alias: m[5],
        });
      }
    }
    const orderBy = text.match(this.reOrderBy);
    if (orderBy) {
      const orderCols = orderBy[1].split(',');
      q = { ...q, orderBy: orderCols.map((c) => c.trim()).filter((c) => !!c) };
    }
    return q;
  }

  public commentOutJoin(text: string, join: IAstJoin): string {
    if (join.match.index === undefined || join.disabled) {
      return text;
    }
    // match[0] is the matched JOIN clause; match.length is only the number of groups.
    const start = join.match.index;
    const end = start + join.match[0].length;
    return text.substring(0, start) + '-- ' + text.substring(start, end) + text.substring(end);
  }

  public uncommentJoin(text: string, join: IAstJoin): string {
    if (join.match.index === undefined) {
      return text;
    }
    const start = join.match.index;
    const end = start + join.match[0].length;
    const joinSql = text.substring(start, end);
    return (
      text.substring(0, start) +
      (join.comment ? joinSql.replace(join.comment, '') : joinSql) +
      text.substring(end)
    );
  }
}
