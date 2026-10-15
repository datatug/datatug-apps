import { Injectable, inject } from '@angular/core';
import { AlertController } from '@ionic/angular';

export interface OvdbConfirmRequest {
  readonly header: string;
  readonly message: string;
  readonly confirmText: string;
}

/** A Cancel / confirm dialog for destructive database actions; resolves true only on confirm. */
@Injectable({ providedIn: 'root' })
export class OvdbConfirmService {
  private readonly alerts = inject(AlertController);

  async confirm(request: OvdbConfirmRequest): Promise<boolean> {
    const alert = await this.alerts.create({
      header: request.header,
      message: request.message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: request.confirmText, role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'destructive';
  }
}
