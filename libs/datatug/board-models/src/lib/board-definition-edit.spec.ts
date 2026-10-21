import {
  editBoardDefinition,
  validateHostedBoardDefinition,
} from './board-definition-edit';
import { Board } from './board';
const board = (): Board => ({
  id: 'board',
  title: 'Shipping',
  rows: [
    {
      cards: [
        {
          id: 'tabs',
          title: 'Evidence',
          widget: {
            name: 'tabs',
            data: {
              tabs: [
                {
                  id: 'receipt',
                  title: 'Receipt',
                  widget: {
                    name: 'SQL',
                    data: {
                      sql: {
                        queryId: 'shipping/receipt',
                        parameters: [{ id: 'order_id', value: 11045 }],
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        {
          id: 'query',
          title: 'Assignment',
          widget: {
            name: 'SQL',
            data: {
              sql: {
                queryId: 'shipping/assignment',
                parameters: [{ id: 'order_id', value: 11045 }],
              },
            },
          },
        },
      ],
    },
  ],
});
describe('canonical durable board definition edits', () => {
  it('preserves untouched nested definitions and edits only canonical saved-query bindings', () => {
    const original = board();
    const before = JSON.stringify(original);
    let next = editBoardDefinition(
      original,
      { type: 'title', title: 'Reviewed shipping' },
      [],
    );
    next = editBoardDefinition(
      next,
      {
        type: 'add-query',
        cardId: 'new',
        queryId: 'shipping/readiness',
        title: 'Readiness',
      },
      ['shipping/readiness'],
    );
    next = editBoardDefinition(
      next,
      {
        type: 'bind-query',
        cardId: 'new',
        parameterId: 'order_id',
        value: 11062,
      },
      [],
    );
    expect(next.rows?.[0].cards?.[0]).toEqual(original.rows?.[0].cards?.[0]);
    expect(JSON.stringify(original)).toBe(before);
    expect(
      (next.rows?.[1].cards?.[0].widget?.data as { sql: unknown }).sql,
    ).toEqual({
      queryId: 'shipping/readiness',
      parameters: [{ id: 'order_id', value: 11062 }],
    });
    next = editBoardDefinition(
      next,
      { type: 'remove-card', cardId: 'new' },
      [],
    );
    expect(next.rows?.flatMap((row) => row.cards ?? []).length).toBe(2);
  });
  it('refuses source text, unsupported graph fields and unlisted saved queries without loss', () => {
    const value = board();
    expect(() =>
      editBoardDefinition(
        value,
        { type: 'add-query', cardId: 'a', title: 'a', queryId: 'foreign' },
        [],
      ),
    ).toThrow('currently available');
    const raw = board();
    const rawData = raw.rows?.[0].cards?.[1].widget?.data as { sql: object } | undefined;
    if (!rawData) throw new Error('Expected saved-query fixture.');
    rawData.sql = {
      queryId: 'q',
      text: 'SELECT secret',
    };
    expect(() => validateHostedBoardDefinition(raw)).toThrow('inline SQL');
    const unknown = board() as Board & { privateRows: unknown[] };
    unknown.privateRows = [1];
    expect(() => validateHostedBoardDefinition(unknown)).toThrow('Unsupported');
  });
  it('rejects inline lookups and object payloads before the session definition journal', () => {
    const value = board();
    value.parameters = [
      {
        id: 'order',
        type: 'integer',
        lookup: { db: 'private', sql: 'SELECT secret', keyFields: ['id'] },
      },
    ];
    expect(() => validateHostedBoardDefinition(value)).toThrow(
      'inline lookups',
    );
    value.parameters = [
      { id: 'order', type: 'custom', defaultValue: { rows: ['protected'] } },
    ];
    expect(() => validateHostedBoardDefinition(value)).toThrow(
      'parameter definition',
    );
    expect(() =>
      editBoardDefinition(
        board(),
        {
          type: 'bind-query',
          cardId: 'query',
          parameterId: 'order_id',
          value: { rows: ['protected'] },
        },
        [],
      ),
    ).toThrow('parameter binding');
  });
  it('changes query identity without carrying unrelated old bindings', () => {
    const next = editBoardDefinition(
      board(),
      { type: 'set-query', cardId: 'query', queryId: 'shipping/receipt' },
      ['shipping/receipt'],
    );
    expect(
      (
        next.rows?.[0].cards?.[1].widget?.data as {
          sql: { parameters: unknown[] };
        }
      ).sql.parameters,
    ).toEqual([]);
  });
});
