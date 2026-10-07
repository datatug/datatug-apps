import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const html = readFileSync(
  join(process.cwd(), 'apps/datatug-app/src/index.html'),
  'utf8',
);
const source = html.match(
  /<script id="datatug-github-callback-scrub">([\s\S]*?)<\/script>/,
)?.[1];
function page(search: string, pathname = '/github/callback') {
  const window: { __datatugTakeGitHubAuthorization?: () => unknown } = {};
  const replaceState = vi.fn();
  const storage = { setItem: vi.fn(), getItem: vi.fn() };
  runInNewContext(source!, {
    location: { pathname, search, hash: '#ignored' },
    window,
    history: { replaceState },
    URLSearchParams,
    localStorage: storage,
    sessionStorage: storage,
  });
  return { window, replaceState, storage };
}

describe('GitHub App callback before application bootstrap', () => {
  it('scrubs callback credentials before analytics and transfers them once in memory', () => {
    expect(source).toBeTruthy();
    expect(html.indexOf('datatug-github-callback-scrub')).toBeLessThan(
      html.indexOf('www.googletagmanager.com'),
    );
    const p = page('?code=private-code&state=private-state');
    expect(p.replaceState).toHaveBeenCalledWith(null, '', '/github/callback');
    const take = p.window.__datatugTakeGitHubAuthorization!;
    expect(take()).toEqual({ code: 'private-code', state: 'private-state' });
    expect(p.window.__datatugTakeGitHubAuthorization).toBeUndefined();
    expect(take()).toBeUndefined();
    expect(p.storage.setItem).not.toHaveBeenCalled();
    expect(p.storage.getItem).not.toHaveBeenCalled();
  });
  it.each([
    '?code=a&code=b&state=c',
    '?code=a&state=b&state=c',
    '?code=&state=b',
    '?code=a',
    '',
  ])('clears malformed callbacks without a handoff: %s', (search) => {
    const p = page(search);
    expect(p.replaceState).toHaveBeenCalledOnce();
    expect(p.window.__datatugTakeGitHubAuthorization?.()).toBeUndefined();
  });
  it('does not consume unrelated pages', () => {
    const p = page('?code=a&state=b', '/project/github.com/owner/repo');
    expect(p.replaceState).not.toHaveBeenCalled();
    expect(p.window.__datatugTakeGitHubAuthorization).toBeUndefined();
  });
});
