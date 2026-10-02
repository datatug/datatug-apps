import { describe, expect, it } from 'vitest';
import { parseDemoConfig, resolveDemoDataSource, type DemoConfig } from './demo-config';

describe('demo config', () => {
  it('parses the development and production shapes', () => {
    expect(parseDemoConfig({ enabled: true, dataSource: { kind: 'ovdb', baseUrl: 'http://127.0.0.1:50501' }, allowDataSourceOverride: true }))
      .toEqual({ enabled: true, dataSource: { kind: 'ovdb', baseUrl: 'http://127.0.0.1:50501' }, allowDataSourceOverride: true });
    expect(parseDemoConfig({ enabled: false, dataSource: { kind: 'static' } }))
      .toEqual({ enabled: false, dataSource: { kind: 'static' }, allowDataSourceOverride: false });
  });

  it('rejects anything else', () => {
    for (const bad of [undefined, null, 'x', {}, { enabled: 'yes', dataSource: { kind: 'static' } }, { enabled: true }, { enabled: true, dataSource: { kind: 'ovdb' } }, { enabled: true, dataSource: { kind: 'other' } }]) {
      expect(parseDemoConfig(bad)).toBeUndefined();
    }
  });

  describe('data source override', () => {
    const dev: DemoConfig = { enabled: true, dataSource: { kind: 'ovdb', baseUrl: 'http://127.0.0.1:50501' }, allowDataSourceOverride: true };
    it('applies only where the config allows it', () => {
      expect(resolveDemoDataSource(dev, 'static')).toEqual({ kind: 'static' });
      expect(resolveDemoDataSource(dev, 'http://127.0.0.1:59999')).toEqual({ kind: 'ovdb', baseUrl: 'http://127.0.0.1:59999' });
      expect(resolveDemoDataSource(dev, null)).toEqual(dev.dataSource);
      expect(resolveDemoDataSource({ ...dev, allowDataSourceOverride: false }, 'static')).toEqual(dev.dataSource);
    });
  });
});
