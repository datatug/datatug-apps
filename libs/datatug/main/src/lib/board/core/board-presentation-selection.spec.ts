import { BoardPresentationSelection } from './board-presentation-selection';
describe('board presentation selection', () => {
  it('treats prototype-name IDs as ordinary own keys', () => {
    const state = new BoardPresentationSelection();
    for (const id of ['constructor', 'toString', '__proto__']) {
      expect(state.value(id)).toBeUndefined();
      state.select(id, 'Canada');
      expect(state.value(id)).toBe('Canada');
      state.retain([id]);
      expect(state.value(id)).toBe('Canada');
      state.clear(id);
      expect(state.value(id)).toBeUndefined();
    }
  });
  it('keeps only the latest exact label, scopes selection IDs and clears missing producers', () => {
    const state = new BoardPresentationSelection();
    state.select('country', 'Canada');
    state.select('other', 'USA');
    state.select('country', 'UK');
    expect(state.value('country')).toBe('UK');
    expect(state.value('other')).toBe('USA');
    state.retain(['country']);
    expect(state.value('other')).toBeUndefined();
    state.clear('country');
    expect(state.value('country')).toBeUndefined();
    state.select('country', 'Canada');
    state.clear();
    expect(state.value('country')).toBeUndefined();
  });
});
