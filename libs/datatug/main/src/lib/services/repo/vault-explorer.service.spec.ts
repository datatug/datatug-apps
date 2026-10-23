import { TestBed } from '@angular/core/testing';

import { GITHUB_FETCH } from './github/github-project-reader.service';
import { GITHUB_USER_TOKEN } from './github/github-user-token';
import {
  VaultExplorerService,
  contentsFromTree,
  subcollectionNamesFromContents,
  vaultErrorMessage,
} from './vault-explorer.service';

describe('VaultExplorerService', () => {
  let service: VaultExplorerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [VaultExplorerService],
    });
    service = TestBed.inject(VaultExplorerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should throw when reading before connect()', async () => {
    await expect(service.loadCollections('owner/repo', 'main')).rejects.toThrow(
      'not connected',
    );
  });
});

describe('subcollectionNamesFromContents', () => {
  it('keeps only child dirs, excluding dot-dirs and $records', () => {
    const entries = [
      { type: 'dir', name: 'contacts' },
      { type: 'dir', name: '$records' },
      { type: 'dir', name: '.ingitdb' },
      { type: 'file', name: 'readme.md' },
      { type: 'dir', name: 'assets' },
    ];
    expect(subcollectionNamesFromContents(entries)).toEqual([
      'contacts',
      'assets',
    ]);
  });

  it('returns an empty list for a non-array (single-file) response', () => {
    expect(subcollectionNamesFromContents({ type: 'file' })).toEqual([]);
  });
});

describe('vaultErrorMessage', () => {
  it('prefixes the HTTP status when the error carries a response', () => {
    expect(
      vaultErrorMessage({ response: { status: 404 }, message: 'Not Found' }),
    ).toBe('404 Not Found');
  });

  it('falls back to the message', () => {
    expect(vaultErrorMessage(new Error('boom'))).toBe('boom');
  });
});

const VAULT_TREE = {
  truncated: false,
  tree: [
    { path: '.ingitdb', type: 'tree' },
    { path: 'spaces', type: 'tree' },
    { path: 'spaces/$records', type: 'tree' },
    { path: 'spaces/$records/family.yaml', type: 'blob' },
    { path: 'spaces/family', type: 'tree' },
    { path: 'spaces/family/contacts', type: 'tree' },
    { path: 'spaces/family/contacts/$records', type: 'tree' },
    { path: 'spaces/family/contacts/$records/c1.yaml', type: 'blob' },
    { path: 'spaces/work', type: 'tree' },
    { path: 'spaces/work/$records', type: 'tree' },
  ],
};

describe('contentsFromTree', () => {
  it('lists the children of a directory as the Contents API does', () => {
    expect(contentsFromTree(VAULT_TREE.tree, 'spaces/family')).toEqual([
      { name: 'contacts', path: 'spaces/family/contacts', type: 'dir' },
    ]);
    expect(contentsFromTree(VAULT_TREE.tree, 'spaces/$records')).toEqual([
      { name: 'family.yaml', path: 'spaces/$records/family.yaml', type: 'file' },
    ]);
  });
  it('says absent for a missing directory and unknown for a file', () => {
    expect(contentsFromTree(VAULT_TREE.tree, 'spaces/nope')).toBe('absent');
    expect(contentsFromTree(VAULT_TREE.tree, 'spaces/$records/family.yaml')).toBe('unknown');
  });
});

describe('VaultExplorerService api.github.com budget', () => {
  function connected(token: string | undefined, typed?: string) {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(VAULT_TREE)));
    TestBed.configureTestingModule({
      providers: [
        VaultExplorerService,
        { provide: GITHUB_FETCH, useValue: fetchFn },
        { provide: GITHUB_USER_TOKEN, useValue: () => token },
      ],
    });
    const service = TestBed.inject(VaultExplorerService);
    service.connect(typed);
    return { service, fetchFn };
  }

  it('answers every subcollection probe of a connect from ONE listing call', async () => {
    const { service, fetchFn } = connected(undefined);
    expect(await service.listSubcollections('o/vault', 'spaces/family', 'main')).toEqual(['contacts']);
    expect(await service.listSubcollections('o/vault', 'spaces/work', 'main')).toEqual([]);
    expect(await service.listSubcollections('o/vault', 'spaces/absent', 'main')).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/o/vault/git/trees/main?recursive=1');
    expect((init.headers as Record<string, string> | undefined)?.['Authorization']).toBeUndefined();
  });

  it('sends the typed token, else the signed-in one, with the listing call', async () => {
    const signedIn = connected('gho_user');
    await signedIn.service.listSubcollections('o/vault', 'spaces/family', 'main');
    const init = (signedIn.fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer gho_user');
  });
});
