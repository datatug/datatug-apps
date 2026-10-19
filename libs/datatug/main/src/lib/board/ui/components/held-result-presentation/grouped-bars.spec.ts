import { prepareGroupedBars } from './grouped-bars';
const series = [
  { id: 'northwind', title: 'Northwind', valueColumn: 'n' },
  { id: 'chinook', title: 'Chinook', valueColumn: 'c' },
];
const result = () => ({
  recordset: {
    columns: [
      { name: 'country', type: 'string' },
      { name: 'n', type: 'integer' },
      { name: 'c', type: 'integer' },
    ],
    rows: [
      [
        { type: 'string' as const, value: 'Canada' },
        { type: 'integer' as const, value: '3' },
        { type: 'integer' as const, value: '8' },
      ],
      [
        { type: 'string' as const, value: 'USA' },
        { type: 'integer' as const, value: '13' },
        { type: 'integer' as const, value: '13' },
      ],
    ],
  },
});
describe('grouped bar staging', () => {
  it('preserves categories, separate measures and original rows on one zero scale', () => {
    const held = result(),
      before = JSON.stringify(held);
    const prepared = prepareGroupedBars(held, 'country', series);
    expect(prepared).toEqual({
      maximum: 13,
      minimum: 0,
      groups: [
        { category: 'Canada', sourceRow: 0, values: [3, 8] },
        { category: 'USA', sourceRow: 1, values: [13, 13] },
      ],
    });
    expect(JSON.stringify(held)).toBe(before);
  });
  it('accepts finite typed fractional and signed numbers on one scale including zero', () => {
    const held = {
      recordset: {
        columns: [
          { name: 'country', type: 'string' },
          { name: 'n', type: 'number' },
          { name: 'c', type: 'number' },
        ],
        rows: [
          [
            { type: 'string' as const, value: 'A' },
            { type: 'number' as const, value: -2.5 },
            { type: 'number' as const, value: 1.25 },
          ],
        ],
      },
    };
    expect(prepareGroupedBars(held, 'country', series)).toMatchObject({
      minimum: -2.5,
      maximum: 1.25,
    });
    expect(() =>
      prepareGroupedBars(
        {
          recordset: {
            ...held.recordset,
            rows: [
              [
                held.recordset.rows[0][0],
                { type: 'decimal', value: '1.234567890123456789' },
                held.recordset.rows[0][2],
              ],
            ],
          },
        },
        'country',
        series,
      ),
    ).toThrow();
  });
  it('retains zero and validates every row before exposing any bars', () => {
    const held = result();
    held.recordset.rows[0][1] = { type: 'integer', value: '0' };
    expect(
      prepareGroupedBars(held, 'country', series).groups[0].values,
    ).toEqual([0, 8]);
    for (const bad of [
      '9007199254740991.1',
      '9007199254740992',
      'NaN',
      '1e20',
    ]) {
      held.recordset.rows[1][1] = { type: 'integer', value: bad };
      expect(() => prepareGroupedBars(held, 'country', series)).toThrow();
    }
  });
  it('rejects duplicate categories, missing cells and incompatible typed columns', () => {
    const duplicate = result();
    duplicate.recordset.rows[1][0] = { type: 'string', value: 'Canada' };
    expect(() => prepareGroupedBars(duplicate, 'country', series)).toThrow();
    const missing = result();
    missing.recordset.rows[1].pop();
    expect(() => prepareGroupedBars(missing, 'country', series)).toThrow();
    const wrong = result();
    wrong.recordset.columns[1].type = 'string';
    expect(() => prepareGroupedBars(wrong, 'country', series)).toThrow();
  });
});
