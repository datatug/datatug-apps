import { captureDemoHandoff, DEMO_HANDOFF_KEY } from './demo-handoff-capture';

function fakes(pathname: string, search: string, hash = '') {
  const location = { pathname, search, hash } as Location;
  const replaced: string[] = [];
  const history = { state: { x: 1 }, replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url) } as unknown as History;
  const store = new Map<string, string>();
  const storage = { setItem: (key: string, value: string) => store.set(key, value) } as unknown as Storage;
  return { location, history, replaced, store, storage };
}

describe('demo hand-off capture', () => {
  it('uses the key the demo page reads', async () => {
    // The shell is eager and cannot import the lazy-loaded library, so the two keys are written twice and compared here.
    const { DEMO_HANDOFF_STORAGE_KEY } = await import('@sneat/datatug-main');
    expect(DEMO_HANDOFF_KEY).toBe(DEMO_HANDOFF_STORAGE_KEY);
  });

  it('stores the query string and removes it from the address bar', () => {
    const f = fakes('/demo', '?scenario=countries-music-per-capita&q=Which+countries', '#x');
    captureDemoHandoff(f.location, f.history, f.storage);
    expect(f.store.get(DEMO_HANDOFF_KEY)).toBe('?scenario=countries-music-per-capita&q=Which+countries');
    expect(f.replaced).toEqual(['/demo#x']);
  });

  it('leaves every other path and a bare /demo alone', () => {
    for (const [path, search] of [['/', '?q=x'], ['/demo/other', '?q=x'], ['/demo', ''], ['/store/x/project/y/chat', '?scenario=a']]) {
      const f = fakes(path, search);
      captureDemoHandoff(f.location, f.history, f.storage);
      expect(f.store.size).toBe(0);
      expect(f.replaced).toEqual([]);
    }
  });

  it('keeps the query string in place when it cannot be stored, so the page can still read it', () => {
    const f = fakes('/demo', '?scenario=a');
    const blocked = { setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    captureDemoHandoff(f.location, f.history, blocked);
    expect(f.replaced).toEqual([]);
  });
});
