import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonChip, IonIcon, IonLabel } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { banOutline, checkmarkCircleOutline, close } from 'ionicons/icons';
import { InvestigationContextService } from '../../services/investigation-context.service';

addIcons({ close, banOutline, checkmarkCircleOutline });

/**
 * REQ:context-basket — one chip per Investigation Context item (enabled and disabled
 * alike), always available to disable/re-enable (tap the chip) or remove (tap the close
 * icon) without navigating away. Reads and mutates {@link InvestigationContextService}
 * directly so a host page only has to place this tag — see the library's INTEGRATION.md.
 */
@Component({
  selector: 'sneat-datatug-investigation-context-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonChip, IonIcon, IonLabel],
  templateUrl: './investigation-context-bar.component.html',
  styleUrl: './investigation-context-bar.component.scss',
})
export class InvestigationContextBarComponent {
  protected readonly context = inject(InvestigationContextService);
  protected readonly items = this.context.items;

  protected toggle(id: string, currentlyEnabled: boolean): void {
    this.context.setEnabled(id, !currentlyEnabled);
  }

  protected remove(id: string, event: Event): void {
    event.stopPropagation();
    this.context.removeValue(id);
  }
}
