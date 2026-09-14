import { datatugRoutes } from './datatug-routing.module';
import {
  routingParamIncidentId,
  routingParamStoreId,
} from '../core/datatug-routing-params';

describe('datatugRoutes', () => {
  it('redirects signed-out to the home page', () => {
    expect(datatugRoutes).toContainEqual({
      path: 'signed-out',
      pathMatch: 'full',
      redirectTo: '/',
    });
  });

  it('keeps Incidentius pages in one incident route family', () => {
    const paths = datatugRoutes.map((route) => route.path);
    expect(paths).toContain('incidents');
    expect(paths).toContain('incidents/new');
    expect(paths).toContain(
      'incidents/:' + routingParamStoreId + '/:' + routingParamIncidentId,
    );
    expect(paths).toContain(
      'incidents/:' +
        routingParamStoreId +
        '/:' +
        routingParamIncidentId +
        '/record',
    );
    expect(paths.filter((path) => path?.startsWith('incidents'))).toHaveLength(
      4,
    );
  });
});
