import { JsonPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonIcon,
  IonItem,
  IonItemDivider,
  IonLabel,
  MenuController,
  NavController,
} from '@ionic/angular/standalone';
import {
  ISneatAuthState,
  ISneatUserState,
  SneatAuthStateService,
  SneatUserService,
} from '@sneat/auth-core';
import { ErrorLogger } from '@sneat/core';
import { personNames, PersonNamesPipe } from '@sneat/auth-ui';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'sneat-datatug-auth-menu-item',
  templateUrl: './datatug-auth-menu-item.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    PersonNamesPipe,
    IonItemDivider,
    IonLabel,
    IonItem,
    IonIcon,
    IonButtons,
    IonButton,
    JsonPipe,
  ],
})
export class DatatugAuthMenuItemComponent implements OnDestroy {
  private readonly errorLogger = inject(ErrorLogger);
  private readonly navCtrl = inject(NavController);
  private readonly authStateService = inject(SneatAuthStateService);
  private readonly menuController = inject(MenuController);
  private readonly userService = inject(SneatUserService);

  protected readonly user = signal<ISneatUserState | undefined>(undefined);
  protected readonly error = signal<unknown>(undefined);
  protected readonly authState = signal<ISneatAuthState | undefined>(undefined);
  protected readonly authStatus = computed(() => this.authState()?.status);
  protected readonly isAuthenticating = computed(
    () => this.authStatus() === 'authenticating',
  );

  private readonly destroyed = new Subject<void>();
  protected readonly personName = personNames;

  constructor() {
    this.userService.userState.pipe(takeUntil(this.destroyed)).subscribe(this.user.set);
    this.authStateService.authState.pipe(takeUntil(this.destroyed)).subscribe({
      next: this.authState.set,
      error: (err) => {
        this.error.set(err);
        this.errorLogger.logError('failed to get auth state');
      },
    });
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  protected closeMenu(): void {
    this.menuController
      .close()
      .catch(this.errorLogger.logErrorHandler('Failed to close menu'));
  }

  protected async logout(event: Event): Promise<boolean> {
    event.stopPropagation();
    event.preventDefault();
    try {
      await this.authStateService.signOut();
      await this.menuController.close();
      await this.navCtrl.navigateRoot('/');
    } catch (err) {
      this.errorLogger.logError(err, 'Failed to logout');
    }
    return false;
  }
}
