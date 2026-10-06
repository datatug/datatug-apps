import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/client-only-source-rights.json';
import legacyResult from './fixtures/result_live.json';
import { decodeResult } from './decoders';
import {
  decodeDataLicenseDeclaration,
  decodeRightsInventory,
  decodeSourceRightsEvidence,
  safeTermsUrl,
} from './source-rights';

describe('source-data terms compatible reader', () => {
  it('keeps old responses unchanged and reads the frozen Go inventories', () => {
    expect(decodeResult(legacyResult)).toEqual(legacyResult);
    for (const fixture of [
      fixtures.legacy,
      fixtures.structured,
      fixtures.multiSource,
    ]) {
      expect(decodeSourceRightsEvidence(fixture)).toEqual(fixture);
      expect(
        decodeResult({ ...legacyResult, ...fixture }).sourceRights,
      ).toEqual(fixture.sourceRights);
    }
    expect(decodeRightsInventory(fixtures.directoryShape)).toEqual(
      fixtures.structured.sourceRights,
    );
  });
  it('normalizes scalar, URL-only and text-only declarations without field inheritance', () => {
    expect(decodeDataLicenseDeclaration('MIT')).toEqual({ spdx: 'MIT' });
    expect(
      decodeDataLicenseDeclaration({ url: 'https://example.org/terms#reuse' }),
    ).toEqual({ url: 'https://example.org/terms#reuse' });
    expect(
      decodeDataLicenseDeclaration({ text: 'Source terms\nsecond line' }),
    ).toEqual({ text: 'Source terms\nsecond line' });
  });
  it('refuses malformed declarations, unsafe URL components and controls', () => {
    for (const value of [
      null,
      {},
      { name: 'Only a title' },
      { text: '' },
      { url: 'javascript:alert(1)' },
      { url: 'https://secret@example.org' },
      { url: 'https://example.org\\@evil.org' },
      { text: '\u0000' },
      { spdx: null },
      { text: 42 },
      { url: 'https://example.org', extra: true },
    ]) {
      expect(() => decodeDataLicenseDeclaration(value)).toThrow();
    }
    for (const url of [
      'http://example.org',
      '//example.org',
      ' https://example.org',
      'https://example.org/\nterms',
    ])
      expect(() => safeTermsUrl(url)).toThrow();
    expect(() => decodeRightsInventory({ dataRights: null })).toThrow();
    expect(() =>
      decodeSourceRightsEvidence({
        ...fixtures.structured,
        sourceRights: [
          {
            ...fixtures.structured.sourceRights[0],
            sourceId: 'ovdb:other-server/fx/Rates',
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeSourceRightsEvidence({ usedSourceIds: ['not-a-source-id'] }),
    ).toThrow();
  });
  it('retains escaped source ids and distinct joined sources, never labels unused inputs used', () => {
    const right = fixtures.structured.sourceRights[0];
    const sourceId = 'ovdb:fixture-server/fx/Rates%20%2F%20100%25';
    const source = { ...right.source, recordset: 'Rates / 100%' };
    expect(
      decodeSourceRightsEvidence({
        sourceRights: [{ ...right, sourceId, source }],
        usedSourceIds: [sourceId],
      }).usedSourceIds,
    ).toEqual([sourceId]);
    const parsed = decodeSourceRightsEvidence(fixtures.multiSource);
    expect(parsed.sourceRights).toHaveLength(3);
    expect(parsed.usedSourceIds).toHaveLength(2);
    expect(
      decodeSourceRightsEvidence({
        ...fixtures.legacy,
        usedSourceIds: ['ovdb:fixture-server/music/Undeclared'],
      }).usedSourceIds,
    ).toEqual(['ovdb:fixture-server/music/Undeclared']);
    expect(() =>
      decodeSourceRightsEvidence({ usedSourceIds: ['same', 'same'] }),
    ).toThrow();
  });
  it('copies the captured declaration and rejects conflicting ids, wrong scope and oversized evidence', () => {
    const fixture = structuredClone(fixtures.structured);
    const decoded = decodeSourceRightsEvidence(fixture);
    fixture.sourceRights[0].declaration.text = 'Later declaration';
    expect(decoded.sourceRights?.[0].declaration.text).toContain(
      'Example source-data terms.',
    );
    const right = fixtures.structured.sourceRights[0];
    expect(() =>
      decodeSourceRightsEvidence({
        sourceRights: [
          right,
          { ...right, declaration: { text: 'conflicting terms' } },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeSourceRightsEvidence({
        sourceRights: [{ ...right, declarationScope: 'database' }],
      }),
    ).toThrow();
    expect(() =>
      decodeSourceRightsEvidence({
        sourceRights: Array.from({ length: 6 }, (_, index) => ({
          ...right,
          sourceId: String(index),
          declaration: { text: 'x'.repeat(65536) },
        })),
      }),
    ).toThrow();
  });
});
