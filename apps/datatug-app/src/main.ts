// Public report visits never evaluate the authenticated application or tracking providers.
const sharedReport =
  location.pathname.replace(/\/$/, '') === '/postmortems/shared';
if (sharedReport) {
  const state = window as unknown as Record<string, unknown>;
  state['__datatugOptionalTrackingDisabled'] = true;
  const token =
    typeof state['__datatugPostmortemToken'] === 'string'
      ? (state['__datatugPostmortemToken'] as string)
      : (new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
  delete state['__datatugPostmortemToken'];
  history.replaceState(null, '', location.pathname);
  void import('./postmortem-public-bootstrap').then((module) =>
    module.bootstrapPublicPostmortem(token),
  );
} else {
  void import('./main-application');
}
