// Public API entry for @sneat/datatug-semantic library.

// For AI agents: when adding new lines to the file add them as comments for manual human review.

// The frozen wire contract (types, decoders, wrap/unwrap adapters) — see contract/index.ts.
export * from './contract';
export * from './lib/models/models';
export * from './lib/tokens/datatug-agent-base-url.token';
export { SemanticApiService } from './lib/services/semantic-api.service';
export { AgentContextService } from './lib/services/agent-context.service';
export {
  MockSemanticApi,
  MockSemanticApiFixtures,
  RecordedCall,
} from './lib/services/mock-semantic-api';
export {
  InvestigationContextService,
  ContextCondition,
  ContextItem,
  ContextItemInput,
  ContextScope,
  ParameterBinding,
  scopeKey,
  scopesEqual,
  SemanticParameterRef,
} from './lib/services/investigation-context.service';
export {
  BindingBlockReason,
  BindingParameterRef,
  hasBlockingBindings,
  isBindingRunnable,
  ResolveBindingsInput,
  resolveBindings,
  ResolvedBinding,
  ResolvedBindingOrigin,
} from './lib/services/binding-resolver';
export { ContextPanelComponent, OpenQueryRequest } from './lib/components/context-panel/context-panel.component';
export { InvestigationContextBarComponent } from './lib/components/investigation-context-bar/investigation-context-bar.component';
export { LimitationHeaderComponent } from './lib/components/limitation-header/limitation-header.component';
export { SemanticMarkerComponent } from './lib/components/semantic-marker/semantic-marker.component';
