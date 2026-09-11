import { TestBed } from '@angular/core/testing';
import {
  contextItemToFact,
  ContextScope,
  InvestigationContextService,
  scopesEqual,
  SemanticParameterRef,
} from './investigation-context.service';
import { DATATUG_AGENT_BASE_URL } from '../tokens/datatug-agent-base-url.token';

function createService(): InvestigationContextService {
  TestBed.resetTestingModule();
  return TestBed.inject(InvestigationContextService);
}

const scopeA = { project: 'demo-project-1', environment: 'local', securityContextId: 'sc-1' };
const scopeB = { project: 'demo-project-1', environment: 'local', securityContextId: 'sc-2' };
const scopeOtherProject = { project: 'other-project', environment: 'local', securityContextId: 'sc-1' };

describe('InvestigationContextService', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('starts empty before any setScope call', () => {
    const service = createService();
    expect(service.items()).toEqual([]);
    expect(service.enabledCount()).toBe(0);
  });

  it('starts empty when sessionStorage holds corrupted JSON for the active scope, instead of throwing', () => {
    const service = createService();
    service.setScope(scopeA);
    const key = `datatug.investigationContext.v2.${service.scope()!.agentUrl} demo-project-1 local sc-1`;
    sessionStorage.setItem(key, '{not valid json');
    const restarted = createService();
    restarted.setScope(scopeA);
    expect(restarted.items()).toEqual([]);
  });

  describe('J3 — carrying context', () => {
    it('addValue adds an enabled item and is idempotent for the same entity.field + typed value', () => {
      const service = createService();
      service.setScope(scopeA);
      const added = service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });

      expect(added.enabled).toBe(true);
      expect(added.entity).toBe('Customer');
      expect(added.field).toBe('ID');
      expect(added.value).toEqual({ type: 'integer', value: '5' });
      expect(added.origin).toBe('context');
      expect(service.items().length).toBe(1);
      expect(service.enabledCount()).toBe(1);

      const addedAgain = service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5 (duplicate)',
        source: 'grid',
      });

      expect(addedAgain).toEqual(added);
      expect(service.items().length).toBe(1);
    });

    it('typed equality: adding 5 (number) then "5" (string) for the same field keeps BOTH — never deduped (AC:typed-context-isolation)', () => {
      const service = createService();
      service.setScope(scopeA);
      service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: '5',
        label: 'Customer.ID = "5"',
        source: 'grid',
      });

      expect(service.items().length).toBe(2);
      const values = service.items().map((i) => i.value);
      expect(values).toEqual(
        expect.arrayContaining([
          { type: 'integer', value: '5' },
          { type: 'string', value: '5' },
        ]),
      );
    });

    it('false, zero and null add as three distinct declared-typed items, never merged', () => {
      const service = createService();
      service.setScope(scopeA);
      service.addValue({
        entityField: { entity: 'X', field: 'Flag' },
        value: false,
        label: 'X.Flag = false',
        source: 'grid',
      });
      service.addValue({
        entityField: { entity: 'X', field: 'Flag' },
        value: 0,
        label: 'X.Flag = 0',
        source: 'grid',
      });
      service.addValue({
        entityField: { entity: 'X', field: 'Flag' },
        value: null,
        label: 'X.Flag = null',
        source: 'grid',
      });

      expect(service.items()).toHaveLength(3);
      expect(service.items().map((i) => i.value)).toEqual(
        expect.arrayContaining([
          { type: 'boolean', value: false },
          { type: 'integer', value: '0' },
          { type: 'null', value: null },
        ]),
      );
    });

    it('bindingsFor binds a parameter whose meta matches an enabled context item', () => {
      const service = createService();
      service.setScope(scopeA);
      service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });

      const parameters: SemanticParameterRef[] = [
        { id: 'customerId', meta: { entity: 'Customer', field: 'ID' } },
        { id: 'genre', meta: { entity: 'Genre', field: 'Name' } },
        { id: 'freeText' }, // no meta — never bound
      ];

      const bindings = service.bindingsFor(parameters);

      expect(bindings.length).toBe(1);
      expect(bindings[0]).toMatchObject({
        parameterId: 'customerId',
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        source: 'grid',
      });
    });

    it('disabling the chip empties the binding (REQ:context-basket disable without removing)', () => {
      const service = createService();
      service.setScope(scopeA);
      const item = service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });

      service.setEnabled(item.id, false);

      expect(service.items().length).toBe(1); // still present, not removed
      expect(service.enabledCount()).toBe(0);
      expect(
        service.bindingsFor([{ id: 'customerId', meta: { entity: 'Customer', field: 'ID' } }]),
      ).toEqual([]);

      service.setEnabled(item.id, true);
      expect(service.enabledCount()).toBe(1);
      expect(
        service.bindingsFor([{ id: 'customerId', meta: { entity: 'Customer', field: 'ID' } }]),
      ).toHaveLength(1);
    });

    it('removeValue deletes the item entirely', () => {
      const service = createService();
      service.setScope(scopeA);
      const item = service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });

      service.removeValue(item.id);

      expect(service.items()).toEqual([]);
      expect(service.enabledCount()).toBe(0);
    });

    it('never returns a binding for context values on its own — bindingsFor is read-only', () => {
      const service = createService();
      service.setScope(scopeA);
      service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });

      // Calling bindingsFor must not mutate state (REQ:no-hidden-filters).
      service.bindingsFor([{ id: 'customerId', meta: { entity: 'Customer', field: 'ID' } }]);

      expect(service.items()).toHaveLength(1);
      expect(service.items()[0].enabled).toBe(true);
    });
  });

  describe('condition (S156, founder ruling 2026-09-10 — "conditions like ==, >, >=, etc.")', () => {
    it('defaults to "==" for every caller that never sets one, unchanged from before this field existed', () => {
      const service = createService();
      service.setScope(scopeA);
      const added = service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      expect(added.condition).toBe('==');
    });

    it('is stored verbatim when the caller sets one (the "Add a context variable" form)', () => {
      const service = createService();
      service.setScope(scopeA);
      const added = service.addValue({
        entityField: { entity: 'Customer', field: 'Age' },
        value: 21,
        label: 'Customer.Age > 21',
        source: 'manual',
        condition: '>',
      });
      expect(added.condition).toBe('>');
      expect(added.origin).toBe('context');
      expect(added.enabled).toBe(true);
    });

    it('two items for the same entity.field + value but a DIFFERENT condition are both kept — never deduped into one', () => {
      const service = createService();
      service.setScope(scopeA);
      service.addValue({
        entityField: { entity: 'Customer', field: 'Age' },
        value: 21,
        label: 'Customer.Age > 21',
        source: 'manual',
        condition: '>',
      });
      service.addValue({
        entityField: { entity: 'Customer', field: 'Age' },
        value: 21,
        label: 'Customer.Age >= 21',
        source: 'manual',
        condition: '>=',
      });

      expect(service.items()).toHaveLength(2);
      expect(service.items().map((i) => i.condition)).toEqual(
        expect.arrayContaining(['>', '>=']),
      );
    });

    it('adding the same entity.field + value + condition twice is still idempotent, same as equality-only callers', () => {
      const service = createService();
      service.setScope(scopeA);
      const first = service.addValue({
        entityField: { entity: 'Customer', field: 'Age' },
        value: 21,
        label: 'Customer.Age > 21',
        source: 'manual',
        condition: '>',
      });
      const second = service.addValue({
        entityField: { entity: 'Customer', field: 'Age' },
        value: 21,
        label: 'Customer.Age > 21 (duplicate)',
        source: 'manual',
        condition: '>',
      });

      expect(second).toEqual(first);
      expect(service.items()).toHaveLength(1);
    });

    it('a default-condition ("==") item keeps the exact pre-existing id format — condition is never folded into an equality item\'s id', () => {
      const service = createService();
      service.setScope(scopeA);
      const added = service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      // JSON.stringify of the TypedValue's own (string) `.value` — pre-existing format,
      // untouched by this lane; only the condition-tag insertion point is new.
      expect(added.id).toBe('Customer.ID:integer="5"');
    });

    // S162 — the hub contract amendment (api-contract.md's Fact.condition paragraph)
    // gives `condition` a real wire slot on Fact. contextItemToFact() is the exact
    // boundary where a context basket entry becomes the request payload for
    // `queries/applicable`/`exec/run_query` (context-panel.component.ts and
    // investigation-context-page.component.ts both call it).
    describe('contextItemToFact — the wire-narrowing boundary', () => {
      it('a context item with condition ">" serialises to a fact with condition: ">"', () => {
        const service = createService();
        service.setScope(scopeA);
        const item = service.addValue({
          entityField: { entity: 'Customer', field: 'Age' },
          value: 21,
          label: 'Customer.Age > 21',
          source: 'manual',
          condition: '>',
        });

        expect(contextItemToFact(item)).toEqual({
          id: item.id,
          entity: 'Customer',
          field: 'Age',
          value: { type: 'integer', value: '21' },
          origin: 'context',
          enabled: true,
          condition: '>',
        });
      });

      it('a plain (default "==") item serialises unchanged — no condition key at all', () => {
        const service = createService();
        service.setScope(scopeA);
        const item = service.addValue({
          entityField: { entity: 'Customer', field: 'ID' },
          value: 5,
          label: 'Customer.ID = 5',
          source: 'grid',
        });

        const fact = contextItemToFact(item);
        expect(fact).toEqual({
          id: item.id,
          entity: 'Customer',
          field: 'ID',
          value: { type: 'integer', value: '5' },
          origin: 'context',
          enabled: true,
        });
        expect('condition' in fact).toBe(false);
      });

      it('preserves physical/mapping when present, alongside a non-default condition', () => {
        const service = createService();
        service.setScope(scopeA);
        const item = service.addValue({
          entityField: { entity: 'Customer', field: 'Age' },
          value: 21,
          label: 'Customer.Age >= 21',
          source: 'manual',
          condition: '>=',
        });
        const withPhysical = {
          ...item,
          physical: { source: 'chinook-local', collection: 'Customer', column: 'Age' },
          mapping: 'declared' as const,
        };

        expect(contextItemToFact(withPhysical)).toEqual({
          id: item.id,
          entity: 'Customer',
          field: 'Age',
          value: { type: 'integer', value: '21' },
          origin: 'context',
          enabled: true,
          physical: { source: 'chinook-local', collection: 'Customer', column: 'Age' },
          mapping: 'declared',
          condition: '>=',
        });
      });
    });
  });

  describe('scope isolation (api-contract.md "Binding and context behavior")', () => {
    it('switching project/environment/securityContextId opens an empty basket — never imports facts', () => {
      const service = createService();
      service.setScope(scopeA);
      service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      expect(service.items()).toHaveLength(1);

      service.setScope(scopeB); // securityContextId changed — e.g. principal switch
      expect(service.items()).toEqual([]); // old scope's fact does not bind here

      service.setScope(scopeOtherProject);
      expect(service.items()).toEqual([]);
    });

    it('switching back to a previously visited scope RETAINS that scope’s own basket', () => {
      const service = createService();
      service.setScope(scopeA);
      service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });

      service.setScope(scopeB);
      expect(service.items()).toEqual([]);

      service.setScope(scopeA); // back to A
      expect(service.items()).toHaveLength(1);
      expect(service.items()[0].value).toEqual({ type: 'integer', value: '5' });
    });

    it('setScope is a no-op for the same scope (does not clear the basket or thrash storage)', () => {
      const service = createService();
      service.setScope(scopeA);
      service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      service.setScope({ ...scopeA }); // same fields, new object
      expect(service.items()).toHaveLength(1);
    });

    it('isCurrentScope distinguishes the active scope from any other — the late-response-discard gate', () => {
      const service = createService();
      service.setScope(scopeA);
      const requestScope: ContextScope = service.scope()!;
      expect(service.isCurrentScope(requestScope)).toBe(true);

      service.setScope(scopeB); // user switches principal mid-flight
      expect(service.isCurrentScope(requestScope)).toBe(false); // late response discarded
      expect(service.isCurrentScope(service.scope()!)).toBe(true);
    });

    it('clear() only empties the CURRENT scope, never another scope’s basket', () => {
      const service = createService();
      service.setScope(scopeA);
      service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      service.setScope(scopeB);
      service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 9,
        label: 'Customer.ID = 9',
        source: 'grid',
      });

      service.clear(); // clears scope B only
      expect(service.items()).toEqual([]);

      service.setScope(scopeA);
      expect(service.items()).toHaveLength(1); // scope A untouched
    });

    it('addValue before any setScope call returns a transient item that is never persisted', () => {
      const service = createService();
      const transient = service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });
      expect(transient.value).toEqual({ type: 'integer', value: '5' });
      expect(service.items()).toEqual([]); // no active scope to store it in
    });
  });

  it('persists to sessionStorage (keyed by scope) and restores on a fresh instance', () => {
    const service = createService();
    service.setScope(scopeA);
    service.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });

    // A fresh service instance (new browser tab within the same session, or a reload)
    // restores this scope's state once it re-declares the same scope.
    const restored = createService();
    restored.setScope(scopeA);
    expect(restored.items()).toHaveLength(1);
    expect(restored.items()[0].label).toBe('Customer.ID = 5');

    // A different scope on the fresh instance starts empty.
    const freshOtherScope = createService();
    freshOtherScope.setScope(scopeB);
    expect(freshOtherScope.items()).toEqual([]);
  });

  it('clear empties the basket and persists the empty state', () => {
    const service = createService();
    service.setScope(scopeA);
    service.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });

    service.clear();

    expect(service.items()).toEqual([]);
    const restored = createService();
    restored.setScope(scopeA);
    expect(restored.items()).toEqual([]);
  });
});

