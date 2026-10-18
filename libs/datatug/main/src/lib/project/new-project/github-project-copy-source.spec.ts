import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGithubProjectCopySource, resolveDemoProjectCopySource } from './github-project-copy-source';
const source = { kind: 'github-project', repositoryID: 42, owner: 'datatug', name: 'datatug-demo-project', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
afterEach(() => vi.unstubAllGlobals());
describe('GitHub project copy source', () => {
  it('validates immutable source and rejects traversal or missing revisions', () => {
    expect(readGithubProjectCopySource(source)).toEqual(source);
    for (const patch of [{ folder: '../private' }, { commit: 'main' }, { tree: undefined }, { repositoryID: 0 }, { branch: '\nmain' }]) expect(readGithubProjectCopySource({ ...source, ...patch })).toBeUndefined();
  });
  it('resolves the current branch commit and selected folder tree', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ id: 42, owner: { login: 'datatug' }, name: source.name, default_branch: 'main' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: source.commit, commit: { tree: { sha: 'c'.repeat(40) } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tree: [{ path: source.folder, type: 'tree', sha: source.tree }] }) });
    vi.stubGlobal('fetch', fetch);
    expect(await resolveDemoProjectCopySource()).toEqual(source);
    expect(fetch.mock.calls[2][0]).toContain('c'.repeat(40));
  });
  it('rejects a failed source lookup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(resolveDemoProjectCopySource()).rejects.toThrow('could not be verified');
  });
});
