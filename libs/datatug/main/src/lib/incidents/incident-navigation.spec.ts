import {
  incidentPageCommands,
  incidentPageQueryParams,
  incidentProjectRefFromUrl,
} from './incident-navigation';

const scope = {
  agent: 'http-127.0.0.1:18989',
  storeId: 'ops',
  project: 'datatug-demo-project',
  environment: 'local',
};

describe('Incident project navigation', () => {
  it('keeps global Incident journeys global even when their scope names a project', () => {
    const currentUrl =
      '/incidents/ops/INC-1?' + new URLSearchParams(scope).toString();

    expect(incidentProjectRefFromUrl(currentUrl)).toBeUndefined();
    expect(incidentPageCommands(currentUrl)).toEqual(['/incidents']);
    expect(incidentPageCommands(currentUrl, ['new'])).toEqual([
      '/incidents',
      'new',
    ]);
    expect(incidentPageQueryParams(currentUrl, scope)).toEqual(scope);
  });

  it('keeps an agent project through list, create, detail, and record routes without inventing an environment', () => {
    const detailUrl =
      '/store/http-127.0.0.1:18989/project/datatug-demo-project/incidents/ops/INC-1';

    expect(incidentProjectRefFromUrl(detailUrl)).toEqual({
      storeId: 'http-127.0.0.1:18989',
      projectId: 'datatug-demo-project',
    });
    expect(incidentPageCommands(detailUrl)).toEqual([
      '/store/http-127.0.0.1:18989/project/datatug-demo-project/incidents',
    ]);
    expect(incidentPageCommands(detailUrl, ['new'])).toEqual([
      '/store/http-127.0.0.1:18989/project/datatug-demo-project/incidents/new',
    ]);
    expect(incidentPageCommands(detailUrl, ['ops', 'INC-1', 'record'])).toEqual(
      [
        '/store/http-127.0.0.1:18989/project/datatug-demo-project/incidents/ops/INC-1/record',
      ],
    );
    expect(incidentPageQueryParams(detailUrl, undefined)).toBeUndefined();
  });

  it('preserves an explicit local project transport and branch beside complete Incident scope', () => {
    const currentUrl =
      '/store/http-127.0.0.1:18989/project/datatug-demo-project/incidents' +
      '?projectApi=local&branch=feature%2Fincident-nav';

    expect(incidentProjectRefFromUrl(currentUrl)).toEqual({
      storeId: 'http-127.0.0.1:18989',
      projectId: 'datatug-demo-project',
      projectApi: 'local',
      branch: 'feature/incident-nav',
    });
    expect(incidentPageQueryParams(currentUrl, scope)).toEqual({
      projectApi: 'local',
      branch: 'feature/incident-nav',
      ...scope,
    });
  });

  it('does not borrow a project from a non-Incident project page', () => {
    const currentUrl =
      '/store/http-127.0.0.1:18989/project/datatug-demo-project/detective';

    expect(incidentProjectRefFromUrl(currentUrl)).toBeUndefined();
    expect(incidentPageCommands(currentUrl, ['ops', 'INC-1'])).toEqual([
      '/incidents',
      'ops',
      'INC-1',
    ]);
  });
});
