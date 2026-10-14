import { sessionResultFingerprint } from './session-result-fingerprint';
import { tryWriteSessionResultCache } from './session-result-cache.service';

describe('session result fingerprints', () => {
  it('uses a stable SHA-256 content reference', async () => {
    const first = await sessionResultFingerprint({ rows: [{ ID: 1, 'a-b': 'Ada' }], columns: ['ID', 'a-b'] });
    const reordered = await sessionResultFingerprint({ columns: ['ID', 'a-b'], rows: [{ 'a-b': 'Ada', ID: 1 }] });
    const changed = await sessionResultFingerprint({ columns: ['ID', 'a-b'], rows: [{ 'a-b': 'Ada', ID: 2 }] });
    expect(first).toMatch(/^sha256-[a-f0-9]{64}$/u);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('reports optional display-cache failure without throwing away the outcome path', async () => {
    const failed = await tryWriteSessionResultCache({ write: async () => { throw new Error('quota'); } }, 'key', { result: 1 });
    const saved = await tryWriteSessionResultCache({ write: async () => undefined }, 'key', { result: 1 });
    expect(failed).toBe(false);
    expect(saved).toBe(true);
  });
});
