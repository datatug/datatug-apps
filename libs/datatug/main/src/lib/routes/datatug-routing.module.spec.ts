import { datatugRoutes } from './datatug-routing.module';

describe('datatugRoutes', () => {
  it('redirects signed-out to the home page', () => {
    expect(datatugRoutes).toContainEqual({
      path: 'signed-out',
      pathMatch: 'full',
      redirectTo: '/',
    });
  });
});
