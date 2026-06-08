import { NgModule } from '@angular/core';
import {
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { DatatugStoreService } from './datatug-store.service';
import { StoreApiService } from './store-api.service';
import { AgentStateService } from './agent-state.service';
import { AgentService } from './agent.service';
import { DatatugStoreServiceFactory } from './datatug-store-service-factory.service';
import { DatatugStoreFirestoreService } from './datatug-store.service.firestore';
import { DatatugStoreGithubService } from './datatug-store.service.github';

@NgModule({
  providers: [
    provideHttpClient(withInterceptorsFromDi()),
    DatatugStoreService,
    StoreApiService,
    AgentService,
    AgentStateService,
    DatatugStoreServiceFactory,
    DatatugStoreFirestoreService,
    DatatugStoreGithubService,
  ],
})
export class DatatugServicesStoreModule {}
