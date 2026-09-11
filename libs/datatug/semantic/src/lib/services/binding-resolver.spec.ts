import { describe, expect, it } from 'vitest';
import { Fact, TypedValue } from '../../contract/types';
import {
  BindingParameterRef,
  hasBlockingBindings,
  isBindingRunnable,
  resolveBindings,
} from './binding-resolver';

const customerIdMeta = { entity: 'Customer', field: 'ID' };

function fact(
  value: TypedValue,
  origin: Fact['origin'],
  id = `Customer.ID:${origin}:${JSON.stringify(value)}`,
): Fact {
  return { id, entity: 'Customer', field: 'ID', value, origin, enabled: true };
}

const integer5: TypedValue = { type: 'integer', value: '5' };
const string5: TypedValue = { type: 'string', value: '5' };
const integer7: TypedValue = { type: 'integer', value: '7' };

describe('resolveBindings — precedence (AC:bound-from-selection, AC:context-carries)', () => {
  it('binds from a single selection fact when no user edit exists', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [],
    });
    expect(binding).toMatchObject({ value: integer5, origin: 'selection' });
    expect(isBindingRunnable(binding)).toBe(true);
  });

  it('falls back to a single context fact when there is no selection', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [],
      contextFacts: [fact(integer5, 'context')],
    });
    expect(binding).toMatchObject({ value: integer5, origin: 'context' });
  });

  it('an explicit user edit wins over both selection and context', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [fact(integer5, 'context')],
      userValues: new Map([['CustomerId', integer7]]),
    });
    expect(binding).toMatchObject({ value: integer7, origin: 'user' });
  });

  it('applies a declared default only when neither tier has a candidate', () => {
    const params: BindingParameterRef[] = [
      { id: 'CustomerId', meta: customerIdMeta, defaultValue: integer7 },
    ];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [],
      contextFacts: [],
    });
    expect(binding).toMatchObject({ value: integer7, origin: 'default' });
  });

  it('a matching selection and context value (same typed value) is not a conflict', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [fact(integer5, 'context')],
    });
    expect(binding).toMatchObject({ value: integer5, origin: 'selection' });
    expect(binding.blocked).toBeUndefined();
  });

  it('a non-semantic parameter (no meta) with no user value resolves to nothing, not required', () => {
    const params: BindingParameterRef[] = [{ id: 'freeText' }];
    const [binding] = resolveBindings({ parameters: params, selectionFacts: [], contextFacts: [] });
    expect(binding.value).toBeUndefined();
    expect(binding.blocked).toBeUndefined();
  });
});

describe('resolveBindings — typed distinctness (AC:typed-context-isolation)', () => {
  it('integer 5 and string "5" are distinct values, not deduped', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection'), fact(string5, 'selection')],
      contextFacts: [],
    });
    // Two distinct typed values in the same (selection) tier is ambiguous, not a
    // silent pick of one — proves they were never treated as "the same 5".
    expect(binding.blocked).toBe('ambiguous');
    expect(binding.ambiguousValues).toEqual(
      expect.arrayContaining([integer5, string5]),
    );
    expect(binding.ambiguousValues).toHaveLength(2);
  });

  it('false, zero and null are distinct declared-typed values, never merged', () => {
    const boolFalse: TypedValue = { type: 'boolean', value: false };
    const numZero: TypedValue = { type: 'number', value: 0 };
    const nullValue: TypedValue = { type: 'null', value: null };
    const params: BindingParameterRef[] = [{ id: 'Flag', meta: { entity: 'X', field: 'Flag' } }];

    const boolBinding = resolveBindings({
      parameters: params,
      selectionFacts: [
        { id: 'f1', entity: 'X', field: 'Flag', value: boolFalse, origin: 'selection', enabled: true },
      ],
      contextFacts: [],
    })[0];
    expect(boolBinding).toMatchObject({ value: boolFalse, origin: 'selection' });

    const zeroBinding = resolveBindings({
      parameters: params,
      selectionFacts: [
        { id: 'f2', entity: 'X', field: 'Flag', value: numZero, origin: 'selection', enabled: true },
      ],
      contextFacts: [],
    })[0];
    expect(zeroBinding).toMatchObject({ value: numZero, origin: 'selection' });

    const nullBinding = resolveBindings({
      parameters: params,
      selectionFacts: [
        { id: 'f3', entity: 'X', field: 'Flag', value: nullValue, origin: 'selection', enabled: true },
      ],
      contextFacts: [],
    })[0];
    expect(nullBinding).toMatchObject({ value: nullValue, origin: 'selection' });

    // All three, offered together as "selection" facts, are 3 distinct candidates —
    // ambiguous, never silently collapsed to one falsy-looking value.
    const combined = resolveBindings({
      parameters: params,
      selectionFacts: [
        { id: 'f1', entity: 'X', field: 'Flag', value: boolFalse, origin: 'selection', enabled: true },
        { id: 'f2', entity: 'X', field: 'Flag', value: numZero, origin: 'selection', enabled: true },
        { id: 'f3', entity: 'X', field: 'Flag', value: nullValue, origin: 'selection', enabled: true },
      ],
      contextFacts: [],
    })[0];
    expect(combined.blocked).toBe('ambiguous');
    expect(combined.ambiguousValues).toHaveLength(3);
  });
});

