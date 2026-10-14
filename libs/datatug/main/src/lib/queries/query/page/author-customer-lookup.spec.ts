import type { TypedValue } from '@sneat/datatug-semantic';
import {
  PUBLIC_CHINOOK_CUSTOMER_FK,
  type PublicSqliteExecutionReceipt,
} from '../../public-sqlite-tugql';
import { customerIdLookupValue } from './author-customer-lookup';

const receipt = (
  overrides: Partial<PublicSqliteExecutionReceipt> = {},
): PublicSqliteExecutionReceipt => ({
  sql: 'SELECT "c"."CustomerId" FROM "Invoice" AS "i" INNER JOIN ...',
  bindingNames: ['CustomerId'],
  sourceId: 'chinook-sqlite',
  fixtureSha256: 'fixture',
  schemaVersion: 'schema',
  draftRevision: 3,
  executionId: 'execution',
  relationship: {
    id: PUBLIC_CHINOOK_CUSTOMER_FK,
    version: 'verified-schema-version',
    fromSource: 'i',
    toSource: 'c',
    joinType: 'inner',
    pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
  },
  outputColumns: [
    {
      name: 'billing_customer',
      type: 'integer',
      lineage: [{ source: 'c', field: 'CustomerId' }],
    },
  ],
  ...overrides,
});

const integer = (value: string): TypedValue => ({ type: 'integer', value });

describe('customerIdLookupValue', () => {
  it('accepts only a current integer cell with admitted CustomerId lineage', () => {
    expect(
      customerIdLookupValue(
        receipt(),
        0,
        'billing_customer',
        integer('42'),
        true,
      ),
    ).toBe('42');
  });

  it('rejects previous runs, wrong columns, and unrelated source lineage', () => {
    expect(
      customerIdLookupValue(
        receipt(),
        0,
        'billing_customer',
        integer('42'),
        false,
      ),
    ).toBeUndefined();
    expect(
      customerIdLookupValue(
        receipt(),
        0,
        'CustomerId',
        integer('42'),
        true,
      ),
    ).toBeUndefined();
    expect(
      customerIdLookupValue(
        receipt({
          outputColumns: [
            {
              name: 'billing_customer',
              type: 'integer',
              lineage: [{ source: 'i', field: 'InvoiceId' }],
            },
          ],
        }),
        0,
        'billing_customer',
        integer('42'),
        true,
      ),
    ).toBeUndefined();
  });

  it('rejects absent or altered relationship provenance', () => {
    const currentRelationship = receipt().relationship;
    if (!currentRelationship) throw new Error('Fixture relationship missing');

    expect(
      customerIdLookupValue(
        receipt({ relationship: undefined }),
        0,
        'billing_customer',
        integer('42'),
        true,
      ),
    ).toBeUndefined();
    expect(
      customerIdLookupValue(
        receipt({
          relationship: {
            ...currentRelationship,
            pairs: [{ fromField: 'InvoiceId', toField: 'CustomerId' }],
          },
        }),
        0,
        'billing_customer',
        integer('42'),
        true,
      ),
    ).toBeUndefined();
  });

  it.each([
    { type: 'string', value: '42' },
    { type: 'integer', value: '0' },
    { type: 'integer', value: '-1' },
    { type: 'integer', value: '042' },
    { type: 'integer', value: '9007199254740992' },
  ] as const)('rejects invalid typed values ($type: $value)', (cell) => {
    expect(
      customerIdLookupValue(
        receipt(),
        0,
        'billing_customer',
        cell as TypedValue,
        true,
      ),
    ).toBeUndefined();
  });
});