describe('scopesEqual', () => {
  const base: ContextScope = {
    agentUrl: 'http://localhost:8989/datatug',
    project: 'p1',
    environment: 'local',
    securityContextId: 'sc-1',
  };

  it('true for identical scopes, false for any differing field', () => {
    expect(scopesEqual(base, { ...base })).toBe(true);
    expect(scopesEqual(base, { ...base, project: 'p2' })).toBe(false);
    expect(scopesEqual(base, { ...base, environment: 'prod' })).toBe(false);
    expect(scopesEqual(base, { ...base, securityContextId: 'sc-2' })).toBe(false);
    expect(scopesEqual(base, { ...base, agentUrl: 'http://localhost:9999/datatug' })).toBe(
      false,
    );
  });

  it('undefined compares equal only to undefined', () => {
    expect(scopesEqual(undefined, undefined)).toBe(true);
    expect(scopesEqual(base, undefined)).toBe(false);
    expect(scopesEqual(undefined, base)).toBe(false);
  });
});

describe('DATATUG_AGENT_BASE_URL contributes the scope’s agentUrl automatically', () => {
  it('setScope fills in agentUrl from the injected token, not a caller-supplied value', () => {
    TestBed.resetTestingModule();
    TestBed.overrideProvider(DATATUG_AGENT_BASE_URL, {
      useValue: 'http://localhost:1234/datatug',
    });
    const service = TestBed.inject(InvestigationContextService);
    service.setScope(scopeA);
    expect(service.scope()?.agentUrl).toBe('http://localhost:1234/datatug');
  });
});