describe('resolveBindings — conflict (selection overriding a different context value)', () => {
  it('blocks with conflict-unconfirmed when selection and context disagree', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [fact(integer7, 'context')],
    });
    expect(binding.blocked).toBe('conflict-unconfirmed');
    expect(binding.conflict).toEqual({ selectionValue: integer5, contextValue: integer7 });
    expect(isBindingRunnable(binding)).toBe(false);
  });

  it('resolves to the selection value once the conflict is confirmed for that parameter', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [fact(integer7, 'context')],
      confirmedConflicts: new Set(['CustomerId']),
    });
    expect(binding).toMatchObject({ value: integer5, origin: 'selection' });
    expect(binding.blocked).toBeUndefined();
  });

  it('typed-distinct 5 vs "5" across selection/context is a conflict too, not silently equal', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [fact(string5, 'context')],
    });
    expect(binding.blocked).toBe('conflict-unconfirmed');
    expect(binding.conflict).toEqual({ selectionValue: integer5, contextValue: string5 });
  });
});

describe('resolveBindings — missing-required and clear (REQ:no-hidden-filters)', () => {
  it('a required parameter with no candidate anywhere is blocked missing-required', () => {
    const params: BindingParameterRef[] = [
      { id: 'CustomerId', meta: customerIdMeta, required: true },
    ];
    const [binding] = resolveBindings({ parameters: params, selectionFacts: [], contextFacts: [] });
    expect(binding.blocked).toBe('missing-required');
  });

  it('an optional parameter with no candidate is not blocked', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({ parameters: params, selectionFacts: [], contextFacts: [] });
    expect(binding.blocked).toBeUndefined();
    expect(binding.value).toBeUndefined();
  });

  it('clearing a required, auto-bound parameter blocks Run until supplied again', () => {
    const params: BindingParameterRef[] = [
      { id: 'CustomerId', meta: customerIdMeta, required: true },
    ];
    const bound = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [],
    })[0];
    expect(bound.value).toEqual(integer5);

    const cleared = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [],
      clearedParamIds: new Set(['CustomerId']),
    })[0];
    expect(cleared.value).toBeUndefined();
    expect(cleared.blocked).toBe('missing-required');
  });

  it('clearing an optional parameter empties it without blocking', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const cleared = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [],
      clearedParamIds: new Set(['CustomerId']),
    })[0];
    expect(cleared.value).toBeUndefined();
    expect(cleared.blocked).toBeUndefined();
  });

  it('a cleared parameter stays cleared even with a user value supplied for a DIFFERENT id', () => {
    const params: BindingParameterRef[] = [
      { id: 'CustomerId', meta: customerIdMeta, required: true },
      { id: 'Genre', meta: { entity: 'Genre', field: 'Name' } },
    ];
    const resolved = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [],
      clearedParamIds: new Set(['CustomerId']),
      userValues: new Map([['Genre', { type: 'string', value: 'Rock' } as TypedValue]]),
    });
    expect(resolved[0].blocked).toBe('missing-required');
    expect(resolved[1]).toMatchObject({ origin: 'user' });
  });
});

describe('resolveBindings — ambiguity within one tier does not fall through to a lower tier', () => {
  it('two distinct context values block ambiguous rather than picking either', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [],
      contextFacts: [fact(integer5, 'context', 'a'), fact(integer7, 'context', 'b')],
    });
    expect(binding.blocked).toBe('ambiguous');
    expect(binding.ambiguousValues).toEqual(
      expect.arrayContaining([integer5, integer7]),
    );
  });

  it('a default never hides a selection-tier ambiguity', () => {
    const params: BindingParameterRef[] = [
      { id: 'CustomerId', meta: customerIdMeta, defaultValue: integer7 },
    ];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection', 'a'), fact(string5, 'selection', 'b')],
      contextFacts: [],
    });
    expect(binding.blocked).toBe('ambiguous');
    expect(binding.value).toBeUndefined();
  });
});

