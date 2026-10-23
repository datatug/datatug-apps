import { TestBed } from '@angular/core/testing';
import { WorkContextComponent } from './work-context.component';
import { ContextSnapshot } from '../session-context/session-context-contract';
import { workDetailFixture } from './work.spec-helper';
const snapshot = (): ContextSnapshot => ({
  session: {
    schemaVersion: 1,
    id: 'child',
    databaseId: 'db',
    projectId: 'project',
    owner: 'lead',
    title: 'Case context',
    state: 'active',
    version: 3,
    defaultBagId: 'bag',
    contextSetId: 'set',
    bagIds: ['bag'],
    createdAt: '2026-10-23T12:00:00Z',
    updatedAt: '2026-10-23T12:00:00Z',
  },
  bags: [
    {
      id: 'bag',
      sessionId: 'child',
      title: 'Orders',
      scope: { environmentId: 'demo', identityDomain: 'northwind' },
      version: 2,
      entryIds: ['entry'],
    },
  ],
  entries: [
    {
      id: 'entry',
      sessionId: 'child',
      bagId: 'bag',
      subject: {
        conceptId: 'order',
        fieldId: 'OrderID',
        fieldMappingRef: 'order-id',
      },
      currentRevisionId: 'revision',
      version: 1,
    },
  ],
  revisions: [
    {
      id: 'revision',
      entryId: 'entry',
      bagId: 'bag',
      subject: {
        conceptId: 'order',
        fieldId: 'OrderID',
        fieldMappingRef: 'order-id',
      },
      value: {
        schemaVersion: 1,
        kind: 'scalar',
        scalar: { type: 'integer', value: '11045' },
      },
      createdAt: '2026-10-23T12:00:00Z',
      source: {
        sessionId: 'parent',
        bagId: 'parentbag',
        entryId: 'parententry',
        revisionId: 'parentrevision',
      },
    },
  ],
  contextSet: {
    id: 'set',
    sessionId: 'child',
    enabled: true,
    slots: [],
    createdAt: '2026-10-23T12:00:00Z',
  },
});
describe('WorkContextComponent', () => {
  function setup() {
    const fixture = TestBed.createComponent(WorkContextComponent);
    fixture.componentRef.setInput('snapshot', snapshot());
    fixture.componentRef.setInput(
      'environments',
      workDetailFixture().environments,
    );
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
    return fixture;
  }
  it('labels inherited values and edits only the child through the canonical command', () => {
    const fixture = setup(),
      c = fixture.componentInstance;
    expect(c.inherited(c.entries()[0])).toBe(true);
    const emit = vi.fn();
    c.contextCommand.subscribe(emit);
    c.edit(c.entries()[0]);
    c.text.set('11062');
    c.saveEntry();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'putEntry',
        sessionId: 'child',
        expectedVersion: 3,
        bagId: 'bag',
        expectedBagVersion: 2,
        entryId: 'entry',
        expectedEntryVersion: 1,
        value: {
          schemaVersion: 1,
          kind: 'scalar',
          scalar: { type: 'integer', value: '11062' },
        },
      }),
    );
    expect(c.snapshot().revisions[0].value.scalar?.value).toBe('11045');
  });
  it('applies selected immutable revisions with session, bag and context-set fences', () => {
    const fixture = setup(),
      c = fixture.componentInstance;
    const emit = vi.fn();
    c.contextCommand.subscribe(emit);
    c.check(c.entries()[0], true);
    c.apply();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'applyContext',
        sessionId: 'child',
        expectedVersion: 3,
        expectedBagVersion: 2,
        expectedContextSetId: 'set',
        expectedSlotVersion: 0,
        selection: [{ entryId: 'entry', revisionId: 'revision' }],
      }),
    );
  });
  it('uses named bags in the same session context model', () => {
    const fixture = setup(),
      c = fixture.componentInstance;
    const emit = vi.fn();
    c.contextCommand.subscribe(emit);
    c.bagMode.set('create');
    c.bagTitle.set('Shipment evidence');
    c.saveBag();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'createBag',
        sessionId: 'child',
        title: 'Shipment evidence',
        scope: { environmentId: 'demo', identityDomain: 'northwind' },
      }),
    );
  });
});
