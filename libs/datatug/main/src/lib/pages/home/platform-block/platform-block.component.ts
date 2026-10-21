import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  IonCard,
  IonCardContent,
  IonIcon,
  IonItem,
  IonLabel,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { sparklesOutline, terminalOutline } from 'ionicons/icons';
import {
  PLATFORM_LEDE,
  PLATFORM_PARTS,
  PLATFORM_STATUS_LABEL,
  PLATFORM_TITLE,
} from './platform-parts';

// kebab-case keys: the template binds kebab-case names (see AppVersionComponent for why camelCase never resolves)
addIcons({
  'sparkles-outline': sparklesOutline,
  'terminal-outline': terminalOutline,
});

/**
 * Secondary entry points for the DataTug home page. Static content, so no state.
 */
@Component({
  selector: 'sneat-datatug-platform-block',
  templateUrl: './platform-block.component.html',
  styleUrl: './platform-block.component.scss',
  imports: [IonCard, IonCardContent, IonIcon, IonItem, IonLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformBlockComponent {
  protected readonly title = PLATFORM_TITLE;
  protected readonly lede = PLATFORM_LEDE;
  protected readonly parts = PLATFORM_PARTS;
  protected readonly statusLabel = PLATFORM_STATUS_LABEL;
}
