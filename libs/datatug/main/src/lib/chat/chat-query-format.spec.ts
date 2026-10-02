import { parseDTQL, type DTQLSchema } from '@dalgo/core';
import { chatDtqlYaml, chatSQLite } from './chat-query-format';
import { CHINOOK_SCHEMA } from './chat.types';

const schema = CHINOOK_SCHEMA as unknown as DTQLSchema;

/** Invoice joined to Customer, as the Chat derives it from a foreign key. */
const joined = `from:
  schema: main
  name: Invoice
  alias: i
  joins:
    - from: {schema: main, name: Customer, alias: c}
      on: [{left: {field: CustomerId, source: i}, op: '==', right: {field: CustomerId, source: c}}]
`;
const totalSales = `columns:
  - {field: Country, source: c, as: country}
  - {aggregate: {function: sum, args: [{field: Total, source: i}]}, as: totalSales}
groupBy: [{field: Country, source: c}]
`;

const sql = (yaml: string): string => chatSQLite(parseDTQL(yaml, schema));

describe('chat SQLite preview of join-aware DTQL', () => {
  it('renders an expression order key', () => {
    const text = sql(joined + totalSales + `orderBy:
  - binary: {op: '*', left: {aggregate: {function: sum, args: [{field: Total, source: i}]}}, right: {value: 2}}
    desc: true
`);
    expect(text).toContain('GROUP BY "c"."Country"');
    expect(text).toContain('ORDER BY (SUM("i"."Total") * 2) DESC');
  });

  it('renders an order key that names a select alias as the aliased expression', () => {
    const text = sql(joined + totalSales + 'orderBy: [{field: totalSales, desc: true}]\n');
    expect(text).toContain('SUM("i"."Total") AS "totalSales"');
    expect(text).toContain('ORDER BY SUM("i"."Total") DESC');
  });

  it('still renders a plain field order key', () => {
    const text = sql(joined + totalSales + 'orderBy: [{field: Country, source: c}]\n');
    expect(text).toContain('ORDER BY "c"."Country" ASC');
  });

  it('renders nested and/or groups in HAVING, including alias operands', () => {
    const text = sql(joined + totalSales + `having:
  and:
    - {op: '>', left: {field: totalSales}, right: {value: 10}}
    - or:
      - {op: '==', left: {field: country}, right: {value: Canada}}
      - {op: '!=', left: {field: country}, right: {value: USA}}
`);
    expect(text).toContain(`HAVING (SUM("i"."Total") > 10 AND ("c"."Country" = 'Canada' OR ("c"."Country" <> 'USA' OR "c"."Country" IS NULL)))`);
  });

  it('renders and/or groups and list membership in WHERE', () => {
    const text = sql(joined + `where:
  and:
    - {op: '>=', left: {field: Total, source: i}, right: {value: 5}}
    - or:
      - {op: In, left: {field: Country, source: c}, right: {values: [Canada, USA]}}
      - {op: NotIn, left: {field: Country, source: c}, right: {values: [Chile]}}
columns: [{field: Country, source: c}]
`);
    expect(text).toContain(`WHERE ("i"."Total" >= 5 AND ("c"."Country" IN ('Canada', 'USA') OR "c"."Country" NOT IN ('Chile')))`);
  });

  it('renders a compact field-versus-literal filter', () => {
    const text = sql(joined + `where: {op: '==', left: {field: Country, source: c}, right: {value: Canada}}
columns: [{field: Country, source: c}]
`);
    expect(text).toContain(`WHERE "c"."Country" = 'Canada'`);
  });

  it('previews null comparisons the way the engine runs them: a comparison with null never holds, != null means not null', () => {
    expect(sql(joined + `where: {op: '==', left: {field: Country, source: c}, right: {value: null}}
columns: [{field: Country, source: c}]
`)).toContain('WHERE "c"."Country" = NULL');
    expect(sql(joined + `where: {op: '!=', left: {field: Country, source: c}, right: {value: null}}
columns: [{field: Country, source: c}]
`)).toContain('WHERE "c"."Country" IS NOT NULL');
    expect(sql(joined + `where: {op: In, left: {field: Country, source: c}, right: {values: [Canada, null]}}
columns: [{field: Country, source: c}]
`)).toContain(`WHERE "c"."Country" IN ('Canada', NULL)`);
  });

  it('previews explicit null tests as IS NULL / IS NOT NULL, never as a comparison with NULL', () => {
    const text = sql(joined + `where:
  and:
    - isNull: {field: Company, source: c}
    - or:
      - isNotNull: {field: Country, source: c}
      - {op: '!=', left: {field: Total, source: i}, right: {value: 5}}
columns: [{field: Country, source: c}]
`);
    expect(text).toContain(`WHERE ("c"."Company" IS NULL AND ("c"."Country" IS NOT NULL OR ("i"."Total" <> 5 OR "i"."Total" IS NULL)))`);
    expect(text).not.toContain('= NULL');
    expect(sql(joined + `where: {isNull: {field: Company, source: c}}
columns: [{field: Country, source: c}]
`)).toContain('WHERE "c"."Company" IS NULL');
    expect(sql(joined + totalSales + `having: {isNotNull: {aggregate: {function: max, args: [{field: Total, source: i}]}}}
`)).toContain('HAVING MAX("i"."Total") IS NOT NULL');
  });

  it('previews != for a value as <> that keeps the null rows, as the engine runs it, and != null as IS NOT NULL', () => {
    const where = (op: string, value: string): string => sql(joined + `where: {op: '${op}', left: {field: Country, source: c}, right: {value: ${value}}}
columns: [{field: Country, source: c}]
`);
    expect(where('!=', 'Canada')).toContain(`WHERE ("c"."Country" <> 'Canada' OR "c"."Country" IS NULL)`);
    expect(where('!=', 'null')).toContain('WHERE "c"."Country" IS NOT NULL');
    expect(where('!=', 'Canada')).not.toContain('!=');
  });

  it('keeps the single-source preview, where null is a value', () => {
    const single = parseDTQL({ from: { schema: 'main', name: 'Customer' }, where: { op: '==', left: { field: 'Company' }, right: { value: null } }, limit: 5 }, schema);
    expect(chatSQLite(single)).toContain('"Company" IS NULL');
  });
});

