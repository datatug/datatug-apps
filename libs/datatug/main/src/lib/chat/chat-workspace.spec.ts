import { applyChatWorkspaceAction, ChatRecordSetData, emptyChatWorkspace } from './chat-workspace';

const scope = JSON.stringify(['localhost:8989', 'datatug-demo-project']);
const record: ChatRecordSetData = {
  id: 'rs-1', source: `${scope}/chinook`, columns: ['CustomerId', 'City', 'Total'],
  rows: [
    { CustomerId: 10, City: 'Prague', Total: 100 },
    { CustomerId: 20, City: 'Brazil', Total: 200 },
    { CustomerId: 30, City: 'Prague', Total: 300 },
  ],
};
const records = new Map([[record.id, record]]);

describe('Chat workspace actions', () => {
  it('retains multiple selections over immutable source row positions', () => {
    const first = applyChatWorkspaceAction(scope, emptyChatWorkspace(), records, {
      kind: 'select', recordSetId: 'rs-1', column: 'City', equals: 'Prague', orderBy: 'Total', descending: true, limit: 1,
    }).state;
    const firstId = first.currentSelectionId as string;
    expect(first.selections[firstId].rows).toEqual([2]);
    const second = applyChatWorkspaceAction(scope, first, records, {
      kind: 'select', recordSetId: 'rs-1', column: 'City', equals: 'Brazil',
    }).state;
    expect(second.selections[firstId].rows).toEqual([2]);
    expect(second.selections[second.currentSelectionId as string].rows).toEqual([1]);
    expect(Object.keys(second.views)).toHaveLength(2);
    expect(record.rows[2].CustomerId).toBe(30);
  });

  it('restores attachments and a dock without copying or deleting the RecordSet', () => {
    const selected = applyChatWorkspaceAction(scope, undefined, records, {
      kind: 'select', recordSetId: 'rs-1', rows: [0, 2], columns: ['CustomerId'],
    }).state;
    const attached = applyChatWorkspaceAction(scope, selected, records, {
      kind: 'attach', reference: {
        kind: 'table', projectId: 'datatug-demo-project', sourceId: 'chinook', objectId: 'main.Customer', title: 'Customer',
      },
    }).state;
    const docked = applyChatWorkspaceAction(scope, attached, records, { kind: 'dockCurrent' }).state;
    const restored = JSON.parse(JSON.stringify(docked)) as typeof docked;
    expect(restored.attachments).toHaveLength(1);
    expect(restored.docks).toHaveLength(1);
    expect(restored.selections[restored.currentSelectionId as string].rows).toEqual([0, 2]);
    const withoutDock = applyChatWorkspaceAction(scope, restored, records, { kind: 'undock', dockId: restored.docks[0].id }).state;
    expect(withoutDock.docks).toHaveLength(0);
    expect(records.get('rs-1')?.rows).toHaveLength(3);
    expect(withoutDock.attachments).toHaveLength(1);
  });

  it('rejects objects from another project and source rows outside the snapshot', () => {
    expect(() => applyChatWorkspaceAction(scope, undefined, records, {
      kind: 'attach', reference: { kind: 'table', projectId: 'other', sourceId: 'chinook', objectId: 'main.Customer', title: 'Customer' },
    })).toThrow(/current project/);
    expect(() => applyChatWorkspaceAction(scope, undefined, records, {
      kind: 'select', recordSetId: 'rs-1', rows: [99],
    })).toThrow(/outside/);
    expect(() => applyChatWorkspaceAction(scope, undefined, records, {
      kind: 'select', recordSetId: 'rs-1', column: 'Missing', equals: 'x',
    })).toThrow(/no selectable/);
  });

  it('keeps a cell range on exact source rows when its View is reordered', () => {
    const selected = applyChatWorkspaceAction(scope, undefined, records, {
      kind: 'select', recordSetId: 'rs-1', rows: [2, 0], columns: ['CustomerId', 'City'],
      ranges: [{ rowIndices: [2, 0], columns: ['CustomerId', 'City'] }],
    }).state;
    const selectionId = selected.currentSelectionId as string;
    const viewId = selected.selections[selectionId].viewId;
    const sorted = applyChatWorkspaceAction(scope, selected, records, {
      kind: 'sortView', viewId, column: 'CustomerId', descending: false,
    }).state;
    expect(sorted.views[viewId].rowIndices).toEqual([0, 2]);
    expect(sorted.selections[selectionId].rows).toEqual([0, 2]);
    expect(sorted.selections[selectionId].ranges[0].rowIndices).toEqual([2, 0]);
    const focused = applyChatWorkspaceAction(scope, sorted, records, { kind: 'focusSelection', selectionId }).state;
    expect(focused.currentSelectionId).toBe(selectionId);
  });
});
