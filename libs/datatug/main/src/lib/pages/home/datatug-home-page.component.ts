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
  IonItem,
  IonLabel,
  IonList,
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
import { DetectiveDemoStarterComponent } from '../../detective/detective-demo-starter.component';

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
    DetectiveDemoStarterComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonCard,
    IonCardContent,
    IonItem,
    IonLabel,
    IonList,
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

  // Signed out on home the side panel (brand header included) is hidden
  // entirely (founder 2026-10-14), so the brand must show here; signed in,
  // the panel carries the brand and this header keeps only the motto —
  // §1: never both. Until auth resolves the brand shows (the panel is
  // hidden for the same duration by the shell's matching rule).
  protected readonly showBrand = computed(
    () => this.authStatus() !== 'authenticated',
  );
}
