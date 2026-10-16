import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agGridEnterpriseEnabled,
  configureAgGrid,
  ensureAgGrid,
  resetAgGridSetupForTests,
} from './ag-grid-setup';

const secretKey = 'TEST-ONLY-NOT-A-REAL-KEY-12345';

function loaders(enterprise = vi.fn()) {
  const community = vi.fn();
  return {
    community,
    enterprise,
    loaders: {
      community: vi
        .fn()
        .mockResolvedValue({ registerAgGridCommunity: community }),
      enterprise: vi
        .fn()
        .mockResolvedValue({ registerAgGridEnterprise: enterprise }),
    },
  };
}

describe('ensureAgGrid', () => {
  beforeEach(() => {
    resetAgGridSetupForTests();
    vi.restoreAllMocks();
  });

  it.each(['', '   '])(
    'registers community only and never imports enterprise without a key (%j)',
    async (key) => {
      const l = loaders();
      configureAgGrid(key);
      await ensureAgGrid(l.loaders);
      expect(l.community).toHaveBeenCalledTimes(1);
      expect(l.loaders.enterprise).not.toHaveBeenCalled();
      expect(agGridEnterpriseEnabled()).toBe(false);
    },
  );

  it('registers community, then enterprise with the trimmed key', async () => {
    const l = loaders();
    configureAgGrid(` ${secretKey} `);
    await ensureAgGrid(l.loaders);
    expect(l.community).toHaveBeenCalledTimes(1);
    expect(l.enterprise).toHaveBeenCalledWith(secretKey);
    expect(agGridEnterpriseEnabled()).toBe(true);
  });

  it('is memoized: concurrent and repeated calls share one promise and one registration', async () => {
    const l = loaders();
    configureAgGrid(secretKey);
    const a = ensureAgGrid(l.loaders);
    const b = ensureAgGrid(l.loaders);
    expect(a).toBe(b);
    await Promise.all([a, b]);
    await ensureAgGrid(l.loaders);
    expect(l.community).toHaveBeenCalledTimes(1);
    expect(l.enterprise).toHaveBeenCalledTimes(1);
  });

  it('stays on community and never logs the key when enterprise fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const l = loaders(
      vi.fn(() => {
        throw new Error(`boom ${secretKey}`);
      }),
    );
    configureAgGrid(secretKey);
    await ensureAgGrid(l.loaders);
    expect(agGridEnterpriseEnabled()).toBe(false);
    for (const spy of [warn, log, error]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(secretKey);
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('default loaders', () => {
  it('import the lazy loader modules', async () => {
    resetAgGridSetupForTests();
    const community = vi.fn();
    const enterprise = vi.fn();
    vi.doMock('./ag-grid-community-loader', () => ({
      registerAgGridCommunity: community,
    }));
    vi.doMock('./ag-grid-enterprise-loader', () => ({
      registerAgGridEnterprise: enterprise,
    }));
    configureAgGrid(secretKey);
    await ensureAgGrid();
    expect(community).toHaveBeenCalled();
    expect(enterprise).toHaveBeenCalledWith(secretKey);
    vi.doUnmock('./ag-grid-community-loader');
    vi.doUnmock('./ag-grid-enterprise-loader');
  });
});
