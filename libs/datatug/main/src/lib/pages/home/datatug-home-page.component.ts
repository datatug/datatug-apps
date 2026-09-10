import { Component } from '@angular/core';
import {
  IonCard,
  IonCardContent,
  IonCol,
  IonContent,
  IonGrid,
  IonHeader,
  IonRow,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { CopyrightComponent } from '@sneat/components';
import { NewProjectService } from '../../project/new-project/new-project.service';
import { DatatugServicesNavModule } from '../../services/nav/datatug-services-nav.module';
import { DatatugServicesStoreModule } from '../../services/repo/datatug-services-store.module';
import { MyDatatugProjectsComponent } from './my-projects/my-datatug-projects.component';
import { MyStoresComponent } from './my-stores/my-stores.component';

@Component({
  selector: 'sneat-datatug-home',
  templateUrl: 'datatug-home-page.component.html',
  styleUrl: './datatug-home-page.component.scss',
  imports: [
    // CoreModule,
    DatatugServicesNavModule,
    DatatugServicesStoreModule,
    // NewProjectFormComponent,
    CopyrightComponent,
    MyDatatugProjectsComponent,
    MyStoresComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonGrid,
    IonRow,
    IonCol,
  ],
  // DatatugUserService is providedIn: 'root' — see its own file for why;
  // NewProjectService still needs its own local provider here.
  providers: [NewProjectService],
})
export class DatatugHomePageComponent {}
