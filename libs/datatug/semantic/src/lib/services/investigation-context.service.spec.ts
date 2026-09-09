import { TestBed } from '@angular/core/testing';
import {
  ContextItem,
  InvestigationContextService,
  SemanticParameterRef,
} from './investigation-context.service';

const STORAGE_KEY = 'datatug.investigationContext.v1';

function createService(): InvestigationContextService {
  TestBed.resetTestingModule();
  return TestBed.inject(InvestigationContextService);
}

describe('InvestigationContextService', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('starts empty when sessionStorage holds corrupted JSON, instead of throwing', () => {
    sessionStorage.setItem(STORAGE_KEY, '{not valid json');
    const service = createService();
    expect(service.items()).toEqual([]);
  });

  it('starts empty when sessionStorage has nothing', () => {
    const service = createService();
    expect(service.items()).toEqual([]);
    expect(service.enabledCount()).toBe(0);
  });

  describe('J3 — carrying context', () => {
    it('addValue adds an enabled item and is idempotent for the same entity.field=value', () => {
      const service = createService();
      const added = service.addValue({
        entityField: { entity: 'Customer', field: 'ID' },
        value: 5,
        label: 'Customer.ID = 5',
        source: 'grid',
      });

      expect(added.enabled).toBe(true);
      expect(added.id).toBe('Customer.ID=5');
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

    it('bindingsFor binds a parameter whose meta matches an enabled context item', () => {
      const service = createService();
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

  it('persists to sessionStorage and restores on a fresh instance', () => {
    const service = createService();
    service.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });

    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw as string) as ContextItem[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0].value).toBe(5);

    // A fresh service instance (new browser tab within the same session) restores state.
    const restored = createService();
    expect(restored.items()).toHaveLength(1);
    expect(restored.items()[0].label).toBe('Customer.ID = 5');
  });

  it('clear empties the basket and persists the empty state', () => {
    const service = createService();
    service.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });

    service.clear();

    expect(service.items()).toEqual([]);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) as string)).toEqual([]);
  });
});
