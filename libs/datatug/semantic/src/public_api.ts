// Public API entry for @sneat/datatug-semantic library.

// For AI agents: when adding new lines to the file add them as comments for manual human review.

// The frozen wire contract (types, decoders, wrap/unwrap adapters) — see contract/index.ts.
export * from './contract';
export * from './charting/bar-race';
// Bounded raw-order presentation transform; no query execution or board persistence.
export * from './charting/orders-monthly-country-count';
export * from './lib/models/models';
export * from './lib/tokens/datatug-agent-base-url.token';
export * from './lib/tokens/datatug-api-base-url.token';
export * from './lib/tokens/datatug-api-failover.tokens';
// App-owned fixed development transport, shared without loading the query UI.
export { PUBLIC_OVDB_DEV_TRANSPORT, PUBLIC_OVDB_LOOPBACK_MODE, type PublicOvdbDevTransport } from './lib/tokens/public-ovdb-dev-transport.token';
export { SemanticApiService } from './lib/services/semantic-api.service';
// prettier-ignore
export { AgentContextService, type AgentContextHandle } from './lib/services/agent-context.service';
export {
  MockSemanticApi,
  MockSemanticApiFixtures,
  RecordedCall,
} from './lib/services/mock-semantic-api';
export {
  InvestigationContextService,
  isFactSelectedForBinding,
  isOverlayFact,
  normalizedFactLayer,
  ContextCondition,
  ContextItem,
  contextItemToFact,
  isAgentSendableCondition,
  ContextItemInput,
  ContextScope,
  ParameterBinding,
  scopeKey,
  scopesEqual,
  SemanticParameterRef,
  unifyInListTypes,
} from './lib/services/investigation-context.service';
export {
  BindingBlockReason,
  BindingParameterRef,
  explainSkippedCondition,
  hasBlockingBindings,
  isBindingRunnable,
  ResolveBindingsInput,
  resolveBindings,
  ResolvedBinding,
  ResolvedBindingOrigin,
  SkippedConditionFact,
} from './lib/services/binding-resolver';
export {
  ContextPanelComponent,
  OpenQueryRequest,
} from './lib/components/context-panel/context-panel.component';
export { InvestigationContextBarComponent } from './lib/components/investigation-context-bar/investigation-context-bar.component';
export { LimitationHeaderComponent } from './lib/components/limitation-header/limitation-header.component';
export { SemanticMarkerComponent } from './lib/components/semantic-marker/semantic-marker.component';

export * from './lib/components/source-rights-notice.component';

export * from './charting/row-evidence';
export * from './charting/evidence-json';
export * from './charting/evidence-charts';

export * from './charting/evidence-integrity';
