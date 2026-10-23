import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY_SOURCE_TTL_MS, readGithubProjectCopySource, resetDemoProjectCopySourceMemory, resolveDemoProjectCopySource } from './github-project-copy-source';
const source = { kind: 'github-project', repositoryID: 42, owner: 'datatug', name: 'datatug-demo-project', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
/** A GitHub that answers the three calls of a resolution, by path, for any number of resolutions. */
function github() {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/datatug-demo-project')) return json({ id: 42, owner: { login: 'datatug' }, name: source.name, default_branch: 'main' });
    if (url.includes('/commits/')) return json({ sha: source.commit, commit: { tree: { sha: 'c'.repeat(40) } } });
    return json({ tree: [{ path: source.folder, type: 'tree', sha: source.tree }] });
  });
}
const auth = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)['Authorization'];
beforeEach(() => resetDemoProjectCopySourceMemory());
afterEach(() => vi.unstubAllGlobals());
describe('GitHub project copy source', () => {
  it('validates immutable source and rejects traversal or missing revisions', () => {
    expect(readGithubProjectCopySource(source)).toEqual(source);
    for (const patch of [{ folder: '../private' }, { commit: 'main' }, { tree: undefined }, { repositoryID: 0 }, { branch: '\nmain' }]) expect(readGithubProjectCopySource({ ...source, ...patch })).toBeUndefined();
  });
  it('resolves the current branch commit and selected folder tree in 3 calls', async () => {
    const fetch = github();
    vi.stubGlobal('fetch', fetch);
    expect(await resolveDemoProjectCopySource()).toEqual(source);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1][0]).toBe('https://api.github.com/repos/datatug/datatug-demo-project/commits/main');
    expect(fetch.mock.calls[2][0]).toContain('c'.repeat(40));
  });
  it('sends the signed-in token with every call, and no token when there is none', async () => {
    const fetchFn = github();
    await resolveDemoProjectCopySource({ fetchFn, token: () => 'gho_user' });
    expect(fetchFn.mock.calls.map(auth)).toEqual(['Bearer gho_user', 'Bearer gho_user', 'Bearer gho_user']);
    expect(fetchFn.mock.calls.every((call) => call[1]?.credentials === 'omit')).toBe(true);
    resetDemoProjectCopySourceMemory();
    const anonymous = github();
    await resolveDemoProjectCopySource({ fetchFn: anonymous, token: () => undefined });
    expect(anonymous.mock.calls.map(auth)).toEqual([undefined, undefined, undefined]);
  });
  it('reads the token this tab keeps by default', async () => {
    sessionStorage.setItem('datatug:github:token', 'gho_tab');
    const fetchFn = github();
    await resolveDemoProjectCopySource({ fetchFn });
    expect(auth(fetchFn.mock.calls[0])).toBe('Bearer gho_tab');
    sessionStorage.removeItem('datatug:github:token');
  });
  it('falls back to an anonymous call when GitHub refuses the token', async () => {
    const answers = github();
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => (auth([url, init]) ? json({}, 401) : answers(url, init)));
    expect(await resolveDemoProjectCopySource({ fetchFn, token: () => 'stale' })).toEqual(source);
    expect(answers).toHaveBeenCalledTimes(3);
  });
  it('shares one resolution between concurrent callers and reuses it for 5 minutes', async () => {
    let now = 0;
    const fetchFn = github();
    const deps = { fetchFn, token: () => undefined, now: () => now };
    await Promise.all([resolveDemoProjectCopySource(deps), resolveDemoProjectCopySource(deps)]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    now = COPY_SOURCE_TTL_MS - 1;
    await resolveDemoProjectCopySource(deps);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    now = COPY_SOURCE_TTL_MS + 1;
    await resolveDemoProjectCopySource(deps);
    // The repository is not asked again: only the commit and the listing.
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });
  it('rejects a failed source lookup, keeps the copy rules, and asks again next time', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const failure = resolveDemoProjectCopySource({ fetchFn, token: () => undefined });
    await expect(failure).rejects.toThrow('The source project revision could not be verified. Please try again.');
    const retry = github();
    expect(await resolveDemoProjectCopySource({ fetchFn: retry, token: () => undefined })).toEqual(source);
    expect(retry).toHaveBeenCalledTimes(3);
  });
});
