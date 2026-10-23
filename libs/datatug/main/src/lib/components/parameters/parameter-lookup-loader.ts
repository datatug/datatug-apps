import { InjectionToken, Injector } from '@angular/core';
import type { IParameterDef } from '../../models/definition/parameter';
import type { ParameterLookupResult } from './parameter-lookup-provider';
import type { ParameterLookupHost } from './parameter-lookup.service';

/** What a pick button needs from the lookup machinery. */
export interface ParameterLookupApi {
  availability(parameter: IParameterDef, host: ParameterLookupHost): Promise<{ available: boolean; inferred: boolean }>;
  open(parameter: IParameterDef, host: ParameterLookupHost, currentValue?: string): Promise<ParameterLookupResult | undefined>;
  dispose(): void;
}

/**
 * Loads the lookup machinery (the dialog, the meaning resolution, the browser
 * SQLite session) for one pick button, on demand. It is a separate chunk so
 * that pages and routes that render parameter inputs do not pay for it when
 * they load: it is fetched only once a pick button renders.
 */
export const PARAMETER_LOOKUP_LOADER = new InjectionToken<(injector: Injector) => Promise<ParameterLookupApi>>(
  'PARAMETER_LOOKUP_LOADER',
  {
    providedIn: 'root',
    factory: () => async (injector: Injector) => {
      const [{ ParameterLookupService }, { AgentService }] = await Promise.all([
        import('./parameter-lookup.service'),
        import('../../services/repo/agent.service'),
      ]);
      return Injector.create({ providers: [ParameterLookupService, AgentService], parent: injector }).get(ParameterLookupService);
    },
  },
);
