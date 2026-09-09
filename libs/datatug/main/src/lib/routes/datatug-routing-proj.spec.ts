import { datatugProjectRoutes } from './datatug-routing-proj';

describe('datatugProjectRoutes', () => {
  it('resolves the "variables" route to InvestigationContextPageComponent, unconditionally (not gated behind ENABLE_EMPTY_SHELL_PAGES)', async () => {
    const route = datatugProjectRoutes.find((r) => r.path === 'variables');
    expect(route).toBeTruthy();
    expect(route?.loadComponent).toBeTruthy();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loaded: any = await route!.loadComponent!();
    expect(loaded?.name).toBe('InvestigationContextPageComponent');
  });

  it('never resolves "variables" to the retired VariablesPageComponent', () => {
    const route = datatugProjectRoutes.find((r) => r.path === 'variables');
    expect(route?.loadComponent?.toString()).not.toContain('variables-page.component');
    expect(route?.loadComponent?.toString()).toContain(
      'investigation-context-page.component',
    );
  });
});
