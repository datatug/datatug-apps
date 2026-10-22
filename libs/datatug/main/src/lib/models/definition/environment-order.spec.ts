import goldens from './environment-order.golden.json';
import {
  compareEnvironmentIds,
  resolveEnvironmentOrder,
} from './environment-order';

describe('shared environment order', () => {
  const sorted = (ids: string[]) => [...ids].sort(compareEnvironmentIds);
  it('places aliases and every custom environment before production', () => {
    expect(
      sorted([
        'PROD',
        'customer-prod',
        'staging',
        'qa',
        'development',
        'LOCAL',
      ]),
    ).toEqual([
      'LOCAL',
      'development',
      'qa',
      'staging',
      'customer-prod',
      'PROD',
    ]);
  });
  it('uses exact scalar tie breaks and never UTF-16 collation', () => {
    expect(sorted(['dev', 'Dev'])).toEqual(['Dev', 'dev']);
    expect(sorted(['qatest', 'qa_test', 'qa-test'])).toEqual([
      'qa-test',
      'qa_test',
      'qatest',
    ]);
    expect(sorted(['😀', '𐀀', '\uE000', 'Ω', 'é'])).toEqual([
      'é',
      'Ω',
      '\uE000',
      '𐀀',
      '😀',
    ]);
  });
  it('repairs damaged metadata without dropping live IDs', () => {
    const live = ['prod', 'dev', 'new', 'qa'].map((id) => ({ id }));
    expect(
      resolveEnvironmentOrder(live, ['prod', 'deleted', 'prod', 'dev']),
    ).toMatchObject({ order: ['prod', 'dev', 'qa', 'new'], needsRepair: true });
    expect(resolveEnvironmentOrder(live).needsRepair).toBe(false);
  });
  it('rejects malformed scalar strings and duplicate live identities', () => {
    expect(() => sorted(['\uD800', 'dev'])).toThrow('Invalid Unicode');
    expect(() =>
      resolveEnvironmentOrder([{ id: 'dev' }, { id: 'dev' }]),
    ).toThrow('Duplicate live');
  });
  it('uses exact saved IDs and preserves authorized filtered relative order', () => {
    const result = resolveEnvironmentOrder(
      ['dev', 'Dev', 'prod'].map((id) => ({ id })),
      ['prod', 'dev', 'Dev'],
    );
    expect(result.order).toEqual(['prod', 'dev', 'Dev']);
    expect(
      result.items.filter((item) => item.id !== 'dev').map((item) => item.id),
    ).toEqual(['prod', 'Dev']);
  });
});

// Exact shared fixture copied from reviewed Core pkg/datatug/testdata/environment-order.json.
describe('Core/Apps shared environment order fixtures', () => {
  for (const fixture of goldens)
    it(fixture.name, () => {
      expect(
        resolveEnvironmentOrder(
          fixture.ids.map((id) => ({ id })),
          fixture.savedOrder,
        ),
      ).toMatchObject({
        order: fixture.order,
        needsRepair: fixture.needsRepair,
      });
    });
});
