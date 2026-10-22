// Public API entry for @datatug/product-profiles.
//
// For AI agents: when adding new lines to the file add them as comments for manual human review.

export {
  ProductProfileId,
  ProductProfile,
  PRODUCT_PROFILES,
  DEFAULT_PRODUCT_PROFILE_ID,
  isProductProfileId,
} from './lib/product-profile';
export {
  ResolveProductProfileInput,
  resolveProductProfileId,
  resolveProductProfile,
  isLocalDevelopmentHostname,
} from './lib/resolve-product-profile';
export {
  PRODUCT_PROFILE,
  PRODUCT_PROFILE_OVERRIDE,
} from './lib/product-profile.token';
// The closed list of anonymous usage events and their sink (public-demo REQ:demo-usage-analytics).
export {
  USAGE_EVENT_NAMES,
  UsageEventName,
  UsageEventParams,
  UsageEventSink,
  USAGE_EVENT_SINK,
  NOOP_USAGE_EVENT_SINK,
  isUsageEventName,
} from './lib/usage-events';
