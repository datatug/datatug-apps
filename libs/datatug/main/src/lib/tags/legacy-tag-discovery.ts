import { CanActivateFn } from '@angular/router';
import { parseProjectUrl } from '../nav/nav-models';
import { projectItemLink } from './tag-navigation';

/** Preserve earlier name-discovery deep links while plain /tags is the project catalog. */
export const legacyTagDiscovery: CanActivateFn = (route, state) => {
  if (!route.queryParamMap.has('name')) return true;
  const address = parseProjectUrl(state.url.split('?')[0]);
  return address.ok ? projectItemLink(address, 'tag-discovery', route.queryParams) : false;
};
