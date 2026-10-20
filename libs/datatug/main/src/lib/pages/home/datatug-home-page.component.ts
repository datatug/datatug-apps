import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCol,
  IonContent,
  IonGrid,
  IonHeader,
  IonMenuButton,
  IonRow,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { AppVersionComponent } from '@sneat/components';
import { SneatAuthStateService } from '@sneat/auth-core';
import { PRODUCT_PROFILE } from '@datatug/product-profiles';
import { NewProjectService } from '../../project/new-project/new-project.service';
import { DatatugServicesNavModule } from '../../services/nav/datatug-services-nav.module';
import { DatatugServicesStoreModule } from '../../services/repo/datatug-services-store.module';
import { MyDatatugProjectsComponent } from './my-projects/my-datatug-projects.component';
import { MyStoresComponent } from './my-stores/my-stores.component';
import { PlatformBlockComponent } from './platform-block/platform-block.component';

@Component({
  selector: 'sneat-datatug-home',
  templateUrl: 'datatug-home-page.component.html',
  styleUrl: './datatug-home-page.component.scss',
  imports: [
    // CoreModule,
    DatatugServicesNavModule,
    DatatugServicesStoreModule,
    // NewProjectFormComponent,
    AppVersionComponent,
    RouterLink,
    MyDatatugProjectsComponent,
    MyStoresComponent,
    PlatformBlockComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonCard,
    IonCardContent,
    IonMenuButton,
    IonGrid,
    IonRow,
    IonCol,
  ],
  // DatatugUserService is providedIn: 'root' — see its own file for why;
  // NewProjectService still needs its own local provider here.
  providers: [NewProjectService],
})
export class DatatugHomePageComponent {
  // Resolved once at bootstrap (or overridden in a test) — read only for its
  // declarative motto/showPoweredByDalgo fields, never branched on by identity
  // (REQ:profile-config-is-declarative).
  protected readonly profile = inject(PRODUCT_PROFILE);

  protected readonly motto = computed(() => this.profile.motto);

  protected readonly authStatus = toSignal(
    inject(SneatAuthStateService).authStatus,
  );

  // DataTug Home keeps its panel closed for either auth state, so this header
  // always carries the brand and owns the menu affordance. Other profiles keep
  // their existing side-panel header composition.
  protected readonly showBrand = computed(
    () =>
      this.profile.minimalSignedOutHome === true ||
      this.authStatus() !== 'authenticated',
  );

  protected readonly showHomeMenu = computed(
    () => this.profile.minimalSignedOutHome === true,
  );
}
