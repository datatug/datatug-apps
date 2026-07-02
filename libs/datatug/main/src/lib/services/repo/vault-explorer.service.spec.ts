import { TestBed } from '@angular/core/testing';

import {
  VaultExplorerService,
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
