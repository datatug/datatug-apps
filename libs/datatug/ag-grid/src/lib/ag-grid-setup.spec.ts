import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agGridEnterpriseEnabled,
  resetAgGridSetupForTests,
  setupAgGrid,
} from './ag-grid-setup';

const secretKey = 'TEST-ONLY-NOT-A-REAL-KEY-12345';

describe('setupAgGrid', () => {
  beforeEach(() => {
    resetAgGridSetupForTests();
    vi.restoreAllMocks();
  });

  it.each(['', '   '])(
    'loads nothing of enterprise without a key (%j)',
    async (key) => {
      const loader = vi.fn();
      await setupAgGrid(key, loader);
      expect(loader).not.toHaveBeenCalled();
      expect(agGridEnterpriseEnabled()).toBe(false);
    },
  );

  it('loads enterprise and passes the trimmed key when configured', async () => {
    const register = vi.fn();
    const loader = vi
      .fn()
      .mockResolvedValue({ registerAgGridEnterprise: register });
    await setupAgGrid(` ${secretKey} `, loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(secretKey);
    expect(agGridEnterpriseEnabled()).toBe(true);
  });

  it('runs once per page load', async () => {
    const loader = vi
      .fn()
      .mockResolvedValue({ registerAgGridEnterprise: vi.fn() });
    await setupAgGrid(secretKey, loader);
    await setupAgGrid(secretKey, loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('stays on community and never logs the key when enterprise fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const loader = vi.fn().mockRejectedValue(new Error(`boom ${secretKey}`));
    await setupAgGrid(secretKey, loader);
    expect(agGridEnterpriseEnabled()).toBe(false);
    for (const spy of [warn, log, error]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(secretKey);
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('default enterprise loader', () => {
  it('imports the lazy loader module when no loader is injected', async () => {
    resetAgGridSetupForTests();
    const register = vi.fn();
    vi.doMock('./ag-grid-enterprise-loader', () => ({
      registerAgGridEnterprise: register,
    }));
    await setupAgGrid(secretKey);
    expect(register).toHaveBeenCalledWith(secretKey);
    vi.doUnmock('./ag-grid-enterprise-loader');
  });
});