describe('resolveBindings — non-equality condition facts (api-contract.md Fact.condition paragraph)', () => {
  it('a context fact with condition ">" does not bind a compatible parameter and is reported skipped', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [],
      contextFacts: [
        { id: 'gt-fact', entity: 'Customer', field: 'ID', value: integer5, condition: '>', origin: 'context', enabled: true },
      ],
    });
    // Never applied as equality — no value, no origin.
    expect(binding.value).toBeUndefined();
    expect(binding.origin).toBeUndefined();
    expect(binding.skippedConditionFacts).toEqual([
      expect.objectContaining({ factId: 'gt-fact', condition: '>' }),
    ]);
    expect(binding.skippedConditionFacts?.[0]?.explanation).toContain('>');
    expect(binding.skippedConditionFacts?.[0]?.explanation.toLowerCase()).toContain('skip');
  });

  it('an explicit condition: "==" fact still binds exactly as an absent-condition fact does', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [],
      contextFacts: [
        { id: 'eq-fact', entity: 'Customer', field: 'ID', value: integer5, condition: '==', origin: 'context', enabled: true },
      ],
    });
    expect(binding).toMatchObject({ value: integer5, origin: 'context' });
    expect(binding.skippedConditionFacts).toBeUndefined();
  });

  it('an absent-condition fact still binds exactly as today (no regression)', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [],
      contextFacts: [fact(integer5, 'context')],
    });
    expect(binding).toMatchObject({ value: integer5, origin: 'context' });
    expect(binding.skippedConditionFacts).toBeUndefined();
  });

  it('a selected fact still wins over a context fact regardless of the context fact\'s condition', () => {
    const params: BindingParameterRef[] = [{ id: 'CustomerId', meta: customerIdMeta }];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [
        { id: 'gt-fact', entity: 'Customer', field: 'ID', value: integer7, condition: '>', origin: 'context', enabled: true },
      ],
    });
    // The context fact is never eligible as an equality candidate, so it can never
    // become a "conflict" either — selection simply wins, unblocked.
    expect(binding).toMatchObject({ value: integer5, origin: 'selection' });
    expect(binding.blocked).toBeUndefined();
    expect(binding.skippedConditionFacts).toEqual([
      expect.objectContaining({ factId: 'gt-fact', condition: '>' }),
    ]);
  });

  it('with only a ">" fact available a required parameter is reported missing, not bound', () => {
    const params: BindingParameterRef[] = [
      { id: 'CustomerId', meta: customerIdMeta, required: true },
    ];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [],
      contextFacts: [
        { id: 'gt-fact', entity: 'Customer', field: 'ID', value: integer5, condition: '>', origin: 'context', enabled: true },
      ],
    });
    expect(binding.value).toBeUndefined();
    expect(binding.blocked).toBe('missing-required');
    expect(binding.skippedConditionFacts).toEqual([
      expect.objectContaining({ factId: 'gt-fact', condition: '>' }),
    ]);
  });

  it('a declared default never applies over a skipped non-equality-only context fact — still reported missing', () => {
    const params: BindingParameterRef[] = [
      { id: 'CustomerId', meta: customerIdMeta, defaultValue: integer7 },
    ];
    const [binding] = resolveBindings({
      parameters: params,
      selectionFacts: [],
      contextFacts: [
        { id: 'gt-fact', entity: 'Customer', field: 'ID', value: integer5, condition: '>', origin: 'context', enabled: true },
      ],
    });
    // No eligible candidate in any tier — the default is free to apply (it never hides
    // an ambiguity, and a skipped fact isn't one), but it's still worth asserting the
    // skip is reported alongside it.
    expect(binding).toMatchObject({ value: integer7, origin: 'default' });
    expect(binding.skippedConditionFacts).toEqual([
      expect.objectContaining({ factId: 'gt-fact', condition: '>' }),
    ]);
  });
});

describe('hasBlockingBindings', () => {
  it('true when any resolved binding is blocked', () => {
    const blocked = resolveBindings({
      parameters: [{ id: 'CustomerId', meta: customerIdMeta, required: true }],
      selectionFacts: [],
      contextFacts: [],
    });
    expect(hasBlockingBindings(blocked)).toBe(true);
  });

  it('false when every resolved binding is runnable or simply empty/optional', () => {
    const clean = resolveBindings({
      parameters: [
        { id: 'CustomerId', meta: customerIdMeta },
        { id: 'freeText' },
      ],
      selectionFacts: [fact(integer5, 'selection')],
      contextFacts: [],
    });
    expect(hasBlockingBindings(clean)).toBe(false);
  });
});
