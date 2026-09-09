import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { isAgentStoreId } from '../../nav/nav-models';
import { DatatugStoreAgentService } from './datatug-store.service.agent';
import { DatatugStoreGithubService } from './datatug-store.service.github';
import { DatatugStoreFirestoreService } from './datatug-store.service.firestore';
import { IDatatugStoreService } from './datatug-store.service.interface';

// `providedIn: 'root'` — needed so `DatatugFoldersService` (also
// root-provided, see its own comment) can resolve this dependency
// regardless of which route requested it.
@Injectable({ providedIn: 'root' })
export class DatatugStoreServiceFactory {
  private readonly http = inject(HttpClient);
  private readonly firestoreService = inject(DatatugStoreFirestoreService);
  private readonly githubService = inject(DatatugStoreGithubService);

  // One agent service per agent store id (the id is the host every request
  // goes to), created on first use — see `DatatugStoreAgentService`.
  private readonly agentServices: Record<string, DatatugStoreAgentService> = {};

  getDatatugStoreService(store: string): IDatatugStoreService {
    switch (store) {
      case 'firestore':
        return this.firestoreService;
      case 'github.com':
      case 'github':
        return this.githubService;
      default:
        if (isAgentStoreId(store)) {
          return this.getAgentService(store);
        }
        throw new Error('unknown store: ' + store);
    }
  }

  private getAgentService(storeId: string): DatatugStoreAgentService {
    let service = this.agentServices[storeId];
    if (!service) {
      service = new DatatugStoreAgentService(this.http, storeId);
      this.agentServices[storeId] = service;
    }
    return service;
  }
}
