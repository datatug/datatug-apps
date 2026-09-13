import { convertToParamMap } from '@angular/router';
import { resolveIncidentRouteScope } from './incident-route-context';

const ambientScope = {
  agentStoreId: 'agent-a:8989',
  project: {
    ref: { storeId: 'agent-a:8989', projectId: 'billing' },
  },
  environment: 'prod',
};

describe('resolveIncidentRouteScope', () => {
  const completeExplicitScope = {
    agent: 'agent-b:8989',
    storeId: 'ops',
    project: 'operations',
    environment: 'staging',
  };

  it.each(
    Array.from({ length: 14 }, (_, mask) =>
      Object.fromEntries(
        Object.entries(completeExplicitScope).filter((_, index) =>
          Boolean((mask + 1) & (1 << index)),
        ),
      ),
    ),
  )('fails closed for partial explicit URL scope %#', (explicitScope) => {
    expect(
      resolveIncidentRouteScope(convertToParamMap(explicitScope), ambientScope),
    ).toBeUndefined();
  });

  it('never fills agent B explicit scope from agent A ambient navigation', () => {
    expect(
      resolveIncidentRouteScope(
        convertToParamMap({ agent: 'agent-b:8989' }),
        ambientScope,
      ),
    ).toBeUndefined();
  });

  it('never fills an explicit project from a different ambient agent', () => {
    expect(
      resolveIncidentRouteScope(
        convertToParamMap({ project: 'operations' }),
        ambientScope,
      ),
    ).toBeUndefined();
  });

  it('accepts complete explicit scope without consulting ambient navigation', () => {
    expect(
      resolveIncidentRouteScope(
        convertToParamMap(completeExplicitScope),
        ambientScope,
      ),
    ).toEqual({
      agentStoreId: 'agent-b:8989',
      storeId: 'ops',
      project: 'operations',
      environment: 'staging',
    });
  });

  it('accepts complete ambient scope when it belongs to one agent', () => {
    expect(
      resolveIncidentRouteScope(convertToParamMap({}), ambientScope),
    ).toEqual({
      agentStoreId: 'agent-a:8989',
      storeId: 'billing',
      project: 'billing',
      environment: 'prod',
    });
  });

  it('fails closed when ambient store and project belong to different agents', () => {
    expect(
      resolveIncidentRouteScope(convertToParamMap({}), {
        ...ambientScope,
        project: {
          ref: { storeId: 'agent-b:8989', projectId: 'billing' },
        },
      }),
    ).toBeUndefined();
  });

  it('treats a route store as explicit and requires the other URL scope fields', () => {
    expect(
      resolveIncidentRouteScope(convertToParamMap({}), ambientScope, 'ops'),
    ).toBeUndefined();
  });

  it('keeps the route store authoritative for complete detail scope', () => {
    expect(
      resolveIncidentRouteScope(
        convertToParamMap(completeExplicitScope),
        ambientScope,
        'route-store',
      ),
    ).toEqual({
      agentStoreId: 'agent-b:8989',
      storeId: 'route-store',
      project: 'operations',
      environment: 'staging',
    });
  });
});
