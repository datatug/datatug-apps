import { comparisonCacheId, formatCompareValue } from './incident-compare';

describe('incident compare helpers', () => {
  it('derives the cache id from both execution receipts', () => {
    expect(
      comparisonCacheId(
        { storeId: 'ops', projectId: 'billing', executionId: 'left' },
        { storeId: 'ops', projectId: 'billing', executionId: 'right' },
      ),
    ).toBe('ops/billing/left|ops/billing/right');
  });

  it('formats tagged values without inventing a display type', () => {
    expect(formatCompareValue({ type: 'string', value: 'CA' })).toBe('CA');
    expect(formatCompareValue({ type: 'null', value: null })).toBe('null');
  });
});