describe('chat preview of a single-source query', () => {
  const single = (where: unknown): ReturnType<typeof parseDTQL> => parseDTQL({ from: { schema: 'main', name: 'Customer' }, where, limit: 5 }, schema);

  it('previews != as <> that keeps the null rows, and != null as IS NOT NULL, as the filter runs', () => {
    expect(chatSQLite(single({ op: '!=', left: { field: 'Country' }, right: { value: 'Canada' } }))).toContain(`WHERE ("Country" <> 'Canada' OR "Country" IS NULL)`);
    expect(chatSQLite(single({ op: '!=', left: { field: 'Company' }, right: { value: null } }))).toContain('WHERE "Company" IS NOT NULL');
  });

  it('previews a NotIn list as NOT IN and shows it as editable DTQL that parses back', () => {
    const query = single({ op: 'NotIn', left: { field: 'Country' }, right: { values: ['Canada', 'USA'] } });
    expect(chatSQLite(query)).toContain(`WHERE ("Country" NOT IN ('Canada', 'USA') OR "Country" IS NULL)`);
    const yaml = chatDtqlYaml(query);
    expect(yaml).toContain('op: "NotIn"');
    expect(chatSQLite(parseDTQL(yaml, schema))).toBe(chatSQLite(query));
  });

  it('previews a null test, which the parser keeps on the join-aware model', () => {
    const query = single({ isNotNull: { field: 'Company' } });
    expect(chatSQLite(query)).toContain('WHERE "Customer"."Company" IS NOT NULL');
    expect(chatDtqlYaml(query)).toContain('isNotNull:');
  });
});

describe('chat DTQL display of join-aware queries', () => {
  it('shows expression order keys, and/or groups and having groups as editable DTQL', () => {
    const yaml = chatDtqlYaml(parseDTQL(joined + totalSales + `where:
  or:
    - {op: '>=', left: {field: Total, source: i}, right: {value: 5}}
    - {op: '==', left: {field: Country, source: c}, right: {value: Canada}}
having:
  and:
    - {op: '>', left: {field: totalSales}, right: {value: 10}}
orderBy:
  - binary: {op: '*', left: {aggregate: {function: sum, args: [{field: Total, source: i}]}}, right: {value: 2}}
    desc: true
`, schema));
    // The canonical display must parse back to the same query.
    const again = parseDTQL(yaml, schema);
    expect(chatDtqlYaml(again)).toBe(yaml);
    expect(yaml).toContain('or:');
    expect(yaml).toContain('having:');
    expect(yaml).toContain('desc: true');
  });
});
