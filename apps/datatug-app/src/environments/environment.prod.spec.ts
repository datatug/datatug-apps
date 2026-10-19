import {
  DATATUG_SAME_ORIGIN_AUTH_BY_DEFAULT,
  datatugAppEnvironmentConfig,
} from './environment.prod';

describe('the production environment', () => {
  it('signs in on the shared auth.sneat.co until the same-origin auth domain has been prepared (founder steps)', () => {
    // Flipping this to true is a deliberate one-line change after docs/auth-domain.md is done: with it on,
    // datatug.app signs in at datatug.app/__/auth/handler, which Google, GitHub and Firebase must accept first.
    expect(DATATUG_SAME_ORIGIN_AUTH_BY_DEFAULT).toBe(false);
    // jsdom runs on localhost, which has no /__/auth proxy: the shared domain.
    expect(datatugAppEnvironmentConfig.firebaseConfig.authDomain).toBe(
      'auth.sneat.co',
    );
  });

  it('uses the shared Sneat identity project', () => {
    expect(datatugAppEnvironmentConfig.firebaseConfig.projectId).toBe(
      'sneat-eur3-1',
    );
  });

  it('enables the hosted Cloud Logs pilot behind the server permission gate', () => {
    expect(datatugAppEnvironmentConfig.hostedCloudLogsEnabled).toBe(true);
  });
});
