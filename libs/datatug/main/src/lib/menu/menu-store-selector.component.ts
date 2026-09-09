import {
  Component,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
  input
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonIcon,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import {
  allUserStoresAsFlatList,
  IDatatugStoreBriefWithId,
  IDatatugUser,
} from '../models/interfaces';
import { storeIdToDisplayLabel } from '../nav/nav-models';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';

@Component({
  selector: 'sneat-datatug-menu-store-selector',
  templateUrl: 'menu-store-selector.component.html',
  imports: [
    RouterLink,
    IonItem,
    IonButtons,
    IonButton,
    IonIcon,
    IonLabel,
    IonSelect,
    IonSelectOption,
  ],
})
export class MenuStoreSelectorComponent implements OnDestroy, OnChanges {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly nav = inject(DatatugNavService);
  readonly datatugNavContextService = inject(DatatugNavContextService);

  readonly datatugUser = input<IDatatugUser>();

  currentStoreId?: string;

  /**
   * Shown instead of the raw `currentStoreId` in the single-store fallback
   * (below, `@if (currentStoreId && !stores?.length)`) — that case has no
   * `store.title` to fall back to, so it was always the raw id
   * (`http-localhost:8989`) with no more readable alternative. A getter,
   * not a stored field: purely derived from `currentStoreId` — see
   * `storeIdToDisplayLabel()` in `nav-models.ts`.
   */
  get currentStoreDisplayLabel(): string {
    return storeIdToDisplayLabel(this.currentStoreId);
  }

  stores?: IDatatugStoreBriefWithId[];

  private readonly destroyed = new Subject<void>();

  private externalChange = false;

  constructor() {
    const datatugNavContextService = this.datatugNavContextService;

    datatugNavContextService.currentStoreId
      .pipe(
        takeUntil(this.destroyed),
        filter(
          (id) =>
            id !== this.currentStoreId &&
            !(id === null && !this.currentStoreId),
        ),
      )
      .subscribe((storeId: string | undefined) => {
        console.log(
          'MenuStoreSelectorComponent => external store change:',
          storeId,
        );
        this.externalChange = true;
        this.currentStoreId = storeId;
      });
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['datatugUser']) {
      this.stores = allUserStoresAsFlatList(this.datatugUser()?.datatug?.stores);
    }
  }

  switchStore(event: CustomEvent): void {
    console.log(
      'MenuStoreSelectorComponent.switchStore(event: CustomEvent)',
      this.externalChange,
      event,
    );
    if (this.externalChange) {
      this.externalChange = false;
      return;
    }
    try {
      const value: string = event.detail.value;
      if (value) {
        // this.nav.goStore(...);
      }
    } catch (e: unknown) {
      this.errorLogger.logError(e, 'Failed to handle store switch');
    }
  }

  trackById(_index: number, store: IDatatugStoreBriefWithId): string {
    return store.id;
  }
}
