import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  ModalController,
} from '@ionic/angular';
import { Subject } from 'rxjs';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IDbServer } from '../../../models/definition/apis/database';
import { DbServerService } from '../../../services/unsorted/db-server.service';

@Component({
  selector: 'sneat-datatug-add-db-serve',
  templateUrl: './add-db-server.component.html',
  imports: [
    IonHeader,
    IonButtons,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonSelect,
    IonSelectOption,
    IonInput,
    FormsModule,
    IonIcon,
  ],
})
export class AddDbServerComponent implements OnDestroy {
  private readonly modalCtrl = inject(ModalController);
  private readonly dbServerService = inject(DbServerService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);

  readonly dbServer: IDbServer = {
    driver: 'sqlserver',
    host: '',
  };
  // A signal, not a plain field: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts) — the error branch below
  // writes this from inside a `.subscribe()` callback, which never triggers
  // change detection on its own for a plain field. See AGENTS.md's "Change
  // detection & state" section and
  // pages/signed-in/project/project-page.component.ts (PR #95) for the
  // established pattern.
  protected readonly submitting = signal(false);
  private readonly destroyed = new Subject<void>();

  ngOnDestroy() {
    this.destroyed.next();
  }

  close(): void {
    this.modalCtrl.dismiss().catch(this.errorLogger.logErrorHandler);
  }

  submit(): void {
    this.submitting.set(true);
    this.dbServerService.addDbServer(this.dbServer).subscribe({
      next: (dbServerSummary) => {
        this.modalCtrl
          .dismiss(dbServerSummary)
          .catch((err) =>
            this.errorLogger.logError(err, 'Failed to dismiss modal'),
          );
      },
      error: (err) => {
        this.errorLogger.logError(err, 'Failed to add server to project');
        this.submitting.set(false);
      },
    });
  }
}
